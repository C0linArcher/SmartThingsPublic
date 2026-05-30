import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { db, initSchema } from './db.js';
import { seed } from './seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// "Today" is pinned so the seeded demo data (expiring/expired lots) stays meaningful.
const TODAY = new Date(process.env.FRESHTRACK_TODAY || '2026-05-30T08:00:00Z');
const EXPIRING_SOON_DAYS = 5;

initSchema();
// Auto-seed on first run so the prototype is one command to start.
if (db.prepare('SELECT COUNT(*) c FROM product').get().c === 0) {
  seed();
}

function daysBetween(a, b) {
  return Math.round((a - b) / 86400000);
}

function batchStatus(b) {
  if (b.quantity <= 0) return 'DEPLETED';
  if (!b.expiration_date) return 'AVAILABLE';
  const exp = new Date(b.expiration_date + 'T00:00:00Z');
  const days = daysBetween(exp, TODAY);
  if (days < 0) return 'EXPIRED';
  if (days <= EXPIRING_SOON_DAYS) return 'EXPIRING_SOON';
  return 'AVAILABLE';
}

function daysUntilExpiry(b) {
  if (!b.expiration_date) return null;
  return daysBetween(new Date(b.expiration_date + 'T00:00:00Z'), TODAY);
}

// On-hand only counts batches that are not expired (expired stock is unsellable).
function productOnHand(productId) {
  const rows = db.prepare('SELECT * FROM stock_batch WHERE product_id = ? AND quantity > 0').all(productId);
  let sellable = 0, expired = 0;
  for (const b of rows) {
    if (batchStatus(b) === 'EXPIRED') expired += b.quantity;
    else sellable += b.quantity;
  }
  return { sellable, expired };
}

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, '..', 'public')));

app.get('/api/health', (_req, res) => res.json({ ok: true, today: TODAY.toISOString().slice(0, 10) }));

// --- Products with computed stock ---
app.get('/api/products', (_req, res) => {
  const products = db.prepare(`
    SELECT p.*, c.name AS category, s.name AS supplier
    FROM product p
    LEFT JOIN category c ON c.id = p.category_id
    LEFT JOIN supplier s ON s.id = p.supplier_id
    ORDER BY p.name
  `).all();
  const out = products.map((p) => {
    const { sellable, expired } = productOnHand(p.id);
    return {
      ...p,
      onHand: sellable,
      expiredOnHand: expired,
      needsReorder: sellable < p.reorder_point,
    };
  });
  res.json(out);
});

app.get('/api/products/:id/batches', (req, res) => {
  const batches = db.prepare('SELECT * FROM stock_batch WHERE product_id = ? ORDER BY expiration_date IS NULL, expiration_date')
    .all(req.params.id);
  res.json(batches.map((b) => ({
    ...b,
    status: batchStatus(b),
    daysUntilExpiry: daysUntilExpiry(b),
  })));
});

// --- Movement ledger ---
app.get('/api/movements', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const rows = db.prepare(`
    SELECT m.*, p.name AS product, p.sku, b.lot_number
    FROM stock_movement m
    JOIN product p ON p.id = m.product_id
    LEFT JOIN stock_batch b ON b.id = m.batch_id
    ORDER BY m.occurred_at DESC, m.id DESC
    LIMIT ?
  `).all(limit);
  res.json(rows);
});

// --- Dashboard summary + alerts ---
app.get('/api/dashboard', (_req, res) => {
  const products = db.prepare('SELECT * FROM product').all();
  const alerts = [];
  let inventoryValue = 0;
  let lowStock = 0, expiringSoon = 0, expired = 0;

  for (const p of products) {
    const { sellable, expired: exp } = productOnHand(p.id);
    if (sellable < p.reorder_point) {
      lowStock++;
      alerts.push({ type: 'LOW_STOCK', product: p.name, sku: p.sku,
        message: `${sellable} ${p.unit} on hand — below reorder point of ${p.reorder_point}` });
    }
    if (exp > 0) {
      expired += exp;
      alerts.push({ type: 'EXPIRED', product: p.name, sku: p.sku,
        message: `${exp} ${p.unit} expired and need disposal` });
    }
  }

  const batches = db.prepare('SELECT b.*, p.unit, p.name AS product, p.sku FROM stock_batch b JOIN product p ON p.id = b.product_id WHERE b.quantity > 0').all();
  for (const b of batches) {
    inventoryValue += b.quantity * b.cost_price;
    const st = batchStatus(b);
    if (st === 'EXPIRING_SOON') {
      expiringSoon++;
      alerts.push({ type: 'EXPIRING_SOON', product: b.product, sku: b.sku,
        message: `Lot ${b.lot_number}: ${b.quantity} ${b.unit} expire in ${daysUntilExpiry(b)} day(s)` });
    }
  }

  const order = { EXPIRED: 0, LOW_STOCK: 1, EXPIRING_SOON: 2 };
  alerts.sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9));

  res.json({
    today: TODAY.toISOString().slice(0, 10),
    metrics: {
      products: products.length,
      inventoryValue: Math.round(inventoryValue * 100) / 100,
      lowStock,
      expiringSoon,
      expiredUnits: expired,
    },
    alerts,
  });
});

