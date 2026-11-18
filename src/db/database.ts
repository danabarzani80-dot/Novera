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
    if (!cols.includes(col)) { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); return true; }
    return false;
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
  // Allow the 'accountant' role on databases created before it existed (SQLite cannot alter a CHECK,
  // so the users table is rebuilt once; no other table references users by foreign key).
  const usersSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as { sql: string } | undefined)?.sql ?? '';
  if (usersSql && !usersSql.includes("'accountant'")) {
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(`CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('super_admin','pharmacist','cashier','warehouse_manager','doctor','accountant')),
        branch_id INTEGER REFERENCES branches(id), specialty TEXT, lang TEXT DEFAULT 'en',
        active INTEGER NOT NULL DEFAULT 1
      );
      INSERT INTO users_new (id, name, username, password_hash, role, branch_id, specialty, lang, active)
        SELECT id, name, username, password_hash, role, branch_id, specialty, lang, active FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;`);
    })();
    db.pragma('foreign_keys = ON');
  }
  const hasBranch = db.prepare('SELECT COUNT(*) c FROM branches').get() as { c: number };
  if (hasBranch.c === 0) db.prepare("INSERT INTO branches (name) VALUES ('Main Branch')").run();
  // Branch separation: each branch is run as its own pharmacy. Everything that existed before
  // this change belongs to the first branch (the original pharmacy).
  const first = (db.prepare('SELECT MIN(id) id FROM branches').get() as { id: number }).id;
  db.transaction(() => {
    // Per-branch switch: may staff type a different price at the till? Off by default (Novera stays fixed).
    addCol('branches', 'flexible_prices', 'INTEGER NOT NULL DEFAULT 0');
    for (const t of ['suppliers', 'customers', 'expenses', 'rtv']) {
      if (addCol(t, 'branch_id', 'INTEGER')) db.prepare(`UPDATE ${t} SET branch_id = ?`).run(first);
    }
    const done = db.prepare("SELECT value FROM settings WHERE key = 'migr_product_branch'").get();
    if (!done) {
      db.prepare(`INSERT OR IGNORE INTO product_branch (product_id, branch_id, sheet_price, tablet_price, reorder_level, supplier_id)
        SELECT id, ?, sheet_price, tablet_price, reorder_level, supplier_id FROM products`).run(first);
      db.prepare("INSERT INTO settings (key, value) VALUES ('migr_product_branch', '1')").run();
    }
  })();
  // One-time: make every stored price payable in Iraqi notes (nearest 250 IQD, halves up, at least 250).
  if (!db.prepare("SELECT value FROM settings WHERE key = 'migr_round_250'").get()) {
    const r = (c: string) => `CASE WHEN ${c} > 0 AND ${c} % 250 <> 0 THEN MAX(250, ((${c} + 125) / 250) * 250) ELSE ${c} END`;
    db.transaction(() => {
      const before = db.prepare("SELECT id, branch_id, selling_price FROM batches WHERE selling_price > 0 AND selling_price % 250 <> 0").all();
      const pb = db.prepare("SELECT product_id, branch_id, sheet_price, tablet_price FROM product_branch WHERE (sheet_price > 0 AND sheet_price % 250 <> 0) OR (tablet_price > 0 AND tablet_price % 250 <> 0)").all();
      db.exec(`UPDATE batches SET selling_price = ${r('selling_price')};
        UPDATE product_branch SET sheet_price = ${r('sheet_price')}, tablet_price = ${r('tablet_price')};
        UPDATE products SET sheet_price = ${r('sheet_price')}, tablet_price = ${r('tablet_price')};`);
      db.prepare("INSERT INTO settings (key, value) VALUES ('migr_round_250', '1')").run();
      if (before.length || pb.length)
        db.prepare("INSERT INTO audit_logs (ts, user_id, role, module, action_code, details_json) VALUES (?, NULL, 'system', 'products', 'PRICES_ROUNDED_250', ?)")
          .run(new Date().toISOString(), JSON.stringify({ batches: before, sheet_tablet: pb }));
    })();
  }
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
