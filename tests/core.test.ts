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
  const early = batch(p, 'EARLY', day(60), 3, 80, 500);
  const r = core.checkout(db, actor, { items: [{ product_id: p, quantity: 5 }], payment_method: 'cash', cash_received: 2000 });
  assert.equal(qty(early), 0); assert.equal(qty(late), 8);
  const inv = core.getInvoice(db, r.id);
  assert.equal(inv.items.length, 2);
  assert.equal(inv.grand_total, 3 * 500 + 2 * 250);
  assert.equal(inv.change_amount, 0);
  assert.equal(inv.items.find((i: any) => i.batch_number === 'EARLY').purchase_price, 80); // stored for COGS
});

test('fixed-price branch (Novera): nobody can change the selling price at the till (admin included)', () => {
  const p = prod('Flex'); batch(p, 'F1', day(200), 5, 1500, 3000);
  const admin = { ...actor, role: 'super_admin' };
  throwsCode(() => core.checkout(db, actor, { items: [{ product_id: p, quantity: 1, unit_price: 4000 }], payment_method: 'cash', cash_received: 5000 }), 'FORBIDDEN');
  throwsCode(() => core.checkout(db, admin, { items: [{ product_id: p, quantity: 1, unit_price: 2000 }], payment_method: 'cash', cash_received: 5000 }), 'FORBIDDEN');
  const r2 = core.checkout(db, actor, { items: [{ product_id: p, quantity: 1 }], payment_method: 'cash', cash_received: 3000 });
  assert.equal(core.getInvoice(db, r2.id).grand_total, 3000); // no override = list price
});

