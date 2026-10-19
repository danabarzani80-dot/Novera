import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/database';
import * as core from '../src/server/core';

const db = openDatabase(':memory:');
const uid = Number(db.prepare("INSERT INTO users (name,username,password_hash,role,branch_id) VALUES ('Cash','c','x','cashier',1)").run().lastInsertRowid);
const actor = { id: uid, role: 'cashier', branch_id: 1 };
const day = (offset: number) => core.todayStr(new Date(Date.now() + offset * 86400_000));
let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('  ok -', name); };
const prod = (name: string) => Number(db.prepare('INSERT INTO products (brand_name,generic_name) VALUES (?,?)').run(name, 'gen-' + name).lastInsertRowid);
const batch = (p: number, no: string, exp: string, qty: number, cost: number, price: number) =>
  Number(db.prepare('INSERT INTO batches (product_id,branch_id,batch_number,expiry_date,quantity,purchase_price,selling_price) VALUES (?,1,?,?,?,?,?)').run(p, no, exp, qty, cost, price).lastInsertRowid);
const qty = (b: number) => (db.prepare('SELECT quantity q FROM batches WHERE id=?').get(b) as any).q;
const throwsCode = (fn: () => void, code: string) => assert.throws(fn, (e: any) => e instanceof core.BizError && e.code === code);

test('selling requires an open shift', () => {
  const p = prod('A'); batch(p, 'x', day(100), 5, 100, 200);
  throwsCode(() => core.checkout(db, actor, { items: [{ product_id: p, quantity: 1 }], payment_method: 'cash' }), 'NO_SHIFT');
});
core.openShift(db, actor, 10000);

test('FEFO takes the earliest-expiring batch first and spans batches', () => {
  const p = prod('Fefo');
  const late = batch(p, 'LATE', day(300), 10, 100, 250);
  const early = batch(p, 'EARLY', day(60), 3, 80, 200);
  const r = core.checkout(db, actor, { items: [{ product_id: p, quantity: 5 }], payment_method: 'cash', cash_received: 2000 });
  assert.equal(qty(early), 0); assert.equal(qty(late), 8);
  const inv = core.getInvoice(db, r.id);
  assert.equal(inv.items.length, 2);
  assert.equal(inv.grand_total, 3 * 200 + 2 * 250);
  assert.equal(inv.change_amount, 2000 - 1100);
  assert.equal(inv.items.find((i: any) => i.batch_number === 'EARLY').purchase_price, 80); // stored for COGS
});

test('cashier can override the selling price (flexible pricing)', () => {
  const p = prod('Flex'); batch(p, 'F1', day(200), 5, 1500, 3000);
  const r = core.checkout(db, actor, { items: [{ product_id: p, quantity: 1, unit_price: 4000 }], payment_method: 'cash', cash_received: 5000 });
  const inv = core.getInvoice(db, r.id);
  assert.equal(inv.grand_total, 4000);
  assert.equal(inv.items[0].unit_price, 4000);
  assert.equal(inv.change_amount, 1000);
  const r2 = core.checkout(db, actor, { items: [{ product_id: p, quantity: 1 }], payment_method: 'cash', cash_received: 3000 });
  assert.equal(core.getInvoice(db, r2.id).grand_total, 3000); // no override = list price
});

test('keep extra: full amount received counts as the sale (no change)', () => {
  const p = prod('Keep'); batch(p, 'K1', day(200), 5, 1500, 3000);
  const r = core.checkout(db, actor, { items: [{ product_id: p, quantity: 1 }], payment_method: 'cash', cash_received: 4000, extra_amount: 1000 });
  const inv = core.getInvoice(db, r.id);
  assert.equal(inv.grand_total, 4000);
  assert.equal(inv.change_amount, 0);
  assert.equal(inv.cash_amount, 4000);
  assert.equal(inv.discount_amount, -1000);
});

test('expired batches are blocked by the backend (FEFO path and explicit batch)', () => {
  const p = prod('Exp');
  const bad = batch(p, 'OLD', day(-1), 10, 100, 300);
  throwsCode(() => core.checkout(db, actor, { items: [{ product_id: p, quantity: 1 }], payment_method: 'cash' }), 'EXPIRED_BATCH');
  throwsCode(() => core.checkout(db, actor, { items: [{ product_id: p, quantity: 1, batch_id: bad }], payment_method: 'cash' }), 'EXPIRED_BATCH');
  assert.equal(qty(bad), 10);
  // Good stock + expired stock: only good stock is sold, never expired.
  const good = batch(p, 'NEW', day(200), 2, 100, 300);
  throwsCode(() => core.checkout(db, actor, { items: [{ product_id: p, quantity: 3 }], payment_method: 'cash' }), 'EXPIRED_BATCH');
  core.checkout(db, actor, { items: [{ product_id: p, quantity: 2 }], payment_method: 'cash' });
  assert.equal(qty(good), 0); assert.equal(qty(bad), 10);
});

