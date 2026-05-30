import { reset, insert, find, saveNow, store } from './db.js';

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

  const food = insert('category', { name: 'Food', parent_id: null }).id;
  const supplies = insert('category', { name: 'Supplies', parent_id: null }).id;
  const dairy = insert('category', { name: 'Dairy', parent_id: food }).id;
  const produce = insert('category', { name: 'Produce', parent_id: food }).id;
  const bakery = insert('category', { name: 'Bakery', parent_id: food }).id;
  const dry = insert('category', { name: 'Dry Goods', parent_id: food }).id;
  const packaging = insert('category', { name: 'Packaging', parent_id: supplies }).id;

  const dairyCo = insert('supplier', { name: 'Green Valley Dairy', contact_email: 'orders@greenvalley.example', lead_time_days: 2 }).id;
  const farm = insert('supplier', { name: 'Sunrise Farms', contact_email: 'sales@sunrisefarms.example', lead_time_days: 1 }).id;
  const mill = insert('supplier', { name: 'Heartland Mills', contact_email: 'supply@heartland.example', lead_time_days: 5 }).id;
  const pack = insert('supplier', { name: 'BoxRight Packaging', contact_email: 'hello@boxright.example', lead_time_days: 7 }).id;

  const P = (o) => insert('product', {
    unit: 'each', unit_price: 0, perishable: 1, shelf_life_days: 7,
    reorder_point: 10, reorder_qty: 50, storage: 'AMBIENT', ...o,
  }).id;

  const milk    = P({ sku: 'DRY-MILK-1G', name: 'Whole Milk (1 gal)', category_id: dairy, supplier_id: dairyCo, unit: 'gal', unit_price: 4.29, shelf_life_days: 14, reorder_point: 40, reorder_qty: 120, storage: 'REFRIGERATED' });
  const yogurt  = P({ sku: 'DRY-YOG-32', name: 'Greek Yogurt (32 oz)', category_id: dairy, supplier_id: dairyCo, unit: 'tub', unit_price: 5.49, shelf_life_days: 21, reorder_point: 30, reorder_qty: 80, storage: 'REFRIGERATED' });
  const eggs    = P({ sku: 'PRD-EGG-DZ', name: 'Free-Range Eggs (dozen)', category_id: produce, supplier_id: farm, unit: 'dozen', unit_price: 3.99, shelf_life_days: 28, reorder_point: 50, reorder_qty: 150, storage: 'REFRIGERATED' });
  const lettuce = P({ sku: 'PRD-LET-CT', name: 'Romaine Lettuce (case)', category_id: produce, supplier_id: farm, unit: 'case', unit_price: 18.50, shelf_life_days: 7, reorder_point: 15, reorder_qty: 40, storage: 'REFRIGERATED' });
  const bread   = P({ sku: 'BKY-SDO-LF', name: 'Sourdough Loaf', category_id: bakery, supplier_id: farm, unit: 'loaf', unit_price: 4.50, shelf_life_days: 5, reorder_point: 25, reorder_qty: 60, storage: 'AMBIENT' });
  const flour   = P({ sku: 'DRY-FLR-25', name: 'All-Purpose Flour (25 lb)', category_id: dry, supplier_id: mill, unit: 'bag', unit_price: 12.75, shelf_life_days: 365, reorder_point: 20, reorder_qty: 50, storage: 'AMBIENT' });
  const rice    = P({ sku: 'DRY-RIC-50', name: 'Jasmine Rice (50 lb)', category_id: dry, supplier_id: mill, unit: 'bag', unit_price: 38.00, perishable: 0, shelf_life_days: 730, reorder_point: 10, reorder_qty: 30, storage: 'AMBIENT' });
  const boxes   = P({ sku: 'SUP-BOX-LG', name: 'Shipping Box (Large)', category_id: packaging, supplier_id: pack, unit: 'each', unit_price: 1.10, perishable: 0, shelf_life_days: 3650, reorder_point: 200, reorder_qty: 1000, storage: 'AMBIENT' });
  const bags    = P({ sku: 'SUP-BAG-PR', name: 'Produce Bag (roll)', category_id: packaging, supplier_id: pack, unit: 'roll', unit_price: 6.25, perishable: 0, shelf_life_days: 3650, reorder_point: 30, reorder_qty: 100, storage: 'AMBIENT' });

  // Batch + its RECEIPT ledger entry. Mix of fresh / expiring / expired lots.
  function receive(productId, lot, recvOffset, expOffset, qty, cost) {
    const b = insert('stock_batch', {
      product_id: productId, lot_number: lot, received_date: isoDay(recvOffset),
      expiration_date: expOffset === null ? null : isoDay(expOffset), quantity: qty, cost_price: cost,
    });
    insert('stock_movement', { batch_id: b.id, product_id: productId, type: 'RECEIPT', quantity: qty, reason: `Received lot ${lot}`, occurred_at: isoTime(recvOffset) });
    return b;
  }

  receive(milk, 'GVD-2405A', -10, 4, 60, 3.10);
  receive(milk, 'GVD-2405B', -4, 10, 70, 3.10);
  receive(yogurt, 'GVD-Y2204', -6, 15, 65, 3.80);
  receive(eggs, 'SF-E2401', -8, 20, 130, 2.40);
  receive(lettuce, 'SF-L2419', -5, 2, 9, 12.00);    // low stock + expiring
  receive(bread, 'SF-B2418', -7, -2, 12, 2.20);      // expired 2 days ago
  receive(bread, 'SF-B2422', -1, 4, 40, 2.20);
  receive(flour, 'HM-F2310', -30, 335, 45, 9.50);
  receive(rice, 'HM-R2208', -60, null, 28, 30.00);
  receive(boxes, 'BR-BX01', -45, null, 150, 0.80);   // low stock
  receive(bags, 'BR-PB07', -20, null, 80, 5.00);

  // A couple of historical sales so the ledger isn't empty
  const milkBatch = find('stock_batch', (b) => b.lot_number === 'GVD-2405A');
  milkBatch.quantity -= 20;
  insert('stock_movement', { batch_id: milkBatch.id, product_id: milk, type: 'SALE', quantity: -20, reason: 'SO-1001', occurred_at: isoTime(-2) });
  const eggBatch = find('stock_batch', (b) => b.lot_number === 'SF-E2401');
  eggBatch.quantity -= 15;
  insert('stock_movement', { batch_id: eggBatch.id, product_id: eggs, type: 'SALE', quantity: -15, reason: 'SO-1002', occurred_at: isoTime(-1) });

  saveNow();
  console.log(`Seeded FreshTrack with ${store.product.length} products and ${store.stock_batch.length} batches.`);
}

// Run directly: `npm run seed`
if (import.meta.url === `file://${process.argv[1]}`) {
  seed();
  console.log('Done.');
}
