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