// --- Receive stock: creates a batch + RECEIPT ledger entry ---
app.post('/api/receive', (req, res) => {
  const { productId, quantity, lotNumber, expirationDate, costPrice } = req.body || {};
  const product = db.prepare('SELECT * FROM product WHERE id = ?').get(productId);
  if (!product) return res.status(404).json({ error: 'Unknown product' });
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'Quantity must be positive' });

  const lot = lotNumber || `LOT-${Date.now()}`;
  const recvDate = TODAY.toISOString().slice(0, 10);
  let exp = expirationDate || null;
  if (!exp && product.perishable) {
    const d = new Date(TODAY);
    d.setUTCDate(d.getUTCDate() + product.shelf_life_days);
    exp = d.toISOString().slice(0, 10);
  }
  const cost = Number(costPrice) || product.unit_price * 0.7;

  const tx = db.transaction(() => {
    const batchId = db.prepare(`INSERT INTO stock_batch
      (product_id, lot_number, received_date, expiration_date, quantity, cost_price)
      VALUES (?, ?, ?, ?, ?, ?)`).run(productId, lot, recvDate, exp, qty, cost).lastInsertRowid;
    db.prepare(`INSERT INTO stock_movement (batch_id, product_id, type, quantity, reason, occurred_at)
      VALUES (?, ?, 'RECEIPT', ?, ?, ?)`).run(batchId, productId, qty, `Received lot ${lot}`, TODAY.toISOString());
    return batchId;
  });
  const batchId = tx();
  res.json({ ok: true, batchId, lotNumber: lot, expirationDate: exp });
});

// --- Sell stock: FEFO (first-expired-first-out) consumption across batches ---
app.post('/api/sell', (req, res) => {
  const { productId, quantity, reference } = req.body || {};
  const product = db.prepare('SELECT * FROM product WHERE id = ?').get(productId);
  if (!product) return res.status(404).json({ error: 'Unknown product' });
  let remaining = Number(quantity);
  if (!Number.isFinite(remaining) || remaining <= 0) return res.status(400).json({ error: 'Quantity must be positive' });

  // Candidate batches: in stock, not expired, ordered by soonest expiry first (nulls last).
  const candidates = db.prepare(`SELECT * FROM stock_batch WHERE product_id = ? AND quantity > 0
    ORDER BY expiration_date IS NULL, expiration_date`).all(productId)
    .filter((b) => batchStatus(b) !== 'EXPIRED');

  const available = candidates.reduce((s, b) => s + b.quantity, 0);
  if (available < remaining) {
    return res.status(409).json({ error: `Only ${available} ${product.unit} sellable, requested ${remaining}` });
  }

  const ref = reference || `SO-${Date.now()}`;
  const picks = [];
  const tx = db.transaction(() => {
    for (const b of candidates) {
      if (remaining <= 0) break;
      const take = Math.min(b.quantity, remaining);
      db.prepare('UPDATE stock_batch SET quantity = quantity - ? WHERE id = ?').run(take, b.id);
      db.prepare(`INSERT INTO stock_movement (batch_id, product_id, type, quantity, reason, occurred_at)
        VALUES (?, ?, 'SALE', ?, ?, ?)`).run(b.id, productId, -take, ref, TODAY.toISOString());
      picks.push({ lotNumber: b.lot_number, taken: take, expirationDate: b.expiration_date });
      remaining -= take;
    }
  });
  tx();
  res.json({ ok: true, reference: ref, picks });
});

// --- Write off expired/spoiled stock from a batch ---
app.post('/api/waste', (req, res) => {
  const { batchId, reason } = req.body || {};
  const b = db.prepare('SELECT * FROM stock_batch WHERE id = ?').get(batchId);
  if (!b) return res.status(404).json({ error: 'Unknown batch' });
  if (b.quantity <= 0) return res.status(400).json({ error: 'Batch already depleted' });
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO stock_movement (batch_id, product_id, type, quantity, reason, occurred_at)
      VALUES (?, ?, 'WASTE_SPOILAGE', ?, ?, ?)`).run(b.id, b.product_id, -b.quantity, reason || 'Spoilage write-off', TODAY.toISOString());
    db.prepare('UPDATE stock_batch SET quantity = 0 WHERE id = ?').run(b.id);
  });
  tx();
  res.json({ ok: true, wrote_off: b.quantity });
});

app.listen(PORT, () => {
  console.log(`FreshTrack running at http://localhost:${PORT}  (today=${TODAY.toISOString().slice(0,10)})`);
});
