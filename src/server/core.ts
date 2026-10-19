import type { DB } from '../db/database';

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
  items: { product_id: number; quantity: number; batch_id?: number; unit_price?: number }[];
  customer_id?: number | null;
  payment_method: 'cash' | 'card' | 'mixed' | 'qarz';
  cash_received?: number;
  card_amount?: number;
  discount_pct?: number;
  discount_amount?: number;
  prescription_id?: number | null;
}

export function checkout(db: DB, actor: Actor, input: CheckoutInput) {
  return db.transaction(() => {
    const shift = activeShift(db, actor.id);
    if (!shift) throw new BizError('Open a shift before selling.', 'NO_SHIFT');
    if (!input.items?.length) throw new BizError('The receipt is empty.');
    const today = todayStr();

    type Line = { product_id: number; batch_id: number; quantity: number; unit_price: number; purchase_price: number; total: number };
    const lines: Line[] = [];
    // Aggregate requested quantity per product (and per explicit batch).
    const wanted = new Map<string, { product_id: number; batch_id?: number; quantity: number; unit_price?: number }>();
    for (const it of input.items) {
      const q = int(it.quantity);
      if (q <= 0) throw new BizError('Quantity must be greater than zero.');
      const key = `${it.product_id}:${it.batch_id ?? ''}`;
      const w = wanted.get(key);
      // Optional price override typed by the cashier (flexible pricing).
      let override: number | undefined;
      if (it.unit_price !== undefined && it.unit_price !== null && String(it.unit_price) !== '') {
        override = int(it.unit_price);
        if (override < 0) throw new BizError('Price cannot be negative.');
      }
      if (w) { w.quantity += q; if (override !== undefined) w.unit_price = override; }
      else wanted.set(key, { product_id: it.product_id, batch_id: it.batch_id, quantity: q, unit_price: override });
    }

    for (const w of wanted.values()) {
      const product = db.prepare('SELECT id, brand_name FROM products WHERE id = ? AND active = 1').get(w.product_id) as any;
      if (!product) throw new BizError('Medicine not found.', 'NOT_FOUND', 404);

      if (w.batch_id) {
        const b = db.prepare('SELECT * FROM batches WHERE id = ? AND product_id = ? AND branch_id = ?')
          .get(w.batch_id, w.product_id, actor.branch_id) as any;
        if (!b) throw new BizError('Batch not found.', 'NOT_FOUND', 404);
        if (b.expiry_date < today) {
          throw new BizError(`Sale blocked: batch ${b.batch_number} of ${product.brand_name} is expired (${b.expiry_date}).`, 'EXPIRED_BATCH');
        }
        if (b.quantity < w.quantity) throw new BizError(`Not enough stock in batch ${b.batch_number} of ${product.brand_name}.`, 'NO_STOCK');
        { const price = w.unit_price ?? b.selling_price; lines.push({ product_id: w.product_id, batch_id: b.id, quantity: w.quantity, unit_price: price, purchase_price: b.purchase_price, total: price * w.quantity }); }
        continue;
      }

      // FEFO: earliest expiry first among non-expired batches.
      const batches = db.prepare(
        `SELECT * FROM batches WHERE product_id = ? AND branch_id = ? AND quantity > 0 AND expiry_date >= ?
         ORDER BY expiry_date ASC, id ASC`).all(w.product_id, actor.branch_id, today) as any[];
      let remaining = w.quantity;
      for (const b of batches) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, b.quantity);
        const price = w.unit_price ?? b.selling_price;
        lines.push({ product_id: w.product_id, batch_id: b.id, quantity: take, unit_price: price, purchase_price: b.purchase_price, total: price * take });
        remaining -= take;
      }
      if (remaining > 0) {
        const expired = db.prepare('SELECT COALESCE(SUM(quantity),0) q FROM batches WHERE product_id = ? AND branch_id = ? AND expiry_date < ? AND quantity > 0')
          .get(w.product_id, actor.branch_id, today) as any;
        if (expired.q > 0) {
          throw new BizError(`Sale blocked: only expired stock remains for ${product.brand_name}. Expired batches cannot be sold.`, 'EXPIRED_BATCH');
        }
        throw new BizError(`Not enough stock for ${product.brand_name}.`, 'NO_STOCK');
      }
    }

    const subtotal = lines.reduce((s, l) => s + l.total, 0);
    const pct = Math.min(100, Math.max(0, Number(input.discount_pct) || 0));
    const discount = Math.min(subtotal, Math.round((subtotal * pct) / 100) + Math.max(0, int(input.discount_amount)));
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
      .run(invoiceNumber, actor.id, input.customer_id ?? null, actor.branch_id, shift.id, subtotal, discount, grand, method, cash, card, qarz, received, change, nowIso());
    const invoiceId = Number(info.lastInsertRowid);

    const ins = db.prepare('INSERT INTO invoice_items (invoice_id,product_id,batch_id,quantity,unit_price,purchase_price,total_amount) VALUES (?,?,?,?,?,?,?)');
    const dec = db.prepare('UPDATE batches SET quantity = quantity - ? WHERE id = ? AND quantity >= ?');
    for (const l of lines) {
      ins.run(invoiceId, l.product_id, l.batch_id, l.quantity, l.unit_price, l.purchase_price, l.total);
      const r = dec.run(l.quantity, l.batch_id, l.quantity);
      if (r.changes !== 1) throw new BizError('Stock changed while selling. Please retry.', 'NO_STOCK');
    }
    if (input.prescription_id) db.prepare("UPDATE prescriptions SET status='dispensed' WHERE id = ?").run(input.prescription_id);

    audit(db, actor, 'pos', 'POS_CHECKOUT', { invoice: invoiceNumber, total: grand, method, lines: lines.length });
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
export function createSalesReturn(db: DB, actor: Actor, input: { invoice_id: number; items: { invoice_item_id: number; quantity: number }[]; refund_method: 'cash' | 'card' | 'qarz' }) {
  return db.transaction(() => {
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(input.invoice_id) as any;
    if (!inv) throw new BizError('Invoice not found.', 'NOT_FOUND', 404);
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
      db.prepare('UPDATE batches SET quantity = quantity + ? WHERE id = ?').run(q, line.batch_id); // back to original batch
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
      VALUES (?,?,?,?,?,?,?,?)`).run(id, it.product_id, it.batch_number || null, it.expiry_date || null, q, c, Number(it.margin_pct) || 0, int(it.selling_price));
  }
  db.prepare('UPDATE purchase_invoices SET total_cost = ? WHERE id = ?').run(total, id);
  return total;
}

export function savePurchase(db: DB, actor: Actor, input: { id?: number; supplier_id: number; invoice_number?: string; payment_type: 'cash' | 'credit'; items: PurchaseItemInput[]; approve: boolean }) {
  return db.transaction(() => {
    let id = input.id;
    if (id) {
      const ex = db.prepare('SELECT status FROM purchase_invoices WHERE id = ?').get(id) as any;
      if (!ex) throw new BizError('Purchase invoice not found.', 'NOT_FOUND', 404);
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
            .run(int(it.quantity), int(it.cost_price), int(it.selling_price), ex.id);
        } else {
          db.prepare('INSERT INTO batches (product_id,branch_id,batch_number,expiry_date,quantity,purchase_price,selling_price) VALUES (?,?,?,?,?,?,?)')
            .run(it.product_id, actor.branch_id, it.batch_number, it.expiry_date, int(it.quantity), int(it.cost_price), int(it.selling_price));
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
    let total = 0;
    const rows: any[] = [];
    for (const it of input.items) {
      const b = db.prepare('SELECT * FROM batches WHERE id = ?').get(it.batch_id) as any;
      if (!b) throw new BizError('Batch not found.', 'NOT_FOUND', 404);
      const q = int(it.quantity);
      if (q <= 0) throw new BizError('Quantity must be greater than zero.');
      if (q > b.quantity) throw new BizError(`Return quantity exceeds stock of batch ${b.batch_number}.`, 'NO_STOCK');
      total += q * b.purchase_price;
      rows.push({ b, q });
    }
    const rid = Number(db.prepare('INSERT INTO rtv (supplier_id,reason,total,user_id,created_at) VALUES (?,?,?,?,?)')
      .run(input.supplier_id, input.reason || null, total, actor.id, nowIso()).lastInsertRowid);
    for (const { b, q } of rows) {
      db.prepare('INSERT INTO rtv_items (rtv_id,batch_id,product_id,quantity,unit_cost) VALUES (?,?,?,?,?)').run(rid, b.id, b.product_id, q, b.purchase_price);
      db.prepare('UPDATE batches SET quantity = quantity - ? WHERE id = ?').run(q, b.id);
    }
    audit(db, actor, 'rtv', 'RTV_APPROVE', { id: rid, supplier: input.supplier_id, total });
    return { id: rid, total };
  })();
}

// ───────────────────────── Stock ─────────────────────────
export function adjustStock(db: DB, actor: Actor, input: { batch_id: number; counted_qty: number; reason: string }) {
  return db.transaction(() => {
    const b = db.prepare('SELECT * FROM batches WHERE id = ?').get(input.batch_id) as any;
    if (!b) throw new BizError('Batch not found.', 'NOT_FOUND', 404);
    const counted = int(input.counted_qty);
    if (counted < 0) throw new BizError('Counted quantity cannot be negative.');
    if (!input.reason) throw new BizError('Choose a reason.');
    db.prepare('INSERT INTO stock_adjustments (batch_id,product_id,system_qty,counted_qty,reason,user_id,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(b.id, b.product_id, b.quantity, counted, input.reason, actor.id, nowIso());
    db.prepare('UPDATE batches SET quantity = ? WHERE id = ?').run(counted, b.id);
    audit(db, actor, 'adjust', 'STOCK_ADJUST', { batch: b.id, before: b.quantity, after: counted, reason: input.reason });
    return { ok: true };
  })();
}

export function createTransfer(db: DB, actor: Actor, input: { from_branch: number; to_branch: number; items: { batch_id: number; quantity: number }[] }) {
  return db.transaction(() => {
    if (input.from_branch === input.to_branch) throw new BizError('Choose two different branches.');
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
export function profitAndLoss(db: DB, from: string, to: string) {
  // created_at is stored in UTC ISO; compare against local-day bounds converted to UTC.
  const fromIso = new Date(from + 'T00:00:00').toISOString();
  const toIso = new Date(to + 'T23:59:59.999').toISOString();
  const sales = db.prepare(`SELECT COALESCE(SUM(grand_total),0) revenue, COUNT(*) receipts FROM invoices
    WHERE status='completed' AND created_at BETWEEN ? AND ?`).get(fromIso, toIso) as any;
  const cogs = db.prepare(`SELECT COALESCE(SUM(ii.quantity * ii.purchase_price),0) c FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
    WHERE i.status='completed' AND i.created_at BETWEEN ? AND ?`).get(fromIso, toIso) as any;
  const ret = db.prepare('SELECT COALESCE(SUM(total),0) t FROM sales_returns WHERE created_at BETWEEN ? AND ?').get(fromIso, toIso) as any;
  const retCogs = db.prepare(`SELECT COALESCE(SUM(sri.quantity * sri.purchase_price),0) c FROM sales_return_items sri JOIN sales_returns r ON r.id = sri.return_id
    WHERE r.created_at BETWEEN ? AND ?`).get(fromIso, toIso) as any;
  const shrink = db.prepare(`SELECT COALESCE(SUM((a.system_qty - a.counted_qty) * b.purchase_price),0) s FROM stock_adjustments a JOIN batches b ON b.id = a.batch_id
    WHERE a.created_at BETWEEN ? AND ?`).get(fromIso, toIso) as any;
  const exp = db.prepare('SELECT category, COALESCE(SUM(amount),0) a FROM expenses WHERE date BETWEEN ? AND ? GROUP BY category').all(from, to) as any[];
  const expenses = exp.reduce((s, e) => s + e.a, 0);

  const netRevenue = sales.revenue - ret.t;
  const costOfGoods = cogs.c - retCogs.c;
  const gross = netRevenue - costOfGoods;
  const net = gross - shrink.s - expenses;
  return { from, to, receipts: sales.receipts, revenue: sales.revenue, returns: ret.t, net_revenue: netRevenue,
    cogs: costOfGoods, gross_profit: gross, shrinkage: shrink.s, expenses, expense_breakdown: exp, net_profit: net };
}
