// Zero-dependency JSON-file store. No native modules — runs anywhere Node runs
// (including Termux on Android). Data is held in memory and persisted to a
// single JSON file. The query surface is intentionally tiny: each "table" is an
// array of plain objects, plus a couple of helpers.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.FRESHTRACK_DB || join(__dirname, '..', 'freshtrack.json');

const EMPTY = () => ({
  category: [],
  supplier: [],
  product: [],
  stock_batch: [],
  stock_movement: [],
  _seq: {},
});

export const store = existsSync(dbPath)
  ? JSON.parse(readFileSync(dbPath, 'utf8'))
  : EMPTY();

let saveTimer = null;
export function save() {
  // debounce so a burst of writes (e.g. a multi-batch sale) hits disk once
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeFileSync(dbPath, JSON.stringify(store, null, 2)), 25);
}
export function saveNow() {
  clearTimeout(saveTimer);
  writeFileSync(dbPath, JSON.stringify(store, null, 2));
}

export function reset() {
  Object.assign(store, EMPTY());
  saveNow();
}

// Insert a row, assigning an auto-increment id per table. Returns the row.
export function insert(table, row) {
  const next = (store._seq[table] || 0) + 1;
  store._seq[table] = next;
  const record = { id: next, ...row };
  store[table].push(record);
  save();
  return record;
}

export const all = (table) => store[table];
export const find = (table, fn) => store[table].find(fn);
export const filter = (table, fn) => store[table].filter(fn);

export function isEmpty() {
  return store.product.length === 0;
}
