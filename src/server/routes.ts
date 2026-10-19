import express, { type NextFunction, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { DATA_DIR, DB_FILE, closeDb, getDb, openDatabase, setDb } from '../db/database';
import { can, type Module, type Role, type SessionUser } from '../types/pharmacy';
import * as core from './core';
import { BizError, audit, daysLeft, expiryStatus, nowIso, todayStr } from './core';

declare module 'express-serve-static-core' {
  interface Request { user?: SessionUser }
}

const ROLES: Role[] = ['super_admin', 'pharmacist', 'cashier', 'warehouse_manager', 'doctor'];

function secret(): string {
  if (process.env.PHARMACY_SECRET) return process.env.PHARMACY_SECRET;
  const f = path.join(DATA_DIR, '.secret');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8');
}

const wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = fn(req, res);
    if (r !== undefined && !res.headersSent) res.json(r);
  } catch (e) { next(e); }
};

const int = (v: unknown) => Math.round(Number(v) || 0);
const actor = (req: Request) => ({ id: req.user!.id, role: req.user!.role, branch_id: req.user!.branch_id });

function needAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.token;
    if (!token) throw new BizError('Please sign in.', 'UNAUTHENTICATED', 401);
    const p = jwt.verify(token, secret()) as { id: number };
    const u = getDb().prepare('SELECT id,name,username,role,branch_id,specialty,lang FROM users WHERE id = ? AND active = 1').get(p.id) as SessionUser | undefined;
    if (!u) throw new BizError('Please sign in.', 'UNAUTHENTICATED', 401);
    if (!u.branch_id) u.branch_id = (getDb().prepare('SELECT id FROM branches ORDER BY id LIMIT 1').get() as any).id;
    req.user = u;
    next();
  } catch (e) {
    next(e instanceof BizError ? e : new BizError('Please sign in.', 'UNAUTHENTICATED', 401));
  }
}
const need = (...mods: Module[]) => (req: Request, _res: Response, next: NextFunction) =>
  mods.some((m) => can(req.user!.role, m)) ? next() : next(new BizError('You do not have permission for this action.', 'FORBIDDEN', 403));