test('failed checkout rolls everything back', () => {
  const p1 = prod('R1'), p2 = prod('R2');
  const b1 = batch(p1, 'a', day(90), 5, 10, 20); batch(p2, 'b', day(90), 1, 10, 20);
  const before = (db.prepare('SELECT COUNT(*) c FROM invoices').get() as any).c;
  throwsCode(() => core.checkout(db, actor, { items: [{ product_id: p1, quantity: 2 }, { product_id: p2, quantity: 9 }], payment_method: 'cash' }), 'NO_STOCK');
  assert.equal(qty(b1), 5);
  assert.equal((db.prepare('SELECT COUNT(*) c FROM invoices').get() as any).c, before);
});

test('discounts, mixed payment and validation', () => {
  const p = prod('Disc'); const b = batch(p, 'd', day(90), 50, 500, 1000);
  const r = core.checkout(db, actor, { items: [{ product_id: p, quantity: 10 }], payment_method: 'mixed', card_amount: 4000, cash_received: 10000, discount_pct: 10, discount_amount: 500 });
  const inv = core.getInvoice(db, r.id);
  assert.equal(inv.subtotal, 10000); assert.equal(inv.discount_amount, 1500); assert.equal(inv.grand_total, 8500);
  assert.equal(inv.card_amount, 4000); assert.equal(inv.cash_amount, 4500); assert.equal(inv.change_amount, 5500);
  assert.equal(qty(b), 40);
  assert.throws(() => core.checkout(db, actor, { items: [{ product_id: p, quantity: 1 }], payment_method: 'cash', cash_received: 5 }));
});

test('qarz needs a customer; balance, payments and returns-to-debt', () => {
  const p = prod('Qarz'); batch(p, 'q', day(90), 20, 100, 1000);
  throwsCode(() => core.checkout(db, actor, { items: [{ product_id: p, quantity: 1 }], payment_method: 'qarz' }), 'BUSINESS_RULE');
  const cid = Number(db.prepare("INSERT INTO customers (name) VALUES ('Ali')").run().lastInsertRowid);
  const r = core.checkout(db, actor, { items: [{ product_id: p, quantity: 5 }], payment_method: 'qarz', customer_id: cid, cash_received: 1000 });
  assert.equal(core.customerBalance(db, cid), 4000);
  core.recordCustomerPayment(db, actor, { customer_id: cid, amount: 1500 });
  assert.equal(core.customerBalance(db, cid), 2500);
  assert.throws(() => core.recordCustomerPayment(db, actor, { customer_id: cid, amount: 99999 }));
  const inv = core.getInvoice(db, r.id);
  const ret = core.createSalesReturn(db, actor, { invoice_id: r.id, items: [{ invoice_item_id: inv.items[0].id, quantity: 2 }], refund_method: 'qarz' });
  assert.equal(ret.total, 2000);
  assert.equal(core.customerBalance(db, cid), 500);
  assert.throws(() => core.createSalesReturn(db, actor, { invoice_id: r.id, items: [{ invoice_item_id: inv.items[0].id, quantity: 4 }], refund_method: 'qarz' })); // only 3 left
});

test('returns restock the original batch and prorate the discount', () => {
  const p = prod('Ret'); const b = batch(p, 'r', day(90), 10, 400, 1000);
  const r = core.checkout(db, actor, { items: [{ product_id: p, quantity: 4 }], payment_method: 'cash', discount_amount: 400 });
  assert.equal(qty(b), 6);
  const inv = core.getInvoice(db, r.id);
  const ret = core.createSalesReturn(db, actor, { invoice_id: r.id, items: [{ invoice_item_id: inv.items[0].id, quantity: 4 }], refund_method: 'cash' });
  assert.equal(ret.total, 3600); // never refund more than paid
  assert.equal(qty(b), 10);
});

