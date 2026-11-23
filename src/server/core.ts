import type { DB } from '../db/database';
import { DISCOUNT_ROLES, NOTE_STEP, roundNote, checkDiscount, cleanPct, discountCap, discountSettingKey, type DiscountRole } from '../lib/discount';

export class BizError extends Error {
  status: number;
  code: string;
  constructor(message: string, code = 'BUSINESS_RULE', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface Actor { id: number; role: string; branch_id: number }

export const nowIso = () => new Date().toISOString();
export const todayStr = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const int = (v: unknown) => Math.round(Number(v) || 0);

export function audit(db: DB, actor: Actor | null, module: string, action: string, details: unknown = {}) {
  db.prepare('INSERT INTO audit_logs (ts, user_id, role, module, action_code, details_json) VALUES (?,?,?,?,?,?)')
    .run(nowIso(), actor?.id ?? null, actor?.role ?? null, module, action, JSON.stringify(details));
}

/** Each branch is a separate pharmacy: a row that belongs to another branch is treated as not found. */
export function assertBranch(db: DB, table: 'suppliers' | 'customers' | 'batches' | 'invoices' | 'purchase_invoices' | 'shifts' | 'rtv' | 'expenses',
  id: unknown, branchId: number, what: string) {
  const row = db.prepare(`SELECT branch_id FROM ${table} WHERE id = ?`).get(id) as { branch_id: number } | undefined;
  if (!row || row.branch_id !== branchId) throw new BizError(`${what} not found.`, 'NOT_FOUND', 404);
}

export function activeShift(db: DB, userId: number): { id: number; opened_at: string; opening_cash: number } | undefined {
  return db.prepare('SELECT id, opened_at, opening_cash FROM shifts WHERE user_id = ? AND closed_at IS NULL ORDER BY id DESC LIMIT 1')
    .get(userId) as any;
}

// ───────────────────────── Customers / Suppliers balances ─────────────────────────
export function customerBalance(db: DB, customerId: number): number {
  const r = db.prepare(`SELECT
    COALESCE((SELECT SUM(qarz_amount) FROM invoices WHERE customer_id = @c AND status = 'completed'),0)
  - COALESCE((SELECT SUM(amount) FROM customer_payments WHERE customer_id = @c),0)
  - COALESCE((SELECT SUM(r.total) FROM sales_returns r JOIN invoices i ON i.id = r.invoice_id
              WHERE i.customer_id = @c AND r.refund_method = 'qarz'),0) AS bal`).get({ c: customerId }) as { bal: number };
  return r.bal;
}

export function supplierBalance(db: DB, supplierId: number): number {
  const r = db.prepare(`SELECT
    COALESCE((SELECT SUM(total_cost) FROM purchase_invoices WHERE supplier_id = @s AND status='approved' AND payment_type='credit'),0)
  + COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE supplier_id = @s AND kind='old_invoice'),0)
  - COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE supplier_id = @s AND kind='payment'),0)
  - COALESCE((SELECT SUM(total) FROM rtv WHERE supplier_id = @s),0) AS bal`).get({ s: supplierId }) as { bal: number };
  return r.bal;
}

// ───────────────────────── Checkout (FEFO) ─────────────────────────
export interface CheckoutInput {
  items: { product_id: number; quantity: number; batch_id?: number; unit_price?: number; unit?: 'pack' | 'sheet' | 'tablet' }[];
  customer_id?: number | null;
  payment_method: 'cash' | 'card' | 'mixed' | 'qarz';
  cash_received?: number;
  card_amount?: number;
  discount_pct?: number;
  discount_amount?: number;
  extra_amount?: number; // no longer allowed: selling above the catalogue price is blocked
  prescription_id?: number | null;
}

// ───────────────────────── Discount limits ─────────────────────────
/** Max discount % for a role, from Settings. Admin is unlimited (100). Unset or other roles = 0. */
export function maxDiscountPct(db: DB, role: string): number {
  if (role === 'super_admin') return 100;
  if (!(DISCOUNT_ROLES as readonly string[]).includes(role)) return 0;
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(discountSettingKey(role as DiscountRole)) as any;
  return cleanPct(row?.value);
}

export function getDiscountLimits(db: DB): Record<DiscountRole, number> {
  return Object.fromEntries(DISCOUNT_ROLES.map((r) => [r, maxDiscountPct(db, r)])) as Record<DiscountRole, number>;
}

export function setDiscountLimits(db: DB, actor: Actor, input: Partial<Record<DiscountRole, unknown>>) {
  if (actor.role !== 'super_admin') throw new BizError('Only the admin can change discount limits.', 'FORBIDDEN', 403);
  const before = getDiscountLimits(db);
  for (const r of DISCOUNT_ROLES) {
    if (input[r] === undefined) continue;
    const n = Number(input[r]);
    if (!Number.isInteger(n) || n < 0 || n > 100) throw new BizError(`Maximum discount for ${r} must be a whole number from 0 to 100.`);
    db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(discountSettingKey(r), String(n));
  }
  const after = getDiscountLimits(db);
  audit(db, actor, 'admin', 'DISCOUNT_LIMITS_UPDATE', { before, after });
  return after;
}

export function checkout(db: DB, actor: Actor, input: CheckoutInput) {
  return db.transaction(() => {
    const shift = activeShift(db, actor.id);
    if (!shift) throw new BizError('Open a shift before selling.', 'NO_SHIFT');
    if (!input.items?.length) throw new BizError('The receipt is empty.');
    if (input.customer_id) assertBranch(db, 'customers', input.customer_id, actor.branch_id, 'Customer');
    const today = todayStr();

    type Unit = 'pack' | 'sheet' | 'tablet';
    type Line = { product_id: number; batch_id: number; quantity: number; unit_price: number; purchase_price: number; total: number; sale_unit: Unit; unit_size: number; pack_size: number };
    const lines: Line[] = [];
    // Flexible prices: only in a branch where the admin has switched it on (Link while its prices are being checked).
    const flexible = !!(db.prepare('SELECT flexible_prices f FROM branches WHERE id = ?').get(actor.branch_id) as any)?.f;
    const priceChanges: { product_id: number; unit: string; list_price: number; sold_price: number }[] = [];
    // Aggregate requested quantity per product + unit (+ explicit batch). Quantity is in the chosen unit.
    const wanted = new Map<string, { product_id: number; batch_id?: number; quantity: number; unit_price?: number; unit: Unit }>();
    for (const it of input.items) {
      const q = int(it.quantity);
      if (q <= 0) throw new BizError('Quantity must be greater than zero.');
      const unit: Unit = it.unit === 'sheet' || it.unit === 'tablet' ? it.unit : 'pack';
      // Price typed at the till: only allowed where the branch has flexible prices switched on.
      // Elsewhere the catalogue price is always used, and a discount within the admin-set limit is the only way to lower a sale.
      let override: number | undefined;
      if (it.unit_price !== undefined && it.unit_price !== null && String(it.unit_price) !== '') {
        if (!flexible) throw new BizError('Prices cannot be changed at the till. Use a discount within your limit instead.', 'FORBIDDEN', 403);
        override = Number(it.unit_price);
        if (!Number.isInteger(override) || override <= 0) throw new BizError('Price must be a whole amount above zero.', 'PRICE_INVALID');
        if (override % NOTE_STEP !== 0) throw new BizError(`Price must be in steps of ${NOTE_STEP} IQD.`, 'PRICE_INVALID');
      }
      const key = `${it.product_id}:${it.batch_id ?? ''}:${unit}`;
      const w = wanted.get(key);
      if (w) { w.quantity += q; if (override !== undefined) w.unit_price = override; }
      else wanted.set(key, { product_id: it.product_id, batch_id: it.batch_id, quantity: q, unit_price: override, unit });
    }

    // In-memory stock per batch for this sale, so packs, sheets and tablets of the same medicine never oversell.
    const state = new Map<number, { packs: number; loose: number }>();
    const st = (b: any) => { let x = state.get(b.id); if (!x) { x = { packs: b.quantity, loose: b.loose_units ?? 0 }; state.set(b.id, x); } return x; };

    for (const w of wanted.values()) {
      const product = db.prepare(`SELECT p.id, p.brand_name, p.sheets_per_pack, p.tablets_per_sheet, pb.sheet_price, pb.tablet_price FROM products p
        LEFT JOIN product_branch pb ON pb.product_id = p.id AND pb.branch_id = ? WHERE p.id = ? AND p.active = 1`).get(actor.branch_id, w.product_id) as any;
      if (!product) throw new BizError('Medicine not found.', 'NOT_FOUND', 404);
      const spp = Math.max(1, int(product.sheets_per_pack) || 1);
      const tps = Math.max(1, int(product.tablets_per_sheet) || 1);
      const pack = spp * tps; // smallest units (tablets, or sheets) in one pack
      // A unit that does not exist for this medicine falls back to the next bigger one.
      let unit: Unit = w.unit;
      if (unit === 'tablet' && tps === 1) unit = 'sheet';
      if (unit === 'sheet' && spp === 1) unit = 'pack';
      const size = unit === 'pack' ? pack : unit === 'sheet' ? tps : 1;
      const avail = (b: any) => { const x = st(b); return unit === 'pack' ? x.packs : Math.floor((x.packs * pack + x.loose) / size); };
      const take = (b: any, n: number) => {
        const x = st(b);
        if (unit === 'pack') { x.packs -= n; return; }
        let need = n * size;
        const fromLoose = Math.min(need, x.loose); x.loose -= fromLoose; need -= fromLoose;
        if (need > 0) { const open = Math.ceil(need / pack); x.packs -= open; x.loose += open * pack - need; }
      };
      // Every price is payable in notes: pack, sheet and tablet prices are rounded to 250 IQD.
      const defaultPrice = (b: any) => roundNote(unit === 'pack' ? b.selling_price
        : unit === 'sheet' ? (product.sheet_price ?? b.selling_price / spp)
        : (product.tablet_price ?? b.selling_price / pack));
      const priceOf = (b: any) => w.unit_price ?? defaultPrice(b);
      const costOf = (b: any) => (b.purchase_price * size) / pack;
      const push = (b: any, n: number) => {
        const price = priceOf(b);
        if (w.unit_price !== undefined && w.unit_price !== defaultPrice(b) && !priceChanges.some((c) => c.product_id === w.product_id && c.unit === unit))
          priceChanges.push({ product_id: w.product_id, unit, list_price: defaultPrice(b), sold_price: w.unit_price });
        lines.push({ product_id: w.product_id, batch_id: b.id, quantity: n, unit_price: price, purchase_price: costOf(b), total: Math.round(price * n), sale_unit: unit, unit_size: size, pack_size: pack });
        take(b, n);
      };

      if (w.batch_id) {
        const b = db.prepare('SELECT * FROM batches WHERE id = ? AND product_id = ? AND branch_id = ?')
          .get(w.batch_id, w.product_id, actor.branch_id) as any;
        if (!b) throw new BizError('Batch not found.', 'NOT_FOUND', 404);
        if (b.expiry_date < today) {
          throw new BizError(`Sale blocked: batch ${b.batch_number} of ${product.brand_name} is expired (${b.expiry_date}).`, 'EXPIRED_BATCH');
        }
        if (avail(b) < w.quantity) throw new BizError(`Not enough stock in batch ${b.batch_number} of ${product.brand_name}.`, 'NO_STOCK');
        push(b, w.quantity);
        continue;
      }

      // FEFO: earliest expiry first among non-expired batches.
      const batches = db.prepare(
        `SELECT * FROM batches WHERE product_id = ? AND branch_id = ? AND (quantity > 0 OR loose_units > 0) AND expiry_date >= ?
         ORDER BY expiry_date ASC, id ASC`).all(w.product_id, actor.branch_id, today) as any[];
      let remaining = w.quantity;
      for (const b of batches) {
        if (remaining <= 0) break;
        const n = Math.min(remaining, avail(b));
        if (n <= 0) continue;
        push(b, n);
        remaining -= n;
      }
      if (remaining > 0) {
        const expired = db.prepare('SELECT COALESCE(SUM(quantity + loose_units),0) q FROM batches WHERE product_id = ? AND branch_id = ? AND expiry_date < ? AND (quantity > 0 OR loose_units > 0)')
          .get(w.product_id, actor.branch_id, today) as any;
        if (expired.q > 0) {
          throw new BizError(`Sale blocked: only expired stock remains for ${product.brand_name}. Expired batches cannot be sold.`, 'EXPIRED_BATCH');
        }
        throw new BizError(`Not enough stock for ${product.brand_name}.`, 'NO_STOCK');
      }
    }

    const subtotal = lines.reduce((s, l) => s + l.total, 0);
    // Discounts: dinars only, in 250 IQD steps, up to the role's cap (subtotal × role %, rounded down to 250).
    // discount_pct is never used — the till only sends a dinar amount.
    const discount = input.discount_amount === undefined || input.discount_amount === null ? 0 : Number(input.discount_amount);
    const pctLimit = maxDiscountPct(db, actor.role);
    const cap = discountCap(subtotal, actor.role, pctLimit);
    const problem = checkDiscount(discount, cap);
    if (problem === 'not_whole') throw new BizError('Discount must be a whole dinar amount.', 'DISCOUNT_INVALID');
    if (problem === 'step') throw new BizError(`Discount must be in steps of ${NOTE_STEP} IQD.`, 'DISCOUNT_INVALID');
    if (problem === 'cap') {
      throw new BizError(cap === 0
        ? 'You are not allowed to give a discount on this sale.'
        : `Discount is above your limit. The most you can give on this sale is ${cap.toLocaleString('en-US')} IQD.`, 'DISCOUNT_OVER_LIMIT');
    }
    // Nobody may charge more than the catalogue price ("sell at the amount received" was removed).
    if (int(input.extra_amount) !== 0) throw new BizError('Selling above the price is not allowed.', 'FORBIDDEN', 403);
    const extra = 0;
    const grand = subtotal - discount;

    let cash = 0, card = 0, qarz = 0, received = 0, change = 0;
    const method = input.payment_method;
    if (method === 'cash') {
      received = int(input.cash_received) || grand;
      if (received < grand) throw new BizError('Amount received is less than the total.');
      cash = grand; change = received - grand;
    } else if (method === 'card') {
      card = grand;
    } else if (method === 'mixed') {
      card = int(input.card_amount);
      if (card < 0 || card > grand) throw new BizError('Invalid card amount for split payment.');
      cash = grand - card; received = int(input.cash_received) || cash;
      if (received < cash) throw new BizError('Cash received is less than the cash portion.');
      change = received - cash;
    } else if (method === 'qarz') {
      if (!input.customer_id) throw new BizError('Select a customer for Qarz (credit) sales.');
      const paid = Math.min(grand, Math.max(0, int(input.cash_received)));
      cash = paid; received = paid; qarz = grand - paid;
    } else throw new BizError('Unknown payment method.');

    if (input.customer_id) {
      const c = db.prepare('SELECT id FROM customers WHERE id = ?').get(input.customer_id);
      if (!c) throw new BizError('Customer not found.', 'NOT_FOUND', 404);
    }

    const date = todayStr().replace(/-/g, '');
    const seq = (db.prepare("SELECT COUNT(*) c FROM invoices WHERE invoice_number LIKE ?").get(`INV-${date}-%`) as any).c + 1;
    const invoiceNumber = `INV-${date}-${String(seq).padStart(4, '0')}`;
    const info = db.prepare(`INSERT INTO invoices (invoice_number,user_id,customer_id,branch_id,shift_id,subtotal,tax_amount,discount_amount,grand_total,
      payment_method,cash_amount,card_amount,qarz_amount,received_amount,change_amount,status,created_at)
      VALUES (?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,'completed',?)`)
      .run(invoiceNumber, actor.id, input.customer_id ?? null, actor.branch_id, shift.id, subtotal, discount - extra, grand, method, cash, card, qarz, received, change, nowIso());
    const invoiceId = Number(info.lastInsertRowid);

    const ins = db.prepare('INSERT INTO invoice_items (invoice_id,product_id,batch_id,quantity,unit_price,purchase_price,total_amount,sale_unit,unit_size,pack_size) VALUES (?,?,?,?,?,?,?,?,?,?)');
    for (const l of lines) ins.run(invoiceId, l.product_id, l.batch_id, l.quantity, l.unit_price, l.purchase_price, l.total, l.sale_unit, l.unit_size, l.pack_size);
    const save = db.prepare('UPDATE batches SET quantity = ?, loose_units = ? WHERE id = ?');
    for (const [id, x] of state) {
      if (x.packs < 0 || x.loose < 0) throw new BizError('Stock changed while selling. Please retry.', 'NO_STOCK');
      save.run(x.packs, x.loose, id);
    }
    if (input.prescription_id) db.prepare("UPDATE prescriptions SET status='dispensed' WHERE id = ?").run(input.prescription_id);

    const by = discount > 0 ? (db.prepare('SELECT username FROM users WHERE id = ?').get(actor.id) as any)?.username ?? null : null;
    audit(db, actor, 'pos', 'POS_CHECKOUT', {
      invoice: invoiceNumber, subtotal, total: grand, method, lines: lines.length,
      discount, discount_by: discount > 0 ? { user_id: actor.id, username: by, role: actor.role, limit_pct: pctLimit, cap } : null,
      price_changes: priceChanges.length,
    });
    // Every price typed at the till is logged with the catalogue price, so the admin can review them item by item.
    for (const c of priceChanges) audit(db, actor, 'pos', 'PRICE_AT_TILL', { invoice: invoiceNumber, branch: actor.branch_id, ...c });
    // A price typed at the till is a correction: it becomes this branch's price for that medicine from now on
    // (pack price on every batch in the branch, or the branch's sheet / tablet price). Each change is logged.
    for (const c of priceChanges) {
      if (c.unit === 'pack') {
        const bs = db.prepare('SELECT id, selling_price FROM batches WHERE product_id = ? AND branch_id = ? AND selling_price <> ?')
          .all(c.product_id, actor.branch_id, c.sold_price) as { id: number; selling_price: number }[];
        for (const b of bs) {
          db.prepare('UPDATE batches SET selling_price = ? WHERE id = ?').run(c.sold_price, b.id);
          audit(db, actor, 'products', 'PRICE_CHANGE', { batch: b.id, before: b.selling_price, after: c.sold_price, source: 'till', invoice: invoiceNumber });
        }
      } else {
        const col = c.unit === 'sheet' ? 'sheet_price' : 'tablet_price';
        const before = (db.prepare(`SELECT ${col} v FROM product_branch WHERE product_id = ? AND branch_id = ?`).get(c.product_id, actor.branch_id) as any)?.v ?? null;
        db.prepare(`INSERT INTO product_branch (product_id, branch_id, ${col}) VALUES (?, ?, ?)
          ON CONFLICT(product_id, branch_id) DO UPDATE SET ${col} = excluded.${col}`).run(c.product_id, actor.branch_id, c.sold_price);
        audit(db, actor, 'products', 'PRICE_CHANGE', { product: c.product_id, unit: c.unit, before, after: c.sold_price, source: 'till', invoice: invoiceNumber });
      }
    }
    return { id: invoiceId, invoice_number: invoiceNumber };
  })();
}

export function getInvoice(db: DB, id: number) {
  const inv = db.prepare(`SELECT i.*, u.name AS cashier, c.name AS customer_name FROM invoices i
    JOIN users u ON u.id = i.user_id LEFT JOIN customers c ON c.id = i.customer_id WHERE i.id = ?`).get(id) as any;
  if (!inv) return null;
  inv.items = db.prepare(`SELECT ii.*, p.brand_name, p.dosage, b.batch_number FROM invoice_items ii
    JOIN products p ON p.id = ii.product_id JOIN batches b ON b.id = ii.batch_id WHERE ii.invoice_id = ?`).all(id);
  return inv;
}

// ───────────────────────── Sales returns ─────────────────────────
// Sold items may be returned only within this many days (48 hours) of the sale.
export const RETURN_WINDOW_DAYS = 2;
export const isReturnable = (soldAtIso: string, now = Date.now()) =>
  now - Date.parse(soldAtIso) <= RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export function createSalesReturn(db: DB, actor: Actor, input: { invoice_id: number; items: { invoice_item_id: number; quantity: number }[]; refund_method: 'cash' | 'card' | 'qarz' }) {
  return db.transaction(() => {
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(input.invoice_id) as any;
    if (!inv || inv.branch_id !== actor.branch_id) throw new BizError('Invoice not found.', 'NOT_FOUND', 404);
    if (!isReturnable(inv.created_at)) {
      throw new BizError(`Return blocked: items can only be returned within ${RETURN_WINDOW_DAYS} days of the sale.`, 'RETURN_EXPIRED');
    }
    const shift = activeShift(db, actor.id);
    if (!shift) throw new BizError('Open a shift before processing a return.', 'NO_SHIFT');
    if (input.refund_method === 'qarz' && !inv.customer_id) throw new BizError('This invoice has no customer, so debt cannot be reduced.');
    if (!input.items?.length) throw new BizError('Select at least one item to return.');

    // Prorate discount so refunds never exceed what the customer actually paid.
    const ratio = inv.subtotal > 0 ? inv.grand_total / inv.subtotal : 1;
    let total = 0;
    const rows: any[] = [];
    for (const it of input.items) {
      const q = int(it.quantity);
      if (q <= 0) continue;
      const line = db.prepare('SELECT * FROM invoice_items WHERE id = ? AND invoice_id = ?').get(it.invoice_item_id, inv.id) as any;
      if (!line) throw new BizError('Item is not part of this invoice.');
      if (q > line.quantity - line.returned_qty) throw new BizError('Return quantity is more than what was sold.');
      total += Math.round(q * line.unit_price * ratio);
      rows.push({ line, q });
    }
    if (!rows.length) throw new BizError('Select at least one item to return.');
    // Rounding guard: refunds in total can never exceed the invoice total.
    const alreadyRefunded = (db.prepare('SELECT COALESCE(SUM(total),0) t FROM sales_returns WHERE invoice_id = ?').get(inv.id) as any).t;
    total = Math.min(total, inv.grand_total - alreadyRefunded);

    const info = db.prepare('INSERT INTO sales_returns (invoice_id,refund_method,total,user_id,shift_id,created_at) VALUES (?,?,?,?,?,?)')
      .run(inv.id, input.refund_method, total, actor.id, shift.id, nowIso());
    const rid = Number(info.lastInsertRowid);
    for (const { line, q } of rows) {
      db.prepare('INSERT INTO sales_return_items (return_id,invoice_item_id,batch_id,product_id,quantity,unit_price,purchase_price) VALUES (?,?,?,?,?,?,?)')
        .run(rid, line.id, line.batch_id, line.product_id, q, line.unit_price, line.purchase_price);
      db.prepare('UPDATE invoice_items SET returned_qty = returned_qty + ? WHERE id = ?').run(q, line.id);
      if (line.sale_unit !== 'pack' && line.pack_size > 1) {
        // Sheets/tablets go back as loose units; every full pack's worth is closed again.
        const b = db.prepare('SELECT quantity, loose_units FROM batches WHERE id = ?').get(line.batch_id) as any;
        const loose = (b.loose_units ?? 0) + q * line.unit_size;
        db.prepare('UPDATE batches SET quantity = ?, loose_units = ? WHERE id = ?')
          .run(b.quantity + Math.floor(loose / line.pack_size), loose % line.pack_size, line.batch_id);
      } else {
        db.prepare('UPDATE batches SET quantity = quantity + ? WHERE id = ?').run(q, line.batch_id); // back to original batch
      }
    }
    audit(db, actor, 'returns', 'SALES_RETURN', { invoice: inv.invoice_number, total, refund: input.refund_method });
    return { id: rid, total };
  })();
}

// ───────────────────────── Purchasing ─────────────────────────
export interface PurchaseItemInput { product_id: number; batch_number?: string; expiry_date?: string; quantity: number; cost_price: number; margin_pct?: number; selling_price: number }

function savePurchaseItems(db: DB, id: number, items: PurchaseItemInput[]) {
  db.prepare('DELETE FROM purchase_invoice_items WHERE purchase_invoice_id = ?').run(id);
  let total = 0;
  for (const it of items) {
    const q = int(it.quantity), c = int(it.cost_price);
    if (q <= 0) throw new BizError('Quantity must be greater than zero.');
    if (c < 0) throw new BizError('Cost price cannot be negative.');
    total += q * c;
    db.prepare(`INSERT INTO purchase_invoice_items (purchase_invoice_id,product_id,batch_number,expiry_date,quantity,cost_price,margin_pct,selling_price)
      VALUES (?,?,?,?,?,?,?,?)`).run(id, it.product_id, it.batch_number || null, it.expiry_date || null, q, c, Number(it.margin_pct) || 0, roundNote(int(it.selling_price)));
  }
  db.prepare('UPDATE purchase_invoices SET total_cost = ? WHERE id = ?').run(total, id);
  return total;
}

export function savePurchase(db: DB, actor: Actor, input: { id?: number; supplier_id: number; invoice_number?: string; payment_type: 'cash' | 'credit'; items: PurchaseItemInput[]; approve: boolean }) {
  return db.transaction(() => {
    assertBranch(db, 'suppliers', input.supplier_id, actor.branch_id, 'Supplier');
    let id = input.id;
    if (id) {
      const ex = db.prepare('SELECT status, branch_id FROM purchase_invoices WHERE id = ?').get(id) as any;
      if (!ex || ex.branch_id !== actor.branch_id) throw new BizError('Purchase invoice not found.', 'NOT_FOUND', 404);
      if (ex.status === 'approved') throw new BizError('An approved invoice cannot be edited.');
      db.prepare('UPDATE purchase_invoices SET supplier_id=?, invoice_number=?, payment_type=? WHERE id=?')
        .run(input.supplier_id, input.invoice_number || null, input.payment_type, id);
    } else {
      id = Number(db.prepare('INSERT INTO purchase_invoices (supplier_id,invoice_number,payment_type,user_id,branch_id,created_at) VALUES (?,?,?,?,?,?)')
        .run(input.supplier_id, input.invoice_number || null, input.payment_type, actor.id, actor.branch_id, nowIso()).lastInsertRowid);
    }
    savePurchaseItems(db, id, input.items || []);
    if (input.approve) {
      if (!input.items?.length) throw new BizError('Add at least one medicine before approving.');
      for (const it of input.items) {
        if (!it.batch_number || !it.expiry_date) throw new BizError('Batch number and expiry date are required for every line.');
        // Merge into an existing identical batch, otherwise create a new one.
        const ex = db.prepare('SELECT id FROM batches WHERE product_id=? AND branch_id=? AND batch_number=? AND expiry_date=?')
          .get(it.product_id, actor.branch_id, it.batch_number, it.expiry_date) as any;
        if (ex) {
          db.prepare('UPDATE batches SET quantity = quantity + ?, purchase_price = ?, selling_price = ? WHERE id = ?')
            .run(int(it.quantity), int(it.cost_price), roundNote(int(it.selling_price)), ex.id);
        } else {
          db.prepare('INSERT INTO batches (product_id,branch_id,batch_number,expiry_date,quantity,purchase_price,selling_price) VALUES (?,?,?,?,?,?,?)')
            .run(it.product_id, actor.branch_id, it.batch_number, it.expiry_date, int(it.quantity), int(it.cost_price), roundNote(int(it.selling_price)));
        }
      }
      db.prepare("UPDATE purchase_invoices SET status='approved', approved_at=? WHERE id=?").run(nowIso(), id);
      const t = (db.prepare('SELECT total_cost FROM purchase_invoices WHERE id=?').get(id) as any).total_cost;
      audit(db, actor, 'receive', 'PURCHASE_APPROVE', { id, supplier: input.supplier_id, total: t, type: input.payment_type });
    }
    return { id };
  })();
}

export function createRtv(db: DB, actor: Actor, input: { supplier_id: number; reason?: string; items: { batch_id: number; quantity: number }[] }) {
  return db.transaction(() => {
    if (!input.items?.length) throw new BizError('Add at least one batch to return.');
    assertBranch(db, 'suppliers', input.supplier_id, actor.branch_id, 'Supplier');
    let total = 0;
    const rows: any[] = [];
    for (const it of input.items) {
      const b = db.prepare('SELECT * FROM batches WHERE id = ? AND branch_id = ?').get(it.batch_id, actor.branch_id) as any;
      if (!b) throw new BizError('Batch not found.', 'NOT_FOUND', 404);
      const q = int(it.quantity);
      if (q <= 0) throw new BizError('Quantity must be greater than zero.');
      if (q > b.quantity) throw new BizError(`Return quantity exceeds stock of batch ${b.batch_number}.`, 'NO_STOCK');
      total += q * b.purchase_price;
      rows.push({ b, q });
    }
    const rid = Number(db.prepare('INSERT INTO rtv (supplier_id,reason,total,user_id,branch_id,created_at) VALUES (?,?,?,?,?,?)')
      .run(input.supplier_id, input.reason || null, total, actor.id, actor.branch_id, nowIso()).lastInsertRowid);
    for (const { b, q } of rows) {
      db.prepare('INSERT INTO rtv_items (rtv_id,batch_id,product_id,quantity,unit_cost) VALUES (?,?,?,?,?)').run(rid, b.id, b.product_id, q, b.purchase_price);
      db.prepare('UPDATE batches SET quantity = quantity - ? WHERE id = ?').run(q, b.id);
    }
    audit(db, actor, 'rtv', 'RTV_APPROVE', { id: rid, supplier: input.supplier_id, total });
    return { id: rid, total };
  })();
}

// ───────────────────────── Stock ─────────────────────────
export function adjustStock(db: DB, actor: Actor, input: { batch_id: number; counted_qty: number; counted_loose?: number; reason: string }) {
  return db.transaction(() => {
    const b = db.prepare(`SELECT b.*, p.sheets_per_pack, p.tablets_per_sheet FROM batches b JOIN products p ON p.id = b.product_id
      WHERE b.id = ? AND b.branch_id = ?`).get(input.batch_id, actor.branch_id) as any;
    if (!b) throw new BizError('Batch not found.', 'NOT_FOUND', 404);
    const counted = int(input.counted_qty);
    if (counted < 0) throw new BizError('Counted quantity cannot be negative.');
    // Opened packs: loose stock in the smallest unit (tablets, or sheets when a sheet is not split).
    const pack = Math.max(1, int(b.sheets_per_pack) || 1) * Math.max(1, int(b.tablets_per_sheet) || 1);
    const loose = input.counted_loose === undefined || input.counted_loose === null ? (pack > 1 ? (b.loose_units ?? 0) : 0) : int(input.counted_loose);
    if (loose < 0) throw new BizError('Loose quantity cannot be negative.');
    if (loose > 0 && loose >= pack) throw new BizError(`Loose quantity must be less than one pack (${pack}).`);
    if (!input.reason) throw new BizError('Choose a reason.');
    db.prepare(`INSERT INTO stock_adjustments (batch_id,product_id,system_qty,counted_qty,system_loose,counted_loose,pack_size,reason,user_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(b.id, b.product_id, b.quantity, counted, b.loose_units ?? 0, loose, pack, input.reason, actor.id, nowIso());
    db.prepare('UPDATE batches SET quantity = ?, loose_units = ? WHERE id = ?').run(counted, loose, b.id);
    audit(db, actor, 'adjust', 'STOCK_ADJUST', { batch: b.id, before: b.quantity, after: counted, loose_before: b.loose_units ?? 0, loose_after: loose, reason: input.reason });
    return { ok: true };
  })();
}

export function createTransfer(db: DB, actor: Actor, input: { from_branch: number; to_branch: number; items: { batch_id: number; quantity: number }[] }) {
  return db.transaction(() => {
    if (input.from_branch === input.to_branch) throw new BizError('Choose two different branches.');
    if (actor.role !== 'super_admin' && Number(input.from_branch) !== actor.branch_id) throw new BizError('You can only send stock from your own branch.', 'FORBIDDEN', 403);
    if (!input.items?.length) throw new BizError('Add at least one item.');
    const tid = Number(db.prepare('INSERT INTO stock_transfers (from_branch,to_branch,status,user_id,created_at) VALUES (?,?,?,?,?)')
      .run(input.from_branch, input.to_branch, 'pending', actor.id, nowIso()).lastInsertRowid);
    for (const it of input.items) {
      const b = db.prepare('SELECT * FROM batches WHERE id = ? AND branch_id = ?').get(it.batch_id, input.from_branch) as any;
      if (!b) throw new BizError('Batch not found in the source branch.', 'NOT_FOUND', 404);
      if (int(it.quantity) <= 0 || int(it.quantity) > b.quantity) throw new BizError(`Invalid quantity for batch ${b.batch_number}.`);
      db.prepare('INSERT INTO stock_transfer_items (transfer_id,batch_id,product_id,quantity) VALUES (?,?,?,?)').run(tid, b.id, b.product_id, int(it.quantity));
    }
    audit(db, actor, 'transfers', 'TRANSFER_CREATE', { id: tid });
    return { id: tid };
  })();
}

export function transitionTransfer(db: DB, actor: Actor, id: number, action: 'approve' | 'receive' | 'reject') {
  return db.transaction(() => {
    const t = db.prepare('SELECT * FROM stock_transfers WHERE id = ?').get(id) as any;
    if (!t) throw new BizError('Transfer not found.', 'NOT_FOUND', 404);
    if (actor.role !== 'super_admin') {
      // Sending branch approves/rejects; only the receiving branch confirms receipt.
      const mine = action === 'receive' ? t.to_branch : t.from_branch;
      if (mine !== actor.branch_id && !(action === 'reject' && t.to_branch === actor.branch_id)) throw new BizError('This transfer belongs to another branch.', 'FORBIDDEN', 403);
    }
    if (action === 'approve' || action === 'reject') {
      if (t.status !== 'pending') throw new BizError('Only pending transfers can be approved or rejected.');
      db.prepare('UPDATE stock_transfers SET status = ? WHERE id = ?').run(action === 'approve' ? 'approved' : 'rejected', id);
    } else {
      if (t.status !== 'approved') throw new BizError('Only approved transfers can be received.');
      const items = db.prepare('SELECT * FROM stock_transfer_items WHERE transfer_id = ?').all(id) as any[];
      for (const it of items) {
        const b = db.prepare('SELECT * FROM batches WHERE id = ?').get(it.batch_id) as any;
        if (!b || b.quantity < it.quantity) throw new BizError(`Source stock is no longer enough for batch ${b?.batch_number ?? it.batch_id}.`, 'NO_STOCK');
        db.prepare('UPDATE batches SET quantity = quantity - ? WHERE id = ?').run(it.quantity, b.id);
        const dst = db.prepare('SELECT id FROM batches WHERE product_id=? AND branch_id=? AND batch_number=? AND expiry_date=?')
          .get(b.product_id, t.to_branch, b.batch_number, b.expiry_date) as any;
        if (dst) db.prepare('UPDATE batches SET quantity = quantity + ? WHERE id = ?').run(it.quantity, dst.id);
        else db.prepare('INSERT INTO batches (product_id,branch_id,batch_number,expiry_date,quantity,purchase_price,selling_price) VALUES (?,?,?,?,?,?,?)')
          .run(b.product_id, t.to_branch, b.batch_number, b.expiry_date, it.quantity, b.purchase_price, b.selling_price);
      }
      db.prepare("UPDATE stock_transfers SET status='received', received_at=? WHERE id=?").run(nowIso(), id);
    }
    audit(db, actor, 'transfers', `TRANSFER_${action.toUpperCase()}`, { id });
    return { ok: true };
  })();
}

// ───────────────────────── Shifts ─────────────────────────
export function openShift(db: DB, actor: Actor, openingCash: number) {
  if (activeShift(db, actor.id)) throw new BizError('A shift is already open.');
  const id = Number(db.prepare('INSERT INTO shifts (user_id,branch_id,opened_at,opening_cash) VALUES (?,?,?,?)')
    .run(actor.id, actor.branch_id, nowIso(), Math.max(0, int(openingCash))).lastInsertRowid);
  audit(db, actor, 'shifts', 'SHIFT_OPEN', { id, opening: openingCash });
  return { id };
}

export function shiftSummary(db: DB, shiftId: number) {
  const s = db.prepare(`SELECT s.*, u.name AS user_name FROM shifts s JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(shiftId) as any;
  if (!s) return null;
  const sales = db.prepare(`SELECT COUNT(*) receipts, COALESCE(SUM(cash_amount),0) cash, COALESCE(SUM(card_amount),0) card,
      COALESCE(SUM(qarz_amount),0) qarz, COALESCE(SUM(grand_total),0) total FROM invoices WHERE shift_id = ? AND status='completed'`).get(shiftId) as any;
  const pay = db.prepare("SELECT COALESCE(SUM(amount),0) a FROM customer_payments WHERE shift_id = ? AND method='cash'").get(shiftId) as any;
  const refunds = db.prepare("SELECT COALESCE(SUM(total),0) a FROM sales_returns WHERE shift_id = ? AND refund_method='cash'").get(shiftId) as any;
  const expected = s.opening_cash + sales.cash + pay.a - refunds.a;
  return { ...s, ...sales, qarz_collected: pay.a, cash_refunds: refunds.a, expected_cash: expected,
    difference: s.counted_cash == null ? null : s.counted_cash - expected };
}

export function closeShift(db: DB, actor: Actor, countedCash: number) {
  return db.transaction(() => {
    const s = activeShift(db, actor.id);
    if (!s) throw new BizError('No open shift.');
    db.prepare('UPDATE shifts SET closed_at=?, counted_cash=? WHERE id=?').run(nowIso(), Math.max(0, int(countedCash)), s.id);
    audit(db, actor, 'shifts', 'SHIFT_CLOSE', { id: s.id, counted: countedCash });
    return shiftSummary(db, s.id);
  })();
}

// ───────────────────────── Customer payments ─────────────────────────
export function recordCustomerPayment(db: DB, actor: Actor, input: { customer_id: number; amount: number; method?: string; note?: string }) {
  return db.transaction(() => {
    const amount = int(input.amount);
    if (amount <= 0) throw new BizError('Amount must be greater than zero.');
    assertBranch(db, 'customers', input.customer_id, actor.branch_id, 'Customer');
    const bal = customerBalance(db, input.customer_id);
    if (amount > bal) throw new BizError('Payment is more than the outstanding debt.');
    const shift = activeShift(db, actor.id);
    const id = Number(db.prepare('INSERT INTO customer_payments (customer_id,amount,method,note,shift_id,user_id,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(input.customer_id, amount, input.method || 'cash', input.note || null, shift?.id ?? null, actor.id, nowIso()).lastInsertRowid);
    audit(db, actor, 'customers', 'CUSTOMER_PAYMENT', { customer: input.customer_id, amount });
    return { id, balance: bal - amount };
  })();
}

// ───────────────────────── Expiry classification ─────────────────────────
export function daysLeft(expiry: string, today = todayStr()): number {
  return Math.round((Date.parse(expiry + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
}
export function expiryStatus(days: number): 'expired' | 'critical' | 'warning' | 'good' {
  if (days < 0) return 'expired';
  if (days <= 30) return 'critical';
  if (days <= 90) return 'warning';
  return 'good';
}

// ───────────────────────── P&L ─────────────────────────
export function profitAndLoss(db: DB, from: string, to: string, branchId?: number) {
  // created_at is stored in UTC ISO; compare against local-day bounds converted to UTC.
  const fromIso = new Date(from + 'T00:00:00').toISOString();
  const toIso = new Date(to + 'T23:59:59.999').toISOString();
  // Optional branch filter: each branch is its own pharmacy with its own P&L.
  const all = branchId === undefined;
  const br = all ? [] : [branchId];
  const sales = db.prepare(`SELECT COALESCE(SUM(grand_total),0) revenue, COUNT(*) receipts FROM invoices
    WHERE status='completed' AND created_at BETWEEN ? AND ?${all ? '' : ' AND branch_id = ?'}`).get(fromIso, toIso, ...br) as any;
  const cogs = db.prepare(`SELECT COALESCE(SUM(ii.quantity * ii.purchase_price),0) c FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
    WHERE i.status='completed' AND i.created_at BETWEEN ? AND ?${all ? '' : ' AND i.branch_id = ?'}`).get(fromIso, toIso, ...br) as any;
  const ret = db.prepare(`SELECT COALESCE(SUM(r.total),0) t FROM sales_returns r JOIN invoices i ON i.id = r.invoice_id
    WHERE r.created_at BETWEEN ? AND ?${all ? '' : ' AND i.branch_id = ?'}`).get(fromIso, toIso, ...br) as any;
  const retCogs = db.prepare(`SELECT COALESCE(SUM(sri.quantity * sri.purchase_price),0) c FROM sales_return_items sri JOIN sales_returns r ON r.id = sri.return_id
    JOIN invoices i ON i.id = r.invoice_id WHERE r.created_at BETWEEN ? AND ?${all ? '' : ' AND i.branch_id = ?'}`).get(fromIso, toIso, ...br) as any;
  const shrink = db.prepare(`SELECT COALESCE(SUM((a.system_qty - a.counted_qty) * b.purchase_price
      + ROUND((a.system_loose - a.counted_loose) * 1.0 * b.purchase_price / MAX(a.pack_size,1))),0) s FROM stock_adjustments a JOIN batches b ON b.id = a.batch_id
    WHERE a.created_at BETWEEN ? AND ?${all ? '' : ' AND b.branch_id = ?'}`).get(fromIso, toIso, ...br) as any;
  const exp = db.prepare(`SELECT category, COALESCE(SUM(amount),0) a FROM expenses WHERE date BETWEEN ? AND ?${all ? '' : ' AND branch_id = ?'} GROUP BY category`)
    .all(from, to, ...br) as any[];
  const expenses = exp.reduce((s, e) => s + e.a, 0);

  const netRevenue = sales.revenue - ret.t;
  const costOfGoods = cogs.c - retCogs.c;
  const gross = netRevenue - costOfGoods;
  const net = gross - shrink.s - expenses;
  return { from, to, receipts: sales.receipts, revenue: sales.revenue, returns: ret.t, net_revenue: netRevenue,
    cogs: costOfGoods, gross_profit: gross, shrinkage: shrink.s, expenses, expense_breakdown: exp, net_profit: net };
}