export function createRouter() {
  const r = express.Router();
  const db = () => getDb();

  // ─────────── Auth / first-run ───────────
  r.get('/auth/status', wrap(() => {
    const c = (db().prepare('SELECT COUNT(*) c FROM users').get() as any).c;
    const name = (db().prepare("SELECT value FROM settings WHERE key='pharmacy_name'").get() as any)?.value ?? '';
    return { needsSetup: c === 0, pharmacyName: name };
  }));

  r.post('/auth/setup', wrap((req) => {
    const { name, username, password, pharmacy_name } = req.body ?? {};
    return db().transaction(() => {
      if ((db().prepare('SELECT COUNT(*) c FROM users').get() as any).c > 0) throw new BizError('Setup is already complete.', 'FORBIDDEN', 403);
      if (!name || !username || !password) throw new BizError('Name, username and password are required.');
      if (String(password).length < 8) throw new BizError('Password must be at least 8 characters.');
      const branch = (db().prepare('SELECT id FROM branches ORDER BY id LIMIT 1').get() as any).id;
      const id = Number(db().prepare('INSERT INTO users (name,username,password_hash,role,branch_id) VALUES (?,?,?,?,?)')
        .run(name, String(username).trim().toLowerCase(), bcrypt.hashSync(password, 10), 'super_admin', branch).lastInsertRowid);
      db().prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('pharmacy_name',?)").run(pharmacy_name || 'Pharmacy');
      audit(db(), { id, role: 'super_admin', branch_id: branch }, 'auth', 'SETUP', { username });
      return { ok: true };
    })();
  }));

  const attempts = new Map<string, { n: number; t: number }>();
  r.post('/auth/login', wrap((req, res) => {
    const { username, password } = req.body ?? {};
    const key = String(username ?? '').toLowerCase();
    const a = attempts.get(key);
    if (a && a.n >= 8 && Date.now() - a.t < 5 * 60_000) throw new BizError('Too many attempts. Try again in a few minutes.', 'RATE_LIMIT', 429);
    const u = db().prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(key) as any;
    if (!u || !bcrypt.compareSync(String(password ?? ''), u.password_hash)) {
      attempts.set(key, { n: (a && Date.now() - a.t < 5 * 60_000 ? a.n : 0) + 1, t: Date.now() });
      throw new BizError('Wrong username or password.', 'BAD_LOGIN', 401);
    }
    attempts.delete(key);
    res.cookie('token', jwt.sign({ id: u.id }, secret(), { expiresIn: '12h' }), { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 12 * 3600_000 });
    audit(db(), { id: u.id, role: u.role, branch_id: u.branch_id }, 'auth', 'LOGIN', {});
    return { ok: true };
  }));

  r.post('/auth/logout', wrap((_req, res) => { res.clearCookie('token'); return { ok: true }; }));

  r.use(needAuth);

  r.get('/auth/me', wrap((req) => {
    const name = (db().prepare("SELECT value FROM settings WHERE key='pharmacy_name'").get() as any)?.value ?? '';
    const shift = core.activeShift(db(), req.user!.id) ?? null;
    return { user: req.user, pharmacyName: name, shift };
  }));
  r.put('/auth/lang', wrap((req) => {
    const lang = ['en', 'ku', 'ar'].includes(req.body?.lang) ? req.body.lang : 'en';
    db().prepare('UPDATE users SET lang = ? WHERE id = ?').run(lang, req.user!.id);
    return { ok: true };
  }));
  r.put('/settings', need('users'), wrap((req) => {
    db().prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('pharmacy_name',?)").run(String(req.body?.pharmacy_name ?? '').slice(0, 80));
    audit(db(), actor(req), 'admin', 'SETTINGS_UPDATE', req.body);
    return { ok: true };
  }));

  // ─────────── Badges / dashboard ───────────
  const expiryCounts = (branch: number) => {
    const rows = db().prepare('SELECT expiry_date FROM batches WHERE branch_id = ? AND quantity > 0').all(branch) as { expiry_date: string }[];
    const c = { expired: 0, critical: 0, warning: 0, good: 0 };
    for (const b of rows) c[expiryStatus(daysLeft(b.expiry_date))]++;
    return c;
  };

  r.get('/badges', need('pos', 'products', 'adjust', 'expiry', 'receive', 'rtv', 'transfers', 'supplier'), wrap((req) => {
    const c = expiryCounts(req.user!.branch_id);
    return { expiry: c.expired + c.critical };
  }));

  r.get('/dashboard', need('dashboard'), wrap((req) => {
    const branch = req.user!.branch_id;
    const today = todayStr();
    const p = core.profitAndLoss(db(), today, today);
    const c = expiryCounts(branch);
    const customers = db().prepare('SELECT id FROM customers').all() as { id: number }[];
    let qarz = 0, overdue = 0;
    for (const cu of customers) {
      const b = core.customerBalance(db(), cu.id);
      if (b > 0) {
        qarz += b;
        const last = db().prepare(`SELECT MAX(d) d FROM (SELECT MAX(created_at) d FROM customer_payments WHERE customer_id=? UNION ALL
          SELECT MAX(created_at) FROM invoices WHERE customer_id=? AND qarz_amount>0)`).get(cu.id, cu.id) as any;
        if (last?.d && Date.now() - Date.parse(last.d) > 30 * 86400_000) overdue++;
      }
    }
    const products = (db().prepare('SELECT COUNT(*) c FROM products WHERE active=1').get() as any).c;
    const recent = db().prepare(`SELECT i.id, i.invoice_number, i.created_at, i.grand_total, i.payment_method, u.name cashier
      FROM invoices i JOIN users u ON u.id = i.user_id WHERE i.branch_id = ? ORDER BY i.id DESC LIMIT 8`).all(branch);
    const low = db().prepare(`SELECT p.brand_name, p.reorder_level, COALESCE(SUM(CASE WHEN b.expiry_date >= ? THEN b.quantity END),0) stock
      FROM products p LEFT JOIN batches b ON b.product_id = p.id AND b.branch_id = ? WHERE p.active=1
      GROUP BY p.id HAVING stock <= p.reorder_level ORDER BY stock ASC LIMIT 5`).all(today, branch) as any[];
    const lowCount = (db().prepare(`SELECT COUNT(*) c FROM (SELECT p.id, COALESCE(SUM(CASE WHEN b.expiry_date >= ? THEN b.quantity END),0) stock, p.reorder_level rl
      FROM products p LEFT JOIN batches b ON b.product_id = p.id AND b.branch_id = ? WHERE p.active=1 GROUP BY p.id) WHERE stock <= rl`).get(today, branch) as any).c;
    const suppliers = db().prepare('SELECT id, name FROM suppliers').all() as any[];
    const dueSuppliers = suppliers.map((s) => ({ name: s.name, balance: core.supplierBalance(db(), s.id) })).filter((s) => s.balance > 0);
    return {
      revenue: p.net_revenue, receipts: p.receipts, net_profit: p.net_profit,
      expired: c.expired, critical: c.critical, qarz, overdue_customers: overdue, products,
      recent, alerts: { low_stock: lowCount, low_items: low, expired: c.expired, critical: c.critical, overdue_customers: overdue,
        suppliers_due: dueSuppliers.length, suppliers_due_total: dueSuppliers.reduce((s, x) => s + x.balance, 0) },
    };
  }));

  // ─────────── Products / batches ───────────
  const productSelect = `
    SELECT p.*, COALESCE(s.stock,0) stock, COALESCE(s.total_stock,0) total_stock, COALESCE(s.loose,0) loose,
      s.nearest_expiry, f.selling_price price, f.purchase_price cost
    FROM products p
    LEFT JOIN (SELECT product_id,
        SUM(CASE WHEN expiry_date >= @today THEN quantity ELSE 0 END) stock, SUM(quantity) total_stock,
        SUM(CASE WHEN expiry_date >= @today THEN loose_units ELSE 0 END) loose,
        MIN(CASE WHEN expiry_date >= @today AND quantity > 0 THEN expiry_date END) nearest_expiry
      FROM batches WHERE branch_id = @branch GROUP BY product_id) s ON s.product_id = p.id
    LEFT JOIN batches f ON f.id = (SELECT id FROM batches WHERE product_id = p.id AND branch_id = @branch AND (quantity > 0 OR loose_units > 0) AND expiry_date >= @today
        ORDER BY expiry_date, id LIMIT 1)`;

  r.get('/products', wrap((req) => {
    const q = `%${String(req.query.q ?? '').trim()}%`;
    const cat = String(req.query.category ?? '');
    const page = Math.max(1, int(req.query.page) || 1);
    const size = Math.min(1000, Math.max(1, int(req.query.size) || 25));
    const lowOnly = req.query.low === '1';
    const where = `WHERE p.active = 1 AND (p.brand_name LIKE @q OR p.generic_name LIKE @q OR p.barcode LIKE @q)` +
      (cat ? ' AND p.category = @cat' : '') + (lowOnly ? ' AND COALESCE(s.stock,0) <= p.reorder_level' : '');
    const params = { today: todayStr(), branch: req.user!.branch_id, q, cat };
    const total = (db().prepare(`SELECT COUNT(*) c FROM (${productSelect} ${where})`).get(params) as any).c;
    const rows = db().prepare(`${productSelect} ${where} ORDER BY p.brand_name LIMIT ${size} OFFSET ${(page - 1) * size}`).all(params);
    return { rows, total, page, pages: Math.max(1, Math.ceil(total / size)) };
  }));

  r.get('/products/by-barcode/:code', wrap((req) => {
    const row = db().prepare(`${productSelect} WHERE p.active = 1 AND p.barcode = @code`).get({ today: todayStr(), branch: req.user!.branch_id, code: req.params.code });
    if (!row) throw new BizError('No medicine with this barcode.', 'NOT_FOUND', 404);
    return row;
  }));

  r.get('/categories', wrap(() => (db().prepare("SELECT DISTINCT category FROM products WHERE active=1 AND category IS NOT NULL AND category <> '' ORDER BY category").all() as any[]).map((x) => x.category)));

  const ean13 = () => {
    for (;;) {
      const base = '200' + String(crypto.randomInt(0, 1e9)).padStart(9, '0');
      let sum = 0;
      for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 ? 3 : 1);
      const code = base + ((10 - (sum % 10)) % 10);
      if (!db().prepare('SELECT 1 FROM products WHERE barcode = ?').get(code)) return code;
    }
  };
  r.get('/barcode/next', need('products'), wrap(() => ({ barcode: ean13() })));

  const productFields = (b: any) => ({
    barcode: String(b.barcode ?? '').trim() || null, brand_name: String(b.brand_name ?? '').trim(), generic_name: b.generic_name || null,
    category: b.category || null, manufacturer: b.manufacturer || null, dosage: b.dosage || null, form: b.form || null,
    unit: b.unit || 'tablet', shelf_rack: b.shelf_rack || null, is_rx: b.is_rx ? 1 : 0, reorder_level: int(b.reorder_level ?? 10),
    supplier_id: b.supplier_id ? int(b.supplier_id) : null,
    sheets_per_pack: Math.max(1, int(b.sheets_per_pack) || 1),
    sheet_price: b.sheet_price !== undefined && b.sheet_price !== null && String(b.sheet_price) !== '' && int(b.sheet_price) > 0 ? int(b.sheet_price) : null,
    tablets_per_sheet: Math.max(1, int(b.tablets_per_sheet) || 1),
    tablet_price: b.tablet_price !== undefined && b.tablet_price !== null && String(b.tablet_price) !== '' && int(b.tablet_price) > 0 ? int(b.tablet_price) : null,
  });
  const dupBarcode = (e: any) => { if (String(e?.code).startsWith('SQLITE_CONSTRAINT')) throw new BizError('This barcode is already used by another medicine.'); throw e; };

  r.post('/products', need('products'), wrap((req) => {
    const f = productFields(req.body);
    if (!f.brand_name) throw new BizError('Brand name is required.');
    if (!f.barcode) f.barcode = ean13();
    try {
      const id = Number(db().prepare(`INSERT INTO products (barcode,brand_name,generic_name,category,manufacturer,dosage,form,unit,shelf_rack,is_rx,reorder_level,supplier_id,sheets_per_pack,sheet_price,tablets_per_sheet,tablet_price)
        VALUES (@barcode,@brand_name,@generic_name,@category,@manufacturer,@dosage,@form,@unit,@shelf_rack,@is_rx,@reorder_level,@supplier_id,@sheets_per_pack,@sheet_price,@tablets_per_sheet,@tablet_price)`).run(f).lastInsertRowid);
      audit(db(), actor(req), 'products', 'PRODUCT_CREATE', { id, ...f });
      return { id };
    } catch (e) { return dupBarcode(e); }
  }));
  r.put('/products/:id', need('products'), wrap((req) => {
    const f = productFields(req.body);
    if (!f.brand_name) throw new BizError('Brand name is required.');
    if (!f.barcode) f.barcode = ean13();
    const before = db().prepare('SELECT * FROM products WHERE id = ?').get(req.params.id) as any;
    if (before && (int(before.sheets_per_pack) !== f.sheets_per_pack || int(before.tablets_per_sheet ?? 1) !== f.tablets_per_sheet)) {
      const open = db().prepare('SELECT COALESCE(SUM(loose_units),0) n FROM batches WHERE product_id = ?').get(req.params.id) as any;
      if (open.n > 0) throw new BizError('This medicine has an opened pack (loose sheets/tablets). Sell them before changing sheets per pack or tablets per sheet.');
    }
    try {
      db().prepare(`UPDATE products SET barcode=@barcode,brand_name=@brand_name,generic_name=@generic_name,category=@category,manufacturer=@manufacturer,
        dosage=@dosage,form=@form,unit=@unit,shelf_rack=@shelf_rack,is_rx=@is_rx,reorder_level=@reorder_level,supplier_id=@supplier_id,sheets_per_pack=@sheets_per_pack,sheet_price=@sheet_price,tablets_per_sheet=@tablets_per_sheet,tablet_price=@tablet_price WHERE id=@id`).run({ ...f, id: req.params.id });
    } catch (e) { return dupBarcode(e); }
    audit(db(), actor(req), 'products', 'PRODUCT_UPDATE', { before, after: f });
    return { ok: true };
  }));
  r.delete('/products/:id', need('products'), wrap((req) => {
    const used = db().prepare('SELECT 1 FROM invoice_items WHERE product_id = ? LIMIT 1').get(req.params.id);
    if (used) db().prepare('UPDATE products SET active = 0 WHERE id = ?').run(req.params.id);
    else db().prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    audit(db(), actor(req), 'products', 'PRODUCT_DELETE', { id: req.params.id, archived: !!used });
    return { ok: true };
  }));

  r.get('/products/:id/batches', need('pos', 'products', 'adjust', 'expiry', 'receive', 'rtv', 'transfers', 'supplier'), wrap((req) => (db().prepare('SELECT * FROM batches WHERE product_id = ? AND branch_id = ? ORDER BY expiry_date').all(req.params.id, req.user!.branch_id) as any[])
    .map((b) => ({ ...b, days_left: daysLeft(b.expiry_date), status: expiryStatus(daysLeft(b.expiry_date)) }))));
  r.put('/batches/:id', need('products'), wrap((req) => {
    const before = db().prepare('SELECT * FROM batches WHERE id = ?').get(req.params.id) as any;
    if (!before) throw new BizError('Batch not found.', 'NOT_FOUND', 404);
    const sp = int(req.body.selling_price);
    if (sp < 0) throw new BizError('Price cannot be negative.');
    db().prepare('UPDATE batches SET selling_price = ? WHERE id = ?').run(sp, before.id);
    audit(db(), actor(req), 'products', 'PRICE_CHANGE', { batch: before.id, before: before.selling_price, after: sp });
    return { ok: true };
  }));
  r.get('/batches', need('pos', 'products', 'adjust', 'expiry', 'receive', 'rtv', 'transfers', 'supplier'), wrap((req) => {
    const q = `%${String(req.query.q ?? '').trim()}%`;
    const supplier = int(req.query.supplier_id);
    const rows = db().prepare(`SELECT b.*, p.brand_name, p.dosage, p.generic_name FROM batches b JOIN products p ON p.id = b.product_id
      WHERE b.branch_id = ? AND b.quantity > 0 AND (p.brand_name LIKE ? OR b.batch_number LIKE ? OR p.barcode LIKE ?)
      ${supplier ? 'AND p.supplier_id = ' + supplier : ''} ORDER BY p.brand_name, b.expiry_date LIMIT 100`).all(req.user!.branch_id, q, q, q) as any[];
    return rows.map((b) => ({ ...b, days_left: daysLeft(b.expiry_date) }));
  }));
  r.get('/products/:id/alternatives', wrap((req) => {
    const p = db().prepare('SELECT generic_name FROM products WHERE id = ?').get(req.params.id) as any;
    if (!p?.generic_name) return [];
    return db().prepare(`${productSelect} WHERE p.active=1 AND p.id <> @id AND LOWER(p.generic_name) = LOWER(@g) AND COALESCE(s.stock,0) > 0 ORDER BY f.selling_price`)
      .all({ today: todayStr(), branch: req.user!.branch_id, id: req.params.id, g: p.generic_name });
  }));

  // ─────────── POS ───────────
  r.post('/checkout', need('pos'), wrap((req) => core.checkout(db(), actor(req), req.body)));
  r.get('/invoices', need('pos', 'returns', 'shifts', 'dashboard'), wrap((req) => {
    const q = `%${String(req.query.q ?? '').trim()}%`;
    return db().prepare(`SELECT DISTINCT i.id, i.invoice_number, i.created_at, i.grand_total, i.payment_method, c.name customer_name, u.name cashier
      FROM invoices i JOIN users u ON u.id = i.user_id LEFT JOIN customers c ON c.id = i.customer_id
      LEFT JOIN invoice_items ii ON ii.invoice_id = i.id LEFT JOIN products p ON p.id = ii.product_id
      WHERE i.branch_id = ? AND (i.invoice_number LIKE ? OR p.brand_name LIKE ?) ORDER BY i.id DESC LIMIT 50`).all(req.user!.branch_id, q, q);
  }));
  r.get('/invoices/:id', need('pos', 'returns', 'shifts', 'dashboard'), wrap((req) => {
    const inv = core.getInvoice(db(), int(req.params.id));
    if (!inv) throw new BizError('Invoice not found.', 'NOT_FOUND', 404);
    return inv;
  }));

  r.post('/returns', need('returns'), wrap((req) => core.createSalesReturn(db(), actor(req), req.body)));
  r.get('/returns', need('returns'), wrap(() => db().prepare(`SELECT r.*, i.invoice_number, u.name user_name FROM sales_returns r
    JOIN invoices i ON i.id = r.invoice_id JOIN users u ON u.id = r.user_id ORDER BY r.id DESC LIMIT 200`).all()));

  // ─────────── Prescriptions ───────────
  r.post('/prescriptions', need('doctor'), wrap((req) => {
    if (req.user!.role !== 'doctor') throw new BizError('Only doctors can send requests.', 'FORBIDDEN', 403);
    const b = req.body;
    if (!String(b.patient_name ?? '').trim()) throw new BizError('Patient name is required.');
    if (!['pharmacy', 'lab', 'both'].includes(b.destination)) throw new BizError('Choose a destination.');
    return db().transaction(() => {
      const id = Number(db().prepare('INSERT INTO prescriptions (doctor_id,destination,patient_name,patient_phone,patient_age,status,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(req.user!.id, b.destination, b.patient_name.trim(), b.patient_phone || null, b.patient_age ? int(b.patient_age) : null, 'sent', nowIso()).lastInsertRowid);
      for (const it of b.items ?? []) {
        db().prepare('INSERT INTO prescription_items (prescription_id,product_id,quantity,dose,instructions) VALUES (?,?,?,?,?)')
          .run(id, it.product_id, Math.max(1, int(it.quantity)), it.dose || null, it.instructions || null);
      }
      if (b.destination !== 'lab' && !(b.items ?? []).length) throw new BizError('Add at least one medicine for a pharmacy request.');
      audit(db(), actor(req), 'doctor', 'PRESCRIPTION_SEND', { id, patient: b.patient_name });
      return { id };
    })();
  }));
  r.get('/prescriptions', need('doctor'), wrap((req) => {
    const own = req.user!.role === 'doctor';
    const rows = db().prepare(`SELECT p.*, u.name doctor_name, u.specialty,
      (SELECT COUNT(*) FROM prescription_items WHERE prescription_id = p.id) item_count FROM prescriptions p JOIN users u ON u.id = p.doctor_id
      ${own ? 'WHERE p.doctor_id = ?' : "WHERE p.destination IN ('pharmacy','both')"} ORDER BY p.id DESC LIMIT 100`).all(...(own ? [req.user!.id] : []));
    return rows;
  }));
  r.get('/prescriptions/:id', need('doctor'), wrap((req) => {
    const p = db().prepare('SELECT p.*, u.name doctor_name FROM prescriptions p JOIN users u ON u.id = p.doctor_id WHERE p.id = ?').get(req.params.id) as any;
    if (!p) throw new BizError('Request not found.', 'NOT_FOUND', 404);
    if (req.user!.role === 'doctor' && p.doctor_id !== req.user!.id) throw new BizError('Not allowed.', 'FORBIDDEN', 403);
    p.items = db().prepare(`SELECT pi.*, pr.brand_name, pr.dosage FROM prescription_items pi JOIN products pr ON pr.id = pi.product_id WHERE pi.prescription_id = ?`).all(p.id);
    return p;
  }));

  // ─────────── Expiry ───────────
  r.get('/expiry', need('expiry', 'dashboard'), wrap((req) => {
    const rows = db().prepare(`SELECT b.*, p.brand_name, p.dosage, p.generic_name FROM batches b JOIN products p ON p.id = b.product_id
      WHERE b.branch_id = ? AND b.quantity > 0 ORDER BY b.expiry_date`).all(req.user!.branch_id) as any[];
    const items = rows.map((b) => { const d = daysLeft(b.expiry_date); return { ...b, days_left: d, status: expiryStatus(d), value: b.quantity * b.purchase_price }; });
    const counts = { expired: 0, critical: 0, warning: 0, good: 0 };
    items.forEach((i) => counts[i.status as keyof typeof counts]++);
    return { counts, items };
  }));

  // ─────────── Purchasing / suppliers ───────────
  r.get('/suppliers', need('pos', 'products', 'adjust', 'expiry', 'receive', 'rtv', 'transfers', 'supplier'), wrap(() => (db().prepare('SELECT * FROM suppliers ORDER BY name').all() as any[]).map((s) => ({ ...s, balance: core.supplierBalance(db(), s.id) }))));
  r.post('/suppliers', need('supplier', 'receive'), wrap((req) => {
    if (!String(req.body.name ?? '').trim()) throw new BizError('Supplier name is required.');
    const id = Number(db().prepare('INSERT INTO suppliers (name,phone) VALUES (?,?)').run(req.body.name.trim(), req.body.phone || null).lastInsertRowid);
    audit(db(), actor(req), 'supplier', 'SUPPLIER_CREATE', { id });
    return { id };
  }));
  r.get('/suppliers/:id/statement', need('supplier'), wrap((req) => {
    const id = int(req.params.id);
    const ev: { date: string; type: string; ref: string; debit: number; credit: number }[] = [];
    (db().prepare("SELECT * FROM purchase_invoices WHERE supplier_id=? AND status='approved' AND payment_type='credit'").all(id) as any[])
      .forEach((p) => ev.push({ date: p.approved_at, type: 'purchase', ref: p.invoice_number || `#${p.id}`, debit: p.total_cost, credit: 0 }));
    (db().prepare('SELECT * FROM supplier_payments WHERE supplier_id=?').all(id) as any[])
      .forEach((p) => ev.push(p.kind === 'old_invoice' ? { date: p.created_at, type: 'old_invoice', ref: p.note || `#${p.id}`, debit: p.amount, credit: 0 }
        : { date: p.created_at, type: 'payment', ref: p.note || `#${p.id}`, debit: 0, credit: p.amount }));
    (db().prepare('SELECT * FROM rtv WHERE supplier_id=?').all(id) as any[]).forEach((p) => ev.push({ date: p.created_at, type: 'rtv', ref: `RTV-${p.id}`, debit: 0, credit: p.total }));
    ev.sort((a, b) => a.date.localeCompare(b.date));
    let bal = 0;
    const rows = ev.map((e) => { bal += e.debit - e.credit; return { ...e, balance: bal }; });
    const purchases = db().prepare("SELECT id, invoice_number, total_cost, payment_type, approved_at FROM purchase_invoices WHERE supplier_id=? AND status='approved' ORDER BY id DESC").all(id);
    return { balance: bal, rows, purchases };
  }));
  r.post('/suppliers/:id/payments', need('supplier'), wrap((req) => {
    const amount = int(req.body.amount);
    if (amount <= 0) throw new BizError('Amount must be greater than zero.');
    const kind = req.body.kind === 'old_invoice' ? 'old_invoice' : 'payment';
    if (kind === 'payment' && amount > core.supplierBalance(db(), int(req.params.id))) throw new BizError('Payment is more than the amount owed to this supplier.');
    db().prepare('INSERT INTO supplier_payments (supplier_id,amount,kind,note,user_id,created_at) VALUES (?,?,?,?,?,?)')
      .run(req.params.id, amount, kind, req.body.note || null, req.user!.id, nowIso());
    audit(db(), actor(req), 'supplier', kind === 'payment' ? 'SUPPLIER_PAYMENT' : 'SUPPLIER_OLD_INVOICE', { supplier: req.params.id, amount });
    return { balance: core.supplierBalance(db(), int(req.params.id)) };
  }));
  r.post('/suppliers/:id/sync', need('supplier'), wrap((req) => ({ balance: core.supplierBalance(db(), int(req.params.id)) })));

  r.post('/purchases', need('receive'), wrap((req) => core.savePurchase(db(), actor(req), req.body)));
  r.get('/purchases', need('receive', 'supplier'), wrap((req) => db().prepare(`SELECT pi.*, s.name supplier_name FROM purchase_invoices pi JOIN suppliers s ON s.id = pi.supplier_id
    ${req.query.status ? 'WHERE pi.status = ?' : ''} ORDER BY pi.id DESC LIMIT 100`).all(...(req.query.status ? [String(req.query.status)] : []))));
  r.get('/purchases/:id', need('receive', 'supplier'), wrap((req) => {
    const p = db().prepare('SELECT * FROM purchase_invoices WHERE id = ?').get(req.params.id) as any;
    if (!p) throw new BizError('Purchase invoice not found.', 'NOT_FOUND', 404);
    p.items = db().prepare(`SELECT i.*, pr.brand_name, pr.dosage FROM purchase_invoice_items i JOIN products pr ON pr.id = i.product_id WHERE i.purchase_invoice_id = ?`).all(p.id);
    return p;
  }));
  r.delete('/purchases/:id', need('receive'), wrap((req) => {
    const p = db().prepare('SELECT status FROM purchase_invoices WHERE id = ?').get(req.params.id) as any;
    if (!p || p.status !== 'draft') throw new BizError('Only drafts can be deleted.');
    db().prepare('DELETE FROM purchase_invoices WHERE id = ?').run(req.params.id);
    return { ok: true };
  }));
  r.post('/rtv', need('rtv'), wrap((req) => core.createRtv(db(), actor(req), req.body)));
  r.get('/rtv', need('rtv'), wrap(() => db().prepare('SELECT r.*, s.name supplier_name FROM rtv r JOIN suppliers s ON s.id = r.supplier_id ORDER BY r.id DESC LIMIT 100').all()));

  // Smart auto-reorder: below reorder level, suggested qty from the last 30 days of sales.
  r.get('/reorder', need('products'), wrap((req) => {
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const rows = db().prepare(`${productSelect} WHERE p.active = 1 AND COALESCE(s.stock,0) <= p.reorder_level ORDER BY p.brand_name`)
      .all({ today: todayStr(), branch: req.user!.branch_id }) as any[];
    return rows.map((p) => {
      const sold = (db().prepare(`SELECT COALESCE(SUM(ii.quantity),0) q FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
        WHERE ii.product_id = ? AND i.created_at >= ?`).get(p.id, since) as any).q;
      const suggested = Math.max(p.reorder_level * 2 - p.stock, sold - p.stock, 1);
      const sup = p.supplier_id ? (db().prepare('SELECT name FROM suppliers WHERE id=?').get(p.supplier_id) as any)?.name : null;
      return { id: p.id, brand_name: p.brand_name, dosage: p.dosage, stock: p.stock, reorder_level: p.reorder_level, sold_30d: sold, suggested, supplier_id: p.supplier_id, supplier_name: sup ?? 'Unassigned', cost: p.cost ?? 0 };
    });
  }));

  // ─────────── Stock adjustment / transfers ───────────
  r.post('/adjustments', need('adjust'), wrap((req) => core.adjustStock(db(), actor(req), req.body)));
  r.get('/adjustments', need('adjust'), wrap(() => db().prepare(`SELECT a.*, p.brand_name, b.batch_number, u.name user_name FROM stock_adjustments a
    JOIN products p ON p.id = a.product_id JOIN batches b ON b.id = a.batch_id LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 100`).all()));

  r.get('/branches', need('pos', 'products', 'adjust', 'expiry', 'receive', 'rtv', 'transfers', 'supplier'), wrap(() => db().prepare('SELECT * FROM branches ORDER BY id').all()));
  r.post('/branches', need('branches'), wrap((req) => {
    if (!String(req.body.name ?? '').trim()) throw new BizError('Branch name is required.');
    const id = Number(db().prepare('INSERT INTO branches (name,address,phone) VALUES (?,?,?)').run(req.body.name.trim(), req.body.address || null, req.body.phone || null).lastInsertRowid);
    audit(db(), actor(req), 'branches', 'BRANCH_CREATE', { id });
    return { id };
  }));
  r.put('/branches/:id', need('branches'), wrap((req) => {
    db().prepare('UPDATE branches SET name=?, address=?, phone=? WHERE id=?').run(req.body.name, req.body.address || null, req.body.phone || null, req.params.id);
    audit(db(), actor(req), 'branches', 'BRANCH_UPDATE', { id: req.params.id });
    return { ok: true };
  }));

  r.get('/transfers', need('transfers'), wrap(() => {
    const rows = db().prepare(`SELECT t.*, f.name from_name, d.name to_name, u.name user_name FROM stock_transfers t
      JOIN branches f ON f.id = t.from_branch JOIN branches d ON d.id = t.to_branch LEFT JOIN users u ON u.id = t.user_id ORDER BY t.id DESC LIMIT 100`).all() as any[];
    return rows.map((t) => ({ ...t, items: db().prepare(`SELECT i.*, p.brand_name, b.batch_number FROM stock_transfer_items i JOIN products p ON p.id = i.product_id
      JOIN batches b ON b.id = i.batch_id WHERE i.transfer_id = ?`).all(t.id) }));
  }));
  r.post('/transfers', need('transfers'), wrap((req) => core.createTransfer(db(), actor(req), req.body)));
  r.post('/transfers/:id/:action', need('transfers'), wrap((req) => {
    const a = req.params.action as 'approve' | 'receive' | 'reject';
    if (!['approve', 'receive', 'reject'].includes(a)) throw new BizError('Unknown action.');
    return core.transitionTransfer(db(), actor(req), int(req.params.id), a);
  }));
  r.get('/branch-batches/:branch', need('transfers'), wrap((req) => db().prepare(`SELECT b.*, p.brand_name, p.dosage FROM batches b JOIN products p ON p.id = b.product_id
    WHERE b.branch_id = ? AND b.quantity > 0 AND b.expiry_date >= ? AND p.brand_name LIKE ? ORDER BY p.brand_name LIMIT 100`)
    .all(req.params.branch, todayStr(), `%${String(req.query.q ?? '')}%`)));

  // ─────────── Customers ───────────
  r.get('/customers', need('customers', 'pos'), wrap((req) => {
    const q = `%${String(req.query.q ?? '').trim()}%`;
    const rows = db().prepare('SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY name LIMIT 300').all(q, q) as any[];
    return rows.map((c) => {
      const last = db().prepare('SELECT MAX(created_at) d FROM customer_payments WHERE customer_id = ?').get(c.id) as any;
      const lastQarz = db().prepare('SELECT MAX(created_at) d FROM invoices WHERE customer_id = ? AND qarz_amount > 0').get(c.id) as any;
      const balance = core.customerBalance(db(), c.id);
      const ref = last.d ?? lastQarz.d;
      return { ...c, balance, last_payment: last.d, overdue: balance > 0 && !!ref && Date.now() - Date.parse(ref) > 30 * 86400_000 };
    });
  }));
  r.post('/customers', need('customers', 'pos'), wrap((req) => {
    if (!String(req.body.name ?? '').trim()) throw new BizError('Customer name is required.');
    const id = Number(db().prepare('INSERT INTO customers (name,phone,notes) VALUES (?,?,?)').run(req.body.name.trim(), req.body.phone || null, req.body.notes || null).lastInsertRowid);
    audit(db(), actor(req), 'customers', 'CUSTOMER_CREATE', { id });
    return { id };
  }));
  r.put('/customers/:id', need('customers'), wrap((req) => {
    db().prepare('UPDATE customers SET name=?, phone=?, notes=? WHERE id=?').run(req.body.name, req.body.phone || null, req.body.notes || null, req.params.id);
    return { ok: true };
  }));
  r.get('/customers/:id', need('customers'), wrap((req) => {
    const id = int(req.params.id);
    const c = db().prepare('SELECT * FROM customers WHERE id = ?').get(id) as any;
    if (!c) throw new BizError('Customer not found.', 'NOT_FOUND', 404);
    const ev: any[] = [];
    (db().prepare("SELECT id, invoice_number, created_at, qarz_amount FROM invoices WHERE customer_id=? AND qarz_amount>0 AND status='completed'").all(id) as any[])
      .forEach((i) => ev.push({ date: i.created_at, type: 'sale', ref: i.invoice_number, debit: i.qarz_amount, credit: 0 }));
    (db().prepare('SELECT * FROM customer_payments WHERE customer_id=?').all(id) as any[])
      .forEach((p) => ev.push({ date: p.created_at, type: 'payment', ref: `PAY-${p.id}`, note: p.note, method: p.method, debit: 0, credit: p.amount, payment_id: p.id }));
    (db().prepare("SELECT r.* , i.invoice_number FROM sales_returns r JOIN invoices i ON i.id = r.invoice_id WHERE i.customer_id=? AND r.refund_method='qarz'").all(id) as any[])
      .forEach((x) => ev.push({ date: x.created_at, type: 'return', ref: x.invoice_number, debit: 0, credit: x.total }));
    ev.sort((a, b) => a.date.localeCompare(b.date));
    return { customer: c, balance: ev.reduce((s, e) => s + e.debit - e.credit, 0), rows: (() => { let b = 0; return ev.map((e) => ({ ...e, balance: (b += e.debit - e.credit) })); })() };
  }));
  r.post('/customers/:id/payments', need('customers'), wrap((req) => core.recordCustomerPayment(db(), actor(req), { ...req.body, customer_id: int(req.params.id) })));

  // ─────────── Shifts ───────────
  r.get('/shifts/current', wrap((req) => {
    const s = core.activeShift(db(), req.user!.id);
    return s ? core.shiftSummary(db(), s.id) : null;
  }));
  r.post('/shifts/open', need('shifts', 'pos'), wrap((req) => core.openShift(db(), actor(req), req.body.opening_cash)));
  r.post('/shifts/close', need('shifts', 'pos'), wrap((req) => core.closeShift(db(), actor(req), req.body.counted_cash)));
  r.get('/shifts', need('shifts'), wrap((req) => {
    const own = req.user!.role === 'cashier';
    return db().prepare(`SELECT s.*, u.name user_name FROM shifts s JOIN users u ON u.id = s.user_id ${own ? 'WHERE s.user_id = ?' : ''} ORDER BY s.id DESC LIMIT 60`)
      .all(...(own ? [req.user!.id] : []));
  }));
  r.get('/shifts/:id', need('shifts'), wrap((req) => {
    const s = core.shiftSummary(db(), int(req.params.id));
    if (!s) throw new BizError('Shift not found.', 'NOT_FOUND', 404);
    if (req.user!.role === 'cashier' && s.user_id !== req.user!.id) throw new BizError('Not allowed.', 'FORBIDDEN', 403);
    const invoices = db().prepare('SELECT id, invoice_number, created_at, grand_total, payment_method, cash_amount, card_amount, qarz_amount FROM invoices WHERE shift_id = ? ORDER BY id DESC').all(s.id);
    return { ...s, invoices, pharmacy: (db().prepare("SELECT value FROM settings WHERE key='pharmacy_name'").get() as any)?.value };
  }));

  // ─────────── Accounting ───────────
  r.get('/pnl', need('accounting'), wrap((req) => {
    const from = String(req.query.from || todayStr(new Date(Date.now() - 29 * 86400_000)));
    const to = String(req.query.to || todayStr());
    const total = core.profitAndLoss(db(), from, to);
    const series: any[] = [];
    const start = new Date(from + 'T00:00:00'), end = new Date(to + 'T00:00:00');
    for (let d = new Date(start); d <= end && series.length < 400; d.setDate(d.getDate() + 1)) {
      const day = todayStr(d);
      const p = core.profitAndLoss(db(), day, day);
      series.push({ date: day, revenue: p.net_revenue, profit: p.net_profit });
    }
    return { ...total, series };
  }));
  r.get('/expenses', need('accounting'), wrap((req) => db().prepare('SELECT * FROM expenses WHERE date BETWEEN ? AND ? ORDER BY date DESC, id DESC')
    .all(String(req.query.from || '0000-01-01'), String(req.query.to || '9999-12-31'))));
  r.post('/expenses', need('accounting'), wrap((req) => {
    const amount = int(req.body.amount);
    if (amount <= 0) throw new BizError('Amount must be greater than zero.');
    if (!['rent', 'salaries', 'utilities', 'other'].includes(req.body.category)) throw new BizError('Choose a category.');
    const id = Number(db().prepare('INSERT INTO expenses (category,amount,note,date,user_id) VALUES (?,?,?,?,?)')
      .run(req.body.category, amount, req.body.note || null, req.body.date || todayStr(), req.user!.id).lastInsertRowid);
    audit(db(), actor(req), 'accounting', 'EXPENSE_ADD', { id, amount, category: req.body.category });
    return { id };
  }));

  // ─────────── Users / audit / backup ───────────
  r.get('/users', need('users'), wrap(() => db().prepare(`SELECT u.id,u.name,u.username,u.role,u.branch_id,u.specialty,u.active,b.name branch_name FROM users u LEFT JOIN branches b ON b.id = u.branch_id ORDER BY u.id`).all()));
  r.post('/users', need('users'), wrap((req) => {
    const b = req.body;
    if (!ROLES.includes(b.role)) throw new BizError('Choose a role.');
    if (!b.name || !b.username || !b.password) throw new BizError('Name, username and password are required.');
    if (String(b.password).length < 8) throw new BizError('Password must be at least 8 characters.');
    try {
      const id = Number(db().prepare('INSERT INTO users (name,username,password_hash,role,branch_id,specialty) VALUES (?,?,?,?,?,?)')
        .run(b.name, String(b.username).trim().toLowerCase(), bcrypt.hashSync(b.password, 10), b.role, b.branch_id || null, b.role === 'doctor' ? b.specialty || null : null).lastInsertRowid);
      audit(db(), actor(req), 'users', 'USER_CREATE', { id, username: b.username, role: b.role });
      return { id };
    } catch (e: any) { if (String(e?.code).startsWith('SQLITE_CONSTRAINT')) throw new BizError('This username is already taken.'); throw e; }
  }));
  r.put('/users/:id', need('users'), wrap((req) => {
    const b = req.body;
    const id = int(req.params.id);
    if (id === req.user!.id && (b.active === false || b.active === 0 || (b.role && b.role !== 'super_admin'))) throw new BizError('You cannot deactivate or demote your own account.');
    if (b.role && !ROLES.includes(b.role)) throw new BizError('Choose a role.');
    const u = db().prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    if (!u) throw new BizError('User not found.', 'NOT_FOUND', 404);
    db().prepare('UPDATE users SET name=?, role=?, branch_id=?, specialty=?, active=? WHERE id=?')
      .run(b.name ?? u.name, b.role ?? u.role, b.branch_id ?? u.branch_id, b.specialty ?? u.specialty, b.active === undefined ? u.active : (b.active ? 1 : 0), id);
    if (b.password) {
      if (String(b.password).length < 8) throw new BizError('Password must be at least 8 characters.');
      db().prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(b.password, 10), id);
      audit(db(), actor(req), 'users', 'PASSWORD_RESET', { id });
    }
    audit(db(), actor(req), 'users', 'USER_UPDATE', { id, role: b.role, active: b.active });
    return { ok: true };
  }));

  r.get('/audit', need('audit'), wrap((req) => {
    const where: string[] = []; const params: any[] = [];
    if (req.query.user) { where.push('a.user_id = ?'); params.push(req.query.user); }
    if (req.query.module) { where.push('a.module = ?'); params.push(req.query.module); }
    if (req.query.from) { where.push('a.ts >= ?'); params.push(new Date(String(req.query.from) + 'T00:00:00').toISOString()); }
    if (req.query.to) { where.push('a.ts <= ?'); params.push(new Date(String(req.query.to) + 'T23:59:59.999').toISOString()); }
    return db().prepare(`SELECT a.*, u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.id DESC LIMIT 300`).all(...params);
  }));

  r.get('/backup', need('users'), async (req, res, next) => {
    const tmp = path.join(os.tmpdir(), `pharmacy-backup-${Date.now()}.db`);
    try {
      await db().backup(tmp);
      audit(db(), actor(req), 'admin', 'BACKUP_EXPORT', {});
      res.download(tmp, `pharmacy-backup-${todayStr()}.db`, () => fs.rm(tmp, () => {}));
    } catch (e) { next(e); }
  });
  r.post('/restore', need('users'), express.raw({ type: '*/*', limit: '512mb' }), wrap((req) => {
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.length < 100 || buf.subarray(0, 15).toString() !== 'SQLite format 3') throw new BizError('This is not a valid backup file.');
    const tmp = path.join(os.tmpdir(), `pharmacy-restore-${Date.now()}.db`);
    fs.writeFileSync(tmp, buf);
    try {
      const probe = new Database(tmp, { readonly: true });
      const ok = probe.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE name IN ('users','products','invoices')").get() as any;
      probe.close();
      if (ok.c !== 3) throw new BizError('This file is not a pharmacy backup.');
    } catch (e) { fs.rmSync(tmp, { force: true }); throw e instanceof BizError ? e : new BizError('This is not a valid backup file.'); }
    audit(db(), actor(req), 'admin', 'BACKUP_RESTORE', { bytes: buf.length });
    closeDb();
    for (const ext of ['', '-wal', '-shm']) fs.rmSync(DB_FILE + ext, { force: true });
    fs.copyFileSync(tmp, DB_FILE);
    fs.rmSync(tmp, { force: true });
    setDb(openDatabase(DB_FILE));
    return { ok: true };
  }));

  r.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof BizError) return res.status(err.status).json({ error: err.message, code: err.code });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.', code: 'SERVER_ERROR' });
  });
  return r;
}