test('flexible-price branch (Link): staff can type a higher or lower price; logged; 250 steps', () => {
  const f = openDatabase(':memory:');
  f.prepare("INSERT INTO branches (name, flexible_prices) VALUES ('Link Pharmacy', 1)").run(); // branch 2
  const u = Number(f.prepare("INSERT INTO users (name,username,password_hash,role,branch_id) VALUES ('L','l','x','cashier',2)").run().lastInsertRowid);
  const link = { id: u, role: 'cashier', branch_id: 2 };
  core.openShift(f, link, 0);
  const p = Number(f.prepare("INSERT INTO products (brand_name, sheets_per_pack) VALUES ('Med', 2)").run().lastInsertRowid);
  f.prepare("INSERT INTO batches (product_id,branch_id,batch_number,expiry_date,quantity,purchase_price,selling_price) VALUES (?,2,'L1',?,10,1000,3000)").run(p, day(200));
  const up = core.checkout(f, link, { items: [{ product_id: p, quantity: 2, unit_price: 5000 }], payment_method: 'cash', cash_received: 10000 });
  assert.equal(core.getInvoice(f, up.id).grand_total, 10000); // real price 5,000 instead of 3,000
  const down = core.checkout(f, link, { items: [{ product_id: p, quantity: 1, unit: 'sheet', unit_price: 1250 }], payment_method: 'cash', cash_received: 1250 });
  assert.equal(core.getInvoice(f, down.id).grand_total, 1250);
  const logged = f.prepare("SELECT details_json details FROM audit_logs WHERE action_code='PRICE_AT_TILL'").all() as any[];
  assert.equal(logged.length, 2);
  assert.deepEqual(JSON.parse(logged[0].details), { invoice: core.getInvoice(f, up.id).invoice_number, branch: 2, product_id: p, unit: 'pack', list_price: 3000, sold_price: 5000 });
  // The corrected till price is saved as the branch's new price: next sale uses it without typing.
  assert.equal((f.prepare('SELECT selling_price s FROM batches WHERE product_id = ?').get(p) as any).s, 5000);
  assert.equal((f.prepare('SELECT sheet_price s FROM product_branch WHERE product_id = ? AND branch_id = 2').get(p) as any).s, 1250);
  const next = core.checkout(f, link, { items: [{ product_id: p, quantity: 1, unit: 'sheet' }], payment_method: 'cash', cash_received: 1250 });
  assert.equal(core.getInvoice(f, next.id).grand_total, 1250);
  assert.equal((f.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action_code='PRICE_CHANGE'").get() as any).c, 2);
  throwsCode(() => core.checkout(f, link, { items: [{ product_id: p, quantity: 1, unit_price: 3100 }], payment_method: 'cash', cash_received: 5000 }), 'PRICE_INVALID');
  throwsCode(() => core.checkout(f, link, { items: [{ product_id: p, quantity: 1, unit_price: 0 }], payment_method: 'cash', cash_received: 5000 }), 'PRICE_INVALID');
  // Switching the branch back to fixed prices blocks it again.
  f.prepare('UPDATE branches SET flexible_prices = 0 WHERE id = 2').run();
  throwsCode(() => core.checkout(f, link, { items: [{ product_id: p, quantity: 1, unit_price: 5000 }], payment_method: 'cash', cash_received: 5000 }), 'FORBIDDEN');
});

test('nobody can sell above the price: extra cash is given back as change', () => {
  const p = prod('Keep'); batch(p, 'K1', day(200), 5, 1500, 1000);
  const admin = { ...actor, role: 'super_admin' };
  throwsCode(() => core.checkout(db, actor, { items: [{ product_id: p, quantity: 1 }], payment_method: 'cash', cash_received: 3000, extra_amount: 2000 }), 'FORBIDDEN');
  throwsCode(() => core.checkout(db, admin, { items: [{ product_id: p, quantity: 1 }], payment_method: 'cash', cash_received: 3000, extra_amount: 2000 }), 'FORBIDDEN');
  const r = core.checkout(db, actor, { items: [{ product_id: p, quantity: 1 }], payment_method: 'cash', cash_received: 3000 });
  const inv = core.getInvoice(db, r.id);
  assert.equal(inv.grand_total, 1000); assert.equal(inv.cash_amount, 1000); assert.equal(inv.change_amount, 2000); assert.equal(inv.discount_amount, 0);
});

test('sell by pack or by sheet: opens a pack, tracks loose sheets, no overselling', () => {
  const p = prod('Strip');
  db.prepare('UPDATE products SET sheets_per_pack = 2 WHERE id = ?').run(p);
  db.prepare('INSERT INTO product_branch (product_id, branch_id, sheet_price) VALUES (?, 1, 3500)').run(p);
  const b = batch(p, 'S1', day(200), 3, 4000, 6000); // 3 packs = 6 sheets, pack cost 4000, pack price 6000
  const loose = () => (db.prepare('SELECT loose_units l FROM batches WHERE id=?').get(b) as any).l;
  // 1 sheet: opens a pack -> 2 packs + 1 loose sheet
  const r1 = core.checkout(db, actor, { items: [{ product_id: p, quantity: 1, unit: 'sheet' }], payment_method: 'cash', cash_received: 3500 });
  const i1 = core.getInvoice(db, r1.id);
  assert.equal(i1.grand_total, 3500); assert.equal(qty(b), 2); assert.equal(loose(), 1);
  assert.equal(i1.items[0].purchase_price, 2000); // sheet cost = pack cost / 2
  // 1 pack + 1 sheet in the same sale: uses the loose sheet first, then a whole pack
  const r2 = core.checkout(db, actor, { items: [{ product_id: p, quantity: 1, unit: 'pack' }, { product_id: p, quantity: 1, unit: 'sheet' }], payment_method: 'cash', cash_received: 9500 });
  assert.equal(core.getInvoice(db, r2.id).grand_total, 6000 + 3500); assert.equal(qty(b), 1); assert.equal(loose(), 0);
  // only 1 pack (2 sheets) left: 3 sheets must fail, 2 packs must fail
  assert.throws(() => core.checkout(db, actor, { items: [{ product_id: p, quantity: 3, unit: 'sheet' }], payment_method: 'cash', cash_received: 99999 }));
  assert.throws(() => core.checkout(db, actor, { items: [{ product_id: p, quantity: 2, unit: 'pack' }], payment_method: 'cash', cash_received: 99999 }));
  assert.equal(qty(b), 1); assert.equal(loose(), 0); // failed sales change nothing
  // returning a sheet puts it back as a loose sheet; two loose sheets close back into a pack
  const line = i1.items[0];
  core.createSalesReturn(db, actor, { invoice_id: r1.id, items: [{ invoice_item_id: line.id, quantity: 1 }], refund_method: 'cash' });
  assert.equal(qty(b), 1); assert.equal(loose(), 1);
});

test('pack / sheet / tablet: 1 pack = 3 sheets x 10 tablets', () => {
  const p = prod('Tabs');
  db.prepare('UPDATE products SET sheets_per_pack = 3, tablets_per_sheet = 10 WHERE id = ?').run(p);
  const b = batch(p, 'T1', day(200), 2, 6000, 7500); // 2 packs = 60 tablets; sheet 2500, tablet 250
  const loose = () => (db.prepare('SELECT loose_units l FROM batches WHERE id=?').get(b) as any).l;
  // 4 tablets: opens one pack -> 1 pack + 26 loose tablets
  const r1 = core.checkout(db, actor, { items: [{ product_id: p, quantity: 4, unit: 'tablet' }], payment_method: 'cash', cash_received: 1000 });
  const i1 = core.getInvoice(db, r1.id);
  assert.equal(i1.grand_total, 4 * 250); assert.equal(qty(b), 1); assert.equal(loose(), 26);
  assert.equal(i1.items[0].purchase_price, 200); // tablet cost = 6000 / 30
  // 1 sheet (10 tablets) from the loose ones
  const r2 = core.checkout(db, actor, { items: [{ product_id: p, quantity: 1, unit: 'sheet' }], payment_method: 'cash', cash_received: 2500 });
  assert.equal(core.getInvoice(db, r2.id).grand_total, 2500); assert.equal(qty(b), 1); assert.equal(loose(), 16);
  // last whole pack still sellable as a pack
  core.checkout(db, actor, { items: [{ product_id: p, quantity: 1, unit: 'pack' }], payment_method: 'cash', cash_received: 7500 });
  assert.equal(qty(b), 0); assert.equal(loose(), 16);
  // no whole pack left; 2 sheets need 20 tablets but only 16 remain
  assert.throws(() => core.checkout(db, actor, { items: [{ product_id: p, quantity: 1, unit: 'pack' }], payment_method: 'cash', cash_received: 99999 }));
  assert.throws(() => core.checkout(db, actor, { items: [{ product_id: p, quantity: 2, unit: 'sheet' }], payment_method: 'cash', cash_received: 99999 }));
  // returning the 4 tablets: 20 loose, still less than a pack (30)
  core.createSalesReturn(db, actor, { invoice_id: r1.id, items: [{ invoice_item_id: i1.items[0].id, quantity: 4 }], refund_method: 'cash' });
  assert.equal(qty(b), 0); assert.equal(loose(), 20);
});

test('medicines with 1 sheet per pack behave exactly as before', () => {
  const p = prod('Whole'); const b = batch(p, 'W1', day(200), 4, 1000, 2000);
  const r = core.checkout(db, actor, { items: [{ product_id: p, quantity: 2, unit: 'sheet' }], payment_method: 'cash', cash_received: 4000 });
  assert.equal(core.getInvoice(db, r.id).grand_total, 4000); assert.equal(qty(b), 2);
});

test('discount limits default to 0: no discount, lower amount rejected, percentage ignored', () => {
  const p = prod('Lower'); batch(p, 'L1', day(200), 5, 1500, 3000);
  assert.deepEqual(core.getDiscountLimits(db), { cashier: 0, pharmacist: 0 });
  throwsCode(() => core.checkout(db, actor, { items: [{ product_id: p, quantity: 1 }], payment_method: 'cash', discount_amount: 250 }), 'DISCOUNT_OVER_LIMIT');
  throwsCode(() => core.checkout(db, actor, { items: [{ product_id: p, quantity: 1 }], payment_method: 'cash', cash_received: 2500 }), 'BUSINESS_RULE');
  const r = core.checkout(db, actor, { items: [{ product_id: p, quantity: 1 }], payment_method: 'cash', cash_received: 3000, discount_pct: 50 });
  const inv = core.getInvoice(db, r.id);
  assert.equal(inv.grand_total, 3000); assert.equal(inv.discount_amount, 0);
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

test('mixed payment and validation (no discount applied)', () => {
  const p = prod('Disc'); const b = batch(p, 'd', day(90), 50, 500, 1000);
  const r = core.checkout(db, actor, { items: [{ product_id: p, quantity: 10 }], payment_method: 'mixed', card_amount: 4000, cash_received: 10000 });
  const inv = core.getInvoice(db, r.id);
  assert.equal(inv.subtotal, 10000); assert.equal(inv.discount_amount, 0); assert.equal(inv.grand_total, 10000);
  assert.equal(inv.card_amount, 4000); assert.equal(inv.cash_amount, 6000); assert.equal(inv.change_amount, 4000);
  assert.equal(qty(b), 40);
  assert.throws(() => core.checkout(db, actor, { items: [{ product_id: p, quantity: 1 }], payment_method: 'cash', cash_received: 5 }));
});

test('qarz needs a customer; balance, payments and returns-to-debt', () => {
  const p = prod('Qarz'); batch(p, 'q', day(90), 20, 100, 1000);
  throwsCode(() => core.checkout(db, actor, { items: [{ product_id: p, quantity: 1 }], payment_method: 'qarz' }), 'BUSINESS_RULE');
  const cid = Number(db.prepare("INSERT INTO customers (name, branch_id) VALUES ('Ali', 1)").run().lastInsertRowid);
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

test('returns restock the original batch at full price', () => {
  const p = prod('Ret'); const b = batch(p, 'r', day(90), 10, 400, 1000);
  const r = core.checkout(db, actor, { items: [{ product_id: p, quantity: 4 }], payment_method: 'cash' });
  assert.equal(qty(b), 6);
  const inv = core.getInvoice(db, r.id);
  const ret = core.createSalesReturn(db, actor, { invoice_id: r.id, items: [{ invoice_item_id: inv.items[0].id, quantity: 4 }], refund_method: 'cash' });
  assert.equal(ret.total, 4000);
  assert.equal(qty(b), 10);
});

test('discount limits: admin-only settings, 0-100 whole numbers', () => {
  throwsCode(() => core.setDiscountLimits(db, actor, { cashier: 10 }), 'FORBIDDEN');
  const admin = { id: uid, role: 'super_admin', branch_id: 1 };
  throwsCode(() => core.setDiscountLimits(db, admin, { cashier: 101 }), 'BUSINESS_RULE');
  throwsCode(() => core.setDiscountLimits(db, admin, { cashier: 2.5 }), 'BUSINESS_RULE');
  throwsCode(() => core.setDiscountLimits(db, admin, { pharmacist: -1 }), 'BUSINESS_RULE');
  assert.deepEqual(core.setDiscountLimits(db, admin, { cashier: 10 }), { cashier: 10, pharmacist: 0 });
  const log = db.prepare("SELECT details_json FROM audit_logs WHERE action_code='DISCOUNT_LIMITS_UPDATE' ORDER BY id DESC").get() as any;
  assert.deepEqual(JSON.parse(log.details_json).after, { cashier: 10, pharmacist: 0 });
});

test('discount cap = subtotal x role %, rounded down to 250; 250 steps only; checked on the server', () => {
  // cashier is 10% from the previous test
  const p = prod('Cap'); batch(p, 'cp', day(200), 50, 1000, 5250);
  const sale = (discount_amount: number, a = actor) => core.checkout(db, a, { items: [{ product_id: p, quantity: 1 }], payment_method: 'cash', discount_amount });
  throwsCode(() => sale(750), 'DISCOUNT_OVER_LIMIT');   // 10% of 5,250 = 525 -> cap 500
  throwsCode(() => sale(300), 'DISCOUNT_INVALID');      // not a 250 step
  throwsCode(() => sale(-250), 'DISCOUNT_INVALID');
  const r = sale(500);
  const inv = core.getInvoice(db, r.id);
  assert.equal(inv.subtotal, 5250); assert.equal(inv.discount_amount, 500); assert.equal(inv.grand_total, 4750);
  const log = JSON.parse((db.prepare("SELECT details_json FROM audit_logs WHERE action_code='POS_CHECKOUT' ORDER BY id DESC").get() as any).details_json);
  assert.equal(log.invoice, inv.invoice_number); assert.equal(log.discount, 500);
  assert.equal(log.discount_by.user_id, uid); assert.equal(log.discount_by.username, 'c'); assert.equal(log.discount_by.cap, 500);
  // No discount: nothing changes — 5,250 is paid as 5,250.
  const r2 = core.getInvoice(db, sale(0).id);
  assert.equal(r2.grand_total, 5250); assert.equal(r2.discount_amount, 0);
  // Cap rounds down to 0 -> no discount possible on that sale.
  const small = prod('Small'); batch(small, 'sm', day(200), 5, 500, 2000); // 10% of 2,000 = 200 -> cap 0
  throwsCode(() => core.checkout(db, actor, { items: [{ product_id: small, quantity: 1 }], payment_method: 'cash', discount_amount: 250 }), 'DISCOUNT_OVER_LIMIT');
  // Pharmacist has its own limit (still 0); admin is unlimited.
  const ph = { id: uid, role: 'pharmacist', branch_id: 1 };
  throwsCode(() => sale(250, ph), 'DISCOUNT_OVER_LIMIT');
  const admin = { id: uid, role: 'super_admin', branch_id: 1 };
  assert.equal(core.getInvoice(db, sale(5000, admin).id).grand_total, 250);
  throwsCode(() => sale(5500, admin), 'DISCOUNT_OVER_LIMIT');
});

test('returns are blocked once 2 days have passed since the sale', () => {
  const p = prod('Late'); const b = batch(p, 'lt', day(90), 10, 400, 1000);
  const r = core.checkout(db, actor, { items: [{ product_id: p, quantity: 2 }], payment_method: 'cash' });
  const inv = core.getInvoice(db, r.id);
  const H = 60 * 60 * 1000;
  db.prepare('UPDATE invoices SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 47 * H).toISOString(), r.id);
  core.createSalesReturn(db, actor, { invoice_id: r.id, items: [{ invoice_item_id: inv.items[0].id, quantity: 1 }], refund_method: 'cash' });
  db.prepare('UPDATE invoices SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 49 * H).toISOString(), r.id);
  throwsCode(() => core.createSalesReturn(db, actor, { invoice_id: r.id, items: [{ invoice_item_id: inv.items[0].id, quantity: 1 }], refund_method: 'cash' }), 'RETURN_EXPIRED');
  assert.equal(qty(b), 9);
});

test('purchase approval creates batches; credit raises supplier balance; RTV lowers it', () => {
  const sid = Number(db.prepare("INSERT INTO suppliers (name, branch_id) VALUES ('BioTech', 1)").run().lastInsertRowid);
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
  const b2 = { ...actor, branch_id: 2 };
  throwsCode(() => core.transitionTransfer(db, actor, t.id, 'receive'), 'FORBIDDEN'); // only the receiving branch confirms
  throwsCode(() => core.createTransfer(db, b2, { from_branch: 1, to_branch: 2, items: [{ batch_id: b, quantity: 1 }] }), 'FORBIDDEN'); // can't pull another branch's stock
  core.transitionTransfer(db, b2, t.id, 'receive');
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

test('branches are separate pharmacies: prices, suppliers, customers, P&L', () => {
  const f = openDatabase(':memory:');
  f.prepare("INSERT INTO branches (name) VALUES ('Link Pharmacy')").run(); // branch 2
  const mk = (br: number) => ({ id: Number(f.prepare("INSERT INTO users (name,username,password_hash,role,branch_id) VALUES ('U',?,'x','pharmacist',?)").run('u' + br, br).lastInsertRowid), role: 'pharmacist', branch_id: br });
  const nov = mk(1), link = mk(2);
  core.openShift(f, nov, 0); core.openShift(f, link, 0);
  // Same medicine in the shared catalogue, different prices per branch (pack price on the batch, sheet price per branch).
  const p = Number(f.prepare("INSERT INTO products (brand_name, sheets_per_pack) VALUES ('Amox', 2)").run().lastInsertRowid);
  f.prepare('INSERT INTO product_branch (product_id, branch_id, sheet_price) VALUES (?,1,3000),(?,2,3500)').run(p, p);
  const bN = Number(f.prepare("INSERT INTO batches (product_id,branch_id,batch_number,expiry_date,quantity,purchase_price,selling_price) VALUES (?,1,'n',?,10,1000,5000)").run(p, day(200)).lastInsertRowid);
  const bL = Number(f.prepare("INSERT INTO batches (product_id,branch_id,batch_number,expiry_date,quantity,purchase_price,selling_price) VALUES (?,2,'l',?,10,1000,6000)").run(p, day(200)).lastInsertRowid);
  const sN = core.checkout(f, nov, { items: [{ product_id: p, quantity: 1 }, { product_id: p, quantity: 1, unit: 'sheet' }], payment_method: 'cash' });
  const sL = core.checkout(f, link, { items: [{ product_id: p, quantity: 1 }, { product_id: p, quantity: 1, unit: 'sheet' }], payment_method: 'cash' });
  assert.equal(core.getInvoice(f, sN.id).grand_total, 5000 + 3000);
  assert.equal(core.getInvoice(f, sL.id).grand_total, 6000 + 3500);
  // Each branch sells only its own stock.
  assert.equal((f.prepare('SELECT quantity q FROM batches WHERE id=?').get(bL) as any).q, 8);
  assert.equal((f.prepare('SELECT quantity q FROM batches WHERE id=?').get(bN) as any).q, 8);
  // Suppliers and customers belong to one branch.
  const supN = Number(f.prepare("INSERT INTO suppliers (name, branch_id) VALUES ('Nov supplier', 1)").run().lastInsertRowid);
  const item = { product_id: p, batch_number: 'X', expiry_date: day(300), quantity: 1, cost_price: 100, selling_price: 200 };
  throwsCode(() => core.savePurchase(f, link, { supplier_id: supN, payment_type: 'credit', items: [item], approve: true }), 'NOT_FOUND');
  throwsCode(() => core.createRtv(f, link, { supplier_id: supN, items: [{ batch_id: bL, quantity: 1 }] }), 'NOT_FOUND');
  throwsCode(() => core.createRtv(f, nov, { supplier_id: supN, items: [{ batch_id: bL, quantity: 1 }] }), 'NOT_FOUND'); // Link's batch
  const cusN = Number(f.prepare("INSERT INTO customers (name, branch_id) VALUES ('Ali', 1)").run().lastInsertRowid);
  throwsCode(() => core.checkout(f, link, { items: [{ product_id: p, quantity: 1 }], payment_method: 'qarz', customer_id: cusN }), 'NOT_FOUND');
  throwsCode(() => core.recordCustomerPayment(f, link, { customer_id: cusN, amount: 250 }), 'NOT_FOUND');
  // Returns and stock counts only on your own branch.
  const invN = core.getInvoice(f, sN.id);
  throwsCode(() => core.createSalesReturn(f, link, { invoice_id: sN.id, items: [{ invoice_item_id: invN.items[0].id, quantity: 1 }], refund_method: 'cash' }), 'NOT_FOUND');
  assert.throws(() => core.adjustStock(f, link, { batch_id: bN, counted_qty: 0, reason: 'damaged' }));
  // P&L and expenses per branch.
  f.prepare("INSERT INTO expenses (category,amount,date,branch_id) VALUES ('rent',1000,?,2)").run(day(0));
  const plN = core.profitAndLoss(f, day(0), day(0), 1), plL = core.profitAndLoss(f, day(0), day(0), 2);
  assert.equal(plN.net_revenue, 8000); assert.equal(plN.expenses, 0);
  assert.equal(plL.net_revenue, 9500); assert.equal(plL.expenses, 1000);
  assert.equal(core.profitAndLoss(f, day(0), day(0)).net_revenue, 17500); // no branch = both
});

test('upgrade: existing data is kept for the first branch (Novera)', () => {
  const file = `/tmp/pharm-migr-${Date.now()}.db`;
  const old = openDatabase(file);
  // Simulate pre-change rows (written without branch_id) by clearing the columns, then re-run migrations on a reopen.
  old.prepare("INSERT INTO products (brand_name, sheet_price, reorder_level, supplier_id) VALUES ('Old', 1250, 7, NULL)").run();
  old.prepare("DELETE FROM product_branch").run();
  old.prepare("DELETE FROM settings WHERE key='migr_product_branch'").run();
  old.close();
  const again = openDatabase(file);
  const pb = again.prepare('SELECT * FROM product_branch').get() as any;
  assert.equal(pb.branch_id, 1); assert.equal(pb.sheet_price, 1250); assert.equal(pb.reorder_level, 7);
  again.close();
});

test('every price is payable in notes: auto sheet/tablet prices and stored prices round to 250', () => {
  const p = prod('Round'); db.prepare('UPDATE products SET sheets_per_pack = 2, tablets_per_sheet = 10 WHERE id = ?').run(p);
  batch(p, 'R1', day(200), 5, 1000, 3250); // 3,250 / 2 sheets = 1,625 -> 1,750; / 20 tablets = 162.5 -> 250
  const r = core.checkout(db, actor, { items: [{ product_id: p, quantity: 1, unit: 'sheet' }, { product_id: p, quantity: 1, unit: 'tablet' }], payment_method: 'cash', cash_received: 2000 });
  const inv = core.getInvoice(db, r.id);
  assert.deepEqual(inv.items.map((i: any) => i.unit_price).sort((a: number, b: number) => a - b), [250, 1750]);
  assert.equal(inv.grand_total % 250, 0);
  // Upgrade: odd stored prices are rounded once (nearest 250, halves up, at least 250).
  const file = `/tmp/pharm-round-${Date.now()}.db`;
  const a = openDatabase(file);
  const q = Number(a.prepare("INSERT INTO products (brand_name) VALUES ('Odd')").run().lastInsertRowid);
  a.prepare("INSERT INTO batches (product_id,branch_id,batch_number,expiry_date,quantity,purchase_price,selling_price) VALUES (?,1,'a','2030-01-01',1,1,375),(?,1,'b','2030-01-01',1,1,5230),(?,1,'c','2030-01-01',1,1,100)").run(q, q, q);
  a.prepare("INSERT INTO product_branch (product_id, branch_id, sheet_price) VALUES (?, 1, 1625)").run(q);
  a.prepare("DELETE FROM settings WHERE key='migr_round_250'").run(); a.close();
  const b2 = openDatabase(file);
  assert.deepEqual((b2.prepare('SELECT selling_price s FROM batches ORDER BY batch_number').all() as any[]).map((x) => x.s), [500, 5250, 250]);
  assert.equal((b2.prepare('SELECT sheet_price s FROM product_branch WHERE product_id = ?').get(q) as any).s, 1750);
  b2.close();
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

test('stock count corrects a batch at 0 and records loose sheets of an opened pack', () => {
  const f = openDatabase(':memory:');
  const u = Number(f.prepare("INSERT INTO users (name,username,password_hash,role,branch_id) VALUES ('A','adj','x','cashier',1)").run().lastInsertRowid);
  const a = { id: u, role: 'cashier', branch_id: 1 };
  const p = Number(f.prepare("INSERT INTO products (brand_name, sheets_per_pack) VALUES ('Tab', 3)").run().lastInsertRowid);
  const b = Number(f.prepare("INSERT INTO batches (product_id,branch_id,batch_number,expiry_date,quantity,purchase_price,selling_price) VALUES (?,1,'z',?,0,900,1500)").run(p, day(200)).lastInsertRowid);
  // 0 in the system, 4 full packs + 1 loose sheet on the shelf.
  core.adjustStock(f, a, { batch_id: b, counted_qty: 4, counted_loose: 1, reason: 'count_correction' });
  const row = f.prepare('SELECT quantity, loose_units FROM batches WHERE id = ?').get(b) as any;
  assert.equal(row.quantity, 4); assert.equal(row.loose_units, 1);
  // Loose must be less than one pack, and never negative.
  assert.throws(() => core.adjustStock(f, a, { batch_id: b, counted_qty: 4, counted_loose: 3, reason: 'count_correction' }));
  assert.throws(() => core.adjustStock(f, a, { batch_id: b, counted_qty: 4, counted_loose: -1, reason: 'count_correction' }));
  // Not sending counted_loose keeps the current loose sheets (old clients).
  core.adjustStock(f, a, { batch_id: b, counted_qty: 2, reason: 'count_correction' });
  assert.equal((f.prepare('SELECT loose_units l FROM batches WHERE id = ?').get(b) as any).l, 1);
  // Shrinkage values sheets at pack cost / 3: (0 -> 4p+1s) -3900, (4p+1s -> 2p+1s) +1800, (2p+1s -> 2p) +300.
  core.adjustStock(f, a, { batch_id: b, counted_qty: 2, counted_loose: 0, reason: 'lost' });
  const pl = core.profitAndLoss(f, day(0), day(0));
  assert.equal(pl.shrinkage, -3900 + 1800 + 300);
});

console.log(`\n${passed} tests passed`);
