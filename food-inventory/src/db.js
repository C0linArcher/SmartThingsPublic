import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.FRESHTRACK_DB || join(__dirname, '..', 'freshtrack.db');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS category (
      id        INTEGER PRIMARY KEY,
      name      TEXT NOT NULL,
      parent_id INTEGER REFERENCES category(id)
    );

    CREATE TABLE IF NOT EXISTS supplier (
      id             INTEGER PRIMARY KEY,
      name           TEXT NOT NULL,
      contact_email  TEXT,
      lead_time_days INTEGER NOT NULL DEFAULT 3
    );

    CREATE TABLE IF NOT EXISTS product (
      id             INTEGER PRIMARY KEY,
      sku            TEXT NOT NULL UNIQUE,
      name           TEXT NOT NULL,
      category_id    INTEGER REFERENCES category(id),
      supplier_id    INTEGER REFERENCES supplier(id),
      unit           TEXT NOT NULL DEFAULT 'each',
      unit_price     REAL NOT NULL DEFAULT 0,
      perishable     INTEGER NOT NULL DEFAULT 1,
      shelf_life_days INTEGER NOT NULL DEFAULT 7,
      reorder_point  INTEGER NOT NULL DEFAULT 10,
      reorder_qty    INTEGER NOT NULL DEFAULT 50,
      storage        TEXT NOT NULL DEFAULT 'AMBIENT'
    );

    CREATE TABLE IF NOT EXISTS stock_batch (
      id              INTEGER PRIMARY KEY,
      product_id      INTEGER NOT NULL REFERENCES product(id),
      lot_number      TEXT NOT NULL,
      received_date   TEXT NOT NULL,
      expiration_date TEXT,
      quantity        INTEGER NOT NULL,
      cost_price      REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS stock_movement (
      id          INTEGER PRIMARY KEY,
      batch_id    INTEGER REFERENCES stock_batch(id),
      product_id  INTEGER NOT NULL REFERENCES product(id),
      type        TEXT NOT NULL,           -- RECEIPT | SALE | ADJUSTMENT | WASTE_SPOILAGE
      quantity    INTEGER NOT NULL,        -- signed: + adds, - removes
      reason      TEXT,
      occurred_at TEXT NOT NULL
    );
  `);
}
