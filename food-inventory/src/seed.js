import { db, initSchema } from './db.js';

// Reset + reseed. Safe to run repeatedly.
function reset() {
  db.exec(`
    DROP TABLE IF EXISTS stock_movement;
    DROP TABLE IF EXISTS stock_batch;
    DROP TABLE IF EXISTS product;
    DROP TABLE IF EXISTS supplier;
    DROP TABLE IF EXISTS category;
  `);
  initSchema();
}

const TODAY = new Date('2026-05-30T08:00:00Z');
function isoDay(offsetDays) {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
function isoTime(offsetDays) {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString();
}

export function seed() {
  reset();

  const cat = db.prepare('INSERT INTO category (name, parent_id) VALUES (?, ?)');
  const food = cat.run('Food', null).lastInsertRowid;
  const supplies = cat.run('Supplies', null).lastInsertRowid;
  const dairy = cat.run('Dairy', food).lastInsertRowid;
  const produce = cat.run('Produce', food).lastInsertRowid;
  const bakery = cat.run('Bakery', food).lastInsertRowid;
  const dry = cat.run('Dry Goods', food).lastInsertRowid;
  const packaging = cat.run('Packaging', supplies).lastInsertRowid;

  const sup = db.prepare('INSERT INTO supplier (name, contact_email, lead_time_days) VALUES (?, ?, ?)');
  const dairyCo = sup.run('Green Valley Dairy', 'orders@greenvalley.example', 2).lastInsertRowid;
  const farm = sup.run('Sunrise Farms', 'sales@sunrisefarms.example', 1).lastInsertRowid;
  const mill = sup.run('Heartland Mills', 'supply@heartland.example', 5).lastInsertRowid;
  const pack = sup.run('BoxRight Packaging', 'hello@boxright.example', 7).lastInsertRowid;

  const prod = db.prepare(`INSERT INTO product
    (sku, name, category_id, supplier_id, unit, unit_price, perishable, shelf_life_days, reorder_point, reorder_qty, storage)
    VALUES (@sku, @name, @category_id, @supplier_id, @unit, @unit_price, @perishable, @shelf_life_days, @reorder_point, @reorder_qty, @storage)`);

  const P = (o) => prod.run(o).lastInsertRowid;

  const milk      = P({ sku: 'DRY-MILK-1G', name: 'Whole Milk (1 gal)', category_id: dairy, supplier_id: dairyCo, unit: 'gal', unit_price: 4.29, perishable: 1, shelf_life_days: 14, reorder_point: 40, reorder_qty: 120, storage: 'REFRIGERATED' });
  const yogurt    = P({ sku: 'DRY-YOG-32', name: 'Greek Yogurt (32 oz)', category_id: dairy, supplier_id: dairyCo, unit: 'tub', unit_price: 5.49, perishable: 1, shelf_life_days: 21, reorder_point: 30, reorder_qty: 80, storage: 'REFRIGERATED' });
  const eggs      = P({ sku: 'PRD-EGG-DZ', name: 'Free-Range Eggs (dozen)', category_id: produce, supplier_id: farm, unit: 'dozen', unit_price: 3.99, perishable: 1, shelf_life_days: 28, reorder_point: 50, reorder_qty: 150, storage: 'REFRIGERATED' });
  const lettuce   = P({ sku: 'PRD-LET-CT', name: 'Romaine Lettuce (case)', category_id: produce, supplier_id: farm, unit: 'case', unit_price: 18.50, perishable: 1, shelf_life_days: 7, reorder_point: 15, reorder_qty: 40, storage: 'REFRIGERATED' });
  const bread     = P({ sku: 'BKY-SDO-LF', name: 'Sourdough Loaf', category_id: bakery, supplier_id: farm, unit: 'loaf', unit_price: 4.50, perishable: 1, shelf_life_days: 5, reorder_point: 25, reorder_qty: 60, storage: 'AMBIENT' });
  const flour     = P({ sku: 'DRY-FLR-25', name: 'All-Purpose Flour (25 lb)', category_id: dry, supplier_id: mill, unit: 'bag', unit_price: 12.75, perishable: 1, shelf_life_days: 365, reorder_point: 20, reorder_qty: 50, storage: 'AMBIENT' });
  const rice      = P({ sku: 'DRY-RIC-50', name: 'Jasmine Rice (50 lb)', category_id: dry, supplier_id: mill, unit: 'bag', unit_price: 38.00, perishable: 0, shelf_life_days: 730, reorder_point: 10, reorder_qty: 30, storage: 'AMBIENT' });
  const boxes     = P({ sku: 'SUP-BOX-LG', name: 'Shipping Box (Large)', category_id: packaging, supplier_id: pack, unit: 'each', unit_price: 1.10, perishable: 0, shelf_life_days: 3650, reorder_point: 200, reorder_qty: 1000, storage: 'AMBIENT' });
  const bags      = P({ sku: 'SUP-BAG-PR', name: 'Produce Bag (roll)', category_id: packaging, supplier_id: pack, unit: 'roll', unit_price: 6.25, perishable: 0, shelf_life_days: 3650, reorder_point: 30, reorder_qty: 100, storage: 'AMBIENT' });

  // Batches: mix of fresh, expiring-soon, and expired to make the dashboard interesting.
  const batch = db.prepare(`INSERT INTO stock_batch
    (product_id, lot_number, received_date, expiration_date, quantity, cost_price)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const mv = db.prepare(`INSERT INTO stock_movement
    (batch_id, product_id, type, quantity, reason, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?)`);

  // helper: create a batch AND its RECEIPT ledger entry
  function receive(productId, lot, recvOffset, expOffset, qty, cost) {
    const id = batch.run(productId, lot, isoDay(recvOffset), expOffset === null ? null : isoDay(expOffset), qty, cost).lastInsertRowid;
    mv.run(id, productId, 'RECEIPT', qty, `Received lot ${lot}`, isoTime(recvOffset));
    return id;
  }

  // Milk — healthy stock, two lots, nearest expiring in 4 days
  receive(milk, 'GVD-2405A', -10, 4, 60, 3.10);
  receive(milk, 'GVD-2405B', -4, 10, 70, 3.10);
  // Yogurt — fine
  receive(yogurt, 'GVD-Y2204', -6, 15, 65, 3.80);
  // Eggs — plenty
  receive(eggs, 'SF-E2401', -8, 20, 130, 2.40);
  // Lettuce — LOW STOCK (below reorder 15) and one lot EXPIRING in 2 days
  receive(lettuce, 'SF-L2419', -5, 2, 9, 12.00);
  // Bread — has an EXPIRED lot still on the books + a fresh one
  receive(bread, 'SF-B2418', -7, -2, 12, 2.20);   // expired 2 days ago
  receive(bread, 'SF-B2422', -1, 4, 40, 2.20);
  // Flour — fine
  receive(flour, 'HM-F2310', -30, 335, 45, 9.50);
  // Rice — non-perishable, fine
  receive(rice, 'HM-R2208', -60, null, 28, 30.00);
  // Boxes — LOW STOCK (reorder 200)
  receive(boxes, 'BR-BX01', -45, null, 150, 0.80);
  // Produce bags — fine
  receive(bags, 'BR-PB07', -20, null, 80, 5.00);

  // A couple of historical sales so the ledger isn't empty
  const milkBatch = db.prepare('SELECT id FROM stock_batch WHERE lot_number = ?').get('GVD-2405A').id;
  db.prepare('UPDATE stock_batch SET quantity = quantity - ? WHERE id = ?').run(20, milkBatch);
  mv.run(milkBatch, milk, 'SALE', -20, 'SO-1001', isoTime(-2));
  const eggBatch = db.prepare('SELECT id FROM stock_batch WHERE lot_number = ?').get('SF-E2401').id;
  db.prepare('UPDATE stock_batch SET quantity = quantity - ? WHERE id = ?').run(15, eggBatch);
  mv.run(eggBatch, eggs, 'SALE', -15, 'SO-1002', isoTime(-1));

  console.log('Seeded FreshTrack with', db.prepare('SELECT COUNT(*) c FROM product').get().c, 'products and',
    db.prepare('SELECT COUNT(*) c FROM stock_batch').get().c, 'batches.');
}

// Run directly: `npm run seed`
if (import.meta.url === `file://${process.argv[1]}`) {
  seed();
}
