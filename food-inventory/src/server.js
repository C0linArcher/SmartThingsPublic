import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { store, all, find, filter, insert, save, isEmpty } from './db.js';
import { seed } from './seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// "Today" is pinned so the seeded demo data (expiring/expired lots) stays meaningful.
const TODAY = new Date(process.env.FRESHTRACK_TODAY || '2026-05-30T08:00:00Z');
const EXPIRING_SOON_DAYS = 5;

// Auto-seed on first run so the prototype is one command to start.
if (isEmpty()) seed();

function daysBetween(a, b) {
  return Math.round((a - b) / 86400000);
}

function batchStatus(b) {
  if (b.quantity <= 0) return 'DEPLETED';
  if (!b.expiration_date) return 'AVAILABLE';
  const days = daysBetween(new Date(b.expiration_date + 'T00:00:00Z'), TODAY);
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
  let sellable = 0, expired = 0;
  for (const b of filter('stock_batch', (x) => x.product_id === productId && x.quantity > 0)) {
    if (batchStatus(b) === 'EXPIRED') expired += b.quantity;
    else sellable += b.quantity;
  }
  return { sellable, expired };
}

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, '..', 'public')));

const today = () => TODAY.toISOString().slice(0, 10);

app.get('/api/health', (_req, res) => res.json({ ok: true, today: today() }));

// --- Products with computed stock ---
app.get('/api/products', (_req, res) => {
  const out = [...all('product')]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => {
      const cat = find('category', (c) => c.id === p.category_id);
      const sup = find('supplier', (s) => s.id === p.supplier_id);
      const { sellable, expired } = productOnHand(p.id);
      return {
        ...p,
        category: cat ? cat.name : null,
        supplier: sup ? sup.name : null,
        onHand: sellable,
        expiredOnHand: expired,
        needsReorder: sellable < p.reorder_point,
      };
    });
  res.json(out);
});

app.get('/api/products/:id/batches', (req, res) => {
  const id = Number(req.params.id);
  const batches = filter('stock_batch', (b) => b.product_id === id)
    .sort((a, b) => {
      if (!a.expiration_date) return 1;
      if (!b.expiration_date) return -1;
      return a.expiration_date.localeCompare(b.expiration_date);
    });
  res.json(batches.map((b) => ({ ...b, status: batchStatus(b), daysUntilExpiry: daysUntilExpiry(b) })));
});

// --- Movement ledger ---
app.get('/api/movements', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const rows = [...all('stock_movement')]
    .sort((a, b) => (b.occurred_at.localeCompare(a.occurred_at)) || (b.id - a.id))
    .slice(0, limit)
    .map((m) => {
      const p = find('product', (x) => x.id === m.product_id);
      const b = m.batch_id ? find('stock_batch', (x) => x.id === m.batch_id) : null;
      return { ...m, product: p ? p.name : '?', sku: p ? p.sku : '', lot_number: b ? b.lot_number : null };
    });
  res.json(rows);
});

// --- Dashboard summary + alerts ---
app.get('/api/dashboard', (_req, res) => {
  const products = all('product');
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

  for (const b of filter('stock_batch', (x) => x.quantity > 0)) {
    inventoryValue += b.quantity * b.cost_price;
    if (batchStatus(b) === 'EXPIRING_SOON') {
      expiringSoon++;
      const p = find('product', (x) => x.id === b.product_id);
      alerts.push({ type: 'EXPIRING_SOON', product: p.name, sku: p.sku,
        message: `Lot ${b.lot_number}: ${b.quantity} ${p.unit} expire in ${daysUntilExpiry(b)} day(s)` });
    }
  }

  const order = { EXPIRED: 0, LOW_STOCK: 1, EXPIRING_SOON: 2 };
  alerts.sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9));

  res.json({
    today: today(),
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
  const product = find('product', (p) => p.id === Number(productId));
  if (!product) return res.status(404).json({ error: 'Unknown product' });
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'Quantity must be positive' });

  const lot = lotNumber || `LOT-${Date.now()}`;
  let exp = expirationDate || null;
  if (!exp && product.perishable) {
    const d = new Date(TODAY);
    d.setUTCDate(d.getUTCDate() + product.shelf_life_days);
    exp = d.toISOString().slice(0, 10);
  }
  const cost = Number(costPrice) || Math.round(product.unit_price * 0.7 * 100) / 100;

  const batch = insert('stock_batch', {
    product_id: product.id, lot_number: lot, received_date: today(),
    expiration_date: exp, quantity: qty, cost_price: cost,
  });
  insert('stock_movement', { batch_id: batch.id, product_id: product.id, type: 'RECEIPT', quantity: qty, reason: `Received lot ${lot}`, occurred_at: TODAY.toISOString() });
  res.json({ ok: true, batchId: batch.id, lotNumber: lot, expirationDate: exp });
});

// --- Sell stock: FEFO (first-expired-first-out) consumption across batches ---
app.post('/api/sell', (req, res) => {
  const { productId, quantity, reference } = req.body || {};
  const product = find('product', (p) => p.id === Number(productId));
  if (!product) return res.status(404).json({ error: 'Unknown product' });
  let remaining = Number(quantity);
  if (!Number.isFinite(remaining) || remaining <= 0) return res.status(400).json({ error: 'Quantity must be positive' });

  // Candidate batches: in stock, not expired, ordered by soonest expiry first (nulls last).
  const candidates = filter('stock_batch', (b) => b.product_id === product.id && b.quantity > 0)
    .filter((b) => batchStatus(b) !== 'EXPIRED')
    .sort((a, b) => {
      if (!a.expiration_date) return 1;
      if (!b.expiration_date) return -1;
      return a.expiration_date.localeCompare(b.expiration_date);
    });

  const available = candidates.reduce((s, b) => s + b.quantity, 0);
  if (available < remaining) {
    return res.status(409).json({ error: `Only ${available} ${product.unit} sellable, requested ${remaining}` });
  }

  const ref = reference || `SO-${Date.now()}`;
  const picks = [];
  for (const b of candidates) {
    if (remaining <= 0) break;
    const take = Math.min(b.quantity, remaining);
    b.quantity -= take;
    insert('stock_movement', { batch_id: b.id, product_id: product.id, type: 'SALE', quantity: -take, reason: ref, occurred_at: TODAY.toISOString() });
    picks.push({ lotNumber: b.lot_number, taken: take, expirationDate: b.expiration_date });
    remaining -= take;
  }
  save();
  res.json({ ok: true, reference: ref, picks });
});

// --- Write off expired/spoiled stock from a batch ---
app.post('/api/waste', (req, res) => {
  const { batchId, reason } = req.body || {};
  const b = find('stock_batch', (x) => x.id === Number(batchId));
  if (!b) return res.status(404).json({ error: 'Unknown batch' });
  if (b.quantity <= 0) return res.status(400).json({ error: 'Batch already depleted' });
  const wrote = b.quantity;
  insert('stock_movement', { batch_id: b.id, product_id: b.product_id, type: 'WASTE_SPOILAGE', quantity: -wrote, reason: reason || 'Spoilage write-off', occurred_at: TODAY.toISOString() });
  b.quantity = 0;
  save();
  res.json({ ok: true, wrote_off: wrote });
});

app.listen(PORT, () => {
  console.log(`FreshTrack running at http://localhost:${PORT}  (today=${today()})`);
});