test('purchase approval creates batches; credit raises supplier balance; RTV lowers it', () => {
  const sid = Number(db.prepare("INSERT INTO suppliers (name) VALUES ('BioTech')").run().lastInsertRowid);
  const p = prod('Buy');
  const item = { product_id: p, batch_number: 'B1', expiry_date: day(365), quantity: 10, cost_price: 500, margin_pct: 20, selling_price: 600 };
  const draft = core.savePurchase(db, actor, { supplier_id: sid, payment_type: 'credit', items: [item], approve: false });
  assert.equal(core.supplierBalance(db, sid), 0); // drafts do nothing
  core.savePurchase(db, actor, { id: draft.id, supplier_id: sid, payment_type: 'credit', items: [item], approve: true });
  assert.equal(core.supplierBalance(db, sid), 5000);
  const b = (db.prepare('SELECT * FROM batches WHERE product_id=?').get(p) as any);
  assert.equal(b.quantity, 10);
  assert.throws(() => core.savePurchase(db, actor, { id: draft.id, supplier_id: sid, payment_type: 'credit', items: [item], approve: true })); // immutable
  const cash = core.savePurchase(db, actor, { supplier_id: sid, payment_type: 'cash', items: [{ ...item, batch_number: 'B2' }], approve: true });
  assert.ok(cash.id); assert.equal(core.supplierBalance(db, sid), 5000); // cash purchases are not debt
  core.createRtv(db, actor, { supplier_id: sid, items: [{ batch_id: b.id, quantity: 4 }] });
  assert.equal(qty(b.id), 6); assert.equal(core.supplierBalance(db, sid), 3000);
  assert.throws(() => core.createRtv(db, actor, { supplier_id: sid, items: [{ batch_id: b.id, quantity: 99 }] }));
});

test('transfers move stock only when received', () => {
  db.prepare("INSERT INTO branches (name) VALUES ('B2')").run();
  const p = prod('Tr'); const b = batch(p, 't', day(90), 10, 10, 20);
  const t = core.createTransfer(db, actor, { from_branch: 1, to_branch: 2, items: [{ batch_id: b, quantity: 4 }] });
  assert.equal(qty(b), 10);
  assert.throws(() => core.transitionTransfer(db, actor, t.id, 'receive')); // must be approved first
  core.transitionTransfer(db, actor, t.id, 'approve'); assert.equal(qty(b), 10);
  core.transitionTransfer(db, actor, t.id, 'receive');
  assert.equal(qty(b), 6);
  assert.equal((db.prepare('SELECT quantity q FROM batches WHERE product_id=? AND branch_id=2').get(p) as any).q, 4);
});

test('P&L math: revenue, COGS, returns, shrinkage and expenses', () => {
  const fresh = openDatabase(':memory:');
  const u = Number(fresh.prepare("INSERT INTO users (name,username,password_hash,role,branch_id) VALUES ('C','c','x','cashier',1)").run().lastInsertRowid);
  const a = { id: u, role: 'cashier', branch_id: 1 };
  core.openShift(fresh, a, 0);
  const p = Number(fresh.prepare("INSERT INTO products (brand_name) VALUES ('P')").run().lastInsertRowid);
  const b = Number(fresh.prepare("INSERT INTO batches (product_id,branch_id,batch_number,expiry_date,quantity,purchase_price,selling_price) VALUES (?,1,'x',?,100,600,1000)").run(p, day(200)).lastInsertRowid);
  const s1 = core.checkout(fresh, a, { items: [{ product_id: p, quantity: 10 }], payment_method: 'cash' }); // rev 10000 cogs 6000
  const inv = core.getInvoice(fresh, s1.id);
  core.createSalesReturn(fresh, a, { invoice_id: s1.id, items: [{ invoice_item_id: inv.items[0].id, quantity: 2 }], refund_method: 'cash' }); // -2000 rev, -1200 cogs
  core.adjustStock(fresh, a, { batch_id: b, counted_qty: 87, reason: 'damaged' }); // system 92 -> 87 : 5*600 = 3000
  fresh.prepare("INSERT INTO expenses (category,amount,date) VALUES ('rent',1000,?)").run(day(0));
  const pl = core.profitAndLoss(fresh, day(0), day(0));
  assert.equal(pl.net_revenue, 8000); assert.equal(pl.cogs, 4800); assert.equal(pl.gross_profit, 3200);
  assert.equal(pl.shrinkage, 3000); assert.equal(pl.expenses, 1000); assert.equal(pl.net_profit, -800);
});

test('audit log is append-only', () => {
  assert.throws(() => db.prepare("UPDATE audit_logs SET action_code='x'").run());
  assert.throws(() => db.prepare('DELETE FROM audit_logs').run());
});

test('shift close computes expected cash and difference', () => {
  const s = core.activeShift(db, uid)!;
  const sum = core.shiftSummary(db, s.id)!;
  const closed = core.closeShift(db, actor, sum.expected_cash - 500);
  assert.equal(closed!.difference, -500);
});

console.log(`\n${passed} tests passed`);
