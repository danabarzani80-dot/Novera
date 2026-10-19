import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.PHARMACY_DATA_DIR || path.resolve(here, '../../data');
export const DB_FILE = process.env.PHARMACY_DB || path.join(DATA_DIR, 'pharmacy.db');

export type DB = Database.Database;

export function openDatabase(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  // Migrations (safe to run on every start): sell by pack or by sheet.
  const addCol = (table: string, col: string, def: string) => {
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  };
  addCol('products', 'sheets_per_pack', 'INTEGER NOT NULL DEFAULT 1');
  addCol('products', 'sheet_price', 'INTEGER');
  addCol('products', 'tablets_per_sheet', 'INTEGER NOT NULL DEFAULT 1');
  addCol('products', 'tablet_price', 'INTEGER');
  // Opened packs: loose stock counted in the smallest unit (tablets, or sheets when tablets_per_sheet = 1).
  addCol('batches', 'loose_units', 'INTEGER NOT NULL DEFAULT 0');
  addCol('invoice_items', 'sale_unit', "TEXT NOT NULL DEFAULT 'pack'");
  addCol('invoice_items', 'unit_size', 'INTEGER NOT NULL DEFAULT 1'); // smallest units in one sold unit
  addCol('invoice_items', 'pack_size', 'INTEGER NOT NULL DEFAULT 1'); // smallest units in one pack
  const hasBranch = db.prepare('SELECT COUNT(*) c FROM branches').get() as { c: number };
  if (hasBranch.c === 0) db.prepare("INSERT INTO branches (name) VALUES ('Main Branch')").run();
  return db;
}

// Holder allows the live database to be swapped after a restore.
let current: DB | null = null;
export function getDb(): DB {
  if (!current) current = openDatabase(DB_FILE);
  return current;
}
export function setDb(db: DB) {
  current = db;
}
export function closeDb() {
  current?.close();
  current = null;
}
