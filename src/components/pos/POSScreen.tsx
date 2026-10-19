import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Barcode, Maximize2, Minus, Pause, Plus, Repeat, ShoppingBag, ShoppingCart, Trash2, UserPlus, X, FileText, Minimize2,
} from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { useAuth } from '../../lib/auth';
import { api, qs } from '../../lib/api';
import { iqd, parseNum, stockText } from '../../lib/format';
import type { CartLine, Product } from '../../types/pharmacy';
import { Badge, Empty, Modal, Skeleton, useAction, useDebounced, useToast } from '../common/ui';
import { ThermalReceiptModal } from '../common/ThermalReceiptModal';
import { ShiftDialog } from '../common/Shell';
import { AlternativeMedicineModal } from './AlternativeMedicineModal';
import { CheckoutModal } from './CheckoutModal';

type Method = 'cash' | 'card' | 'mixed' | 'qarz';
interface Cart { id: number; lines: CartLine[]; customer: { id: number; name: string } | null; discPct: string; discAmt: string; method: Method; received: string; card: string; keepExtra?: boolean; prescriptionId?: number }
const emptyCart = (id: number): Cart => ({ id, lines: [], customer: null, discPct: '', discAmt: '', method: 'cash', received: '', card: '' });

export default function POSScreen({ onSold }: { onSold: () => void }) {
  const { t } = useI18n();
  const { shift, refresh, user } = useAuth();
  const isAdmin = user?.role === 'super_admin'; // only the admin may see/change the price box
  const { toast } = useToast();
  const { run, busy } = useAction();
  const [carts, setCarts] = useState<Cart[]>([emptyCart(1)]);
  const [active, setActive] = useState(1);
  const nextId = useRef(2);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200);
  const [cat, setCat] = useState('');
  const [cats, setCats] = useState<string[]>([]);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [alt, setAlt] = useState<Product | null>(null);
  const [receipt, setReceipt] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [showCustomer, setShowCustomer] = useState(false);
  const [showRx, setShowRx] = useState(false);
  const [showShift, setShowShift] = useState(false);
  const [full, setFull] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);

  const cart = carts.find((c) => c.id === active) ?? carts[0];
  const patch = useCallback((p: Partial<Cart>) => setCarts((cs) => cs.map((c) => (c.id === active ? { ...c, ...p } : c))), [active]);

  const loadProducts = useCallback(() => {
    api.get(`/products?${qs({ q: dq, category: cat, size: 120 })}`).then((r) => setProducts(r.rows)).catch((e) => toast(e.message, 'error'));
  }, [dq, cat, toast]);
  useEffect(loadProducts, [loadProducts]);
  useEffect(() => { api.get('/categories').then(setCats).catch(() => {}); searchRef.current?.focus(); }, []);

  const [unitPick, setUnitPick] = useState<Product | null>(null);
  type U = 'pack' | 'sheet' | 'tablet';
  const sppOf = (p: Product) => Math.max(1, p.sheets_per_pack ?? 1);
  const tpsOf = (p: Product) => Math.max(1, p.tablets_per_sheet ?? 1);
  const unitsOf = (p: Product): U[] => ['pack', ...(sppOf(p) > 1 ? ['sheet' as U] : []), ...(tpsOf(p) > 1 ? ['tablet' as U] : [])];
  const sizeOf = (p: Product, u: U) => (u === 'pack' ? sppOf(p) * tpsOf(p) : u === 'sheet' ? tpsOf(p) : 1);
  const priceOf = (p: Product, u: U) => (u === 'pack' ? (p.price ?? 0)
    : u === 'sheet' ? (p.sheet_price ?? Math.round((p.price ?? 0) / sppOf(p)))
    : (p.tablet_price ?? Math.round((p.price ?? 0) / (sppOf(p) * tpsOf(p)))));
  const availOf = (p: Product, u: U) => (u === 'pack' ? (p.stock ?? 0)
    : Math.floor(((p.stock ?? 0) * sppOf(p) * tpsOf(p) + (p.loose ?? 0)) / sizeOf(p, u)));

  const addLine = useCallback((p: Product, unit: U) => {
    const max = availOf(p, unit);
    if (max <= 0) return toast(t('out_of_stock'), 'error');
    const price = priceOf(p, unit);
    const key = `${p.id}:${unit}`;
    setCarts((cs) => cs.map((c) => {
      if (c.id !== active) return c;
      const ex = c.lines.find((l) => (l.key ?? `${l.product_id}:pack`) === key);
      if (ex) {
        if (ex.quantity >= ex.max) { toast(t('err_not_enough_stock'), 'error'); return c; }
        return { ...c, lines: c.lines.map((l) => ((l.key ?? `${l.product_id}:pack`) === key ? { ...l, quantity: l.quantity + 1 } : l)) };
      }
      return { ...c, lines: [...c.lines, { key, unit, product_id: p.id, name: p.brand_name, dosage: p.dosage, unit_price: price, list_price: price, quantity: 1, max }] };
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, toast, t]);

  const addProduct = useCallback((p: Product) => {
    if ((p.stock ?? 0) <= 0 && (p.loose ?? 0) <= 0) return toast((p.total_stock ?? 0) > 0 ? t('err_expired_only') : t('out_of_stock'), 'error');
    if (unitsOf(p).length > 1) { setUnitPick(p); return; } // ask: pack, sheet or tablet?
    addLine(p, 'pack');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addLine, toast, t]);

  // USB barcode scanners "type" the code then press Enter.
  const onSearchEnter = async () => {
    const code = q.trim();
    if (!code) return;
    try {
      const p = await api.get(`/products/by-barcode/${encodeURIComponent(code)}`);
      addProduct(p); setQ('');
    } catch {
      if (products && products.length === 1) { addProduct(products[0]); setQ(''); }
      else toast(t('no_barcode_match'), 'error');
    }
  };

  const lkey = (l: CartLine) => l.key ?? `${l.product_id}:pack`;
  const setQty = (k: string, qty: number) => patch({
    lines: cart.lines.map((l) => (lkey(l) === k ? { ...l, quantity: Math.max(1, Math.min(l.max, qty)) } : l)),
  });

  const setPrice = (k: string, price: number) => patch({
    lines: cart.lines.map((l) => (lkey(l) === k ? { ...l, unit_price: Math.max(0, price) } : l)),
  });

  const subtotal = cart.lines.reduce((s, l) => s + l.unit_price * l.quantity, 0);
  const pct = Math.min(100, Number(cart.discPct) || 0);
  const discount = Math.min(subtotal, Math.round((subtotal * pct) / 100) + parseNum(cart.discAmt));
  const baseTotal = subtotal - discount;
  const itemCount = cart.lines.reduce((s, l) => s + l.quantity, 0);

  const received = parseNum(cart.received);
  // Flexible pricing: optionally count everything received as the sale (no change given).
  const extra = cart.keepExtra && cart.method === 'cash' ? Math.max(0, received - baseTotal) : 0;
  const total = baseTotal + extra;
  const cardAmt = Math.min(total, parseNum(cart.card));
  const cashDue = cart.method === 'mixed' ? total - cardAmt : total;
  const change = cart.method === 'cash' ? Math.max(0, received - total) : cart.method === 'mixed' ? Math.max(0, received - cashDue) : 0;
  const qarzPart = cart.method === 'qarz' ? Math.max(0, total - received) : 0;

  const hold = () => {
    if (!cart.lines.length) return;
    const id = nextId.current++;
    setCarts((cs) => [...cs, emptyCart(id)]);
    setActive(id);
    toast(t('sale_held'), 'info');
  };
  const clearCart = () => {
    patch({ ...emptyCart(cart.id), lines: [] });
    if (carts.length > 1) {
      setCarts((cs) => cs.filter((c) => c.id !== cart.id));
      setActive(carts.find((c) => c.id !== cart.id)!.id);
    }
  };

  const validate = (): string | null => {
    if (!shift) return t('err_no_shift');
    if (!cart.lines.length) return t('err_empty_cart');
    if (cart.method === 'qarz' && !cart.customer) return t('err_qarz_customer');
    if (cart.method === 'cash' && received && received < total) return t('err_received_less');
    return null;
  };
  const requestPay = useCallback(() => {
    const e = validate();
    if (e) { toast(e, 'error'); if (!shift) setShowShift(true); return; }
    setConfirming(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, shift, total, received]);

  const doCheckout = async () => {
    const r = await run(() => api.post('/checkout', {
      items: cart.lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity, unit: l.unit ?? 'pack',
        ...(isAdmin && l.list_price !== undefined && l.unit_price !== l.list_price ? { unit_price: l.unit_price } : {}) })),
      customer_id: cart.customer?.id ?? null, payment_method: cart.method,
      cash_received: cart.method === 'card' ? 0 : received || (cart.method === 'qarz' ? 0 : cashDue),
      card_amount: cart.method === 'mixed' ? cardAmt : 0,
      discount_pct: pct, discount_amount: parseNum(cart.discAmt), extra_amount: extra, prescription_id: cart.prescriptionId ?? null,
    }));
    setConfirming(false);
    if (r) {
      setReceipt(r.id);
      if (carts.length > 1) { setCarts((cs) => cs.filter((c) => c.id !== cart.id)); setActive(carts.find((c) => c.id !== cart.id)!.id); }
      else patch({ ...emptyCart(cart.id) });
      loadProducts(); onSold();
    }
  };

  // Keyboard shortcuts: F2 search, F4 pay, F8 hold, Esc clear
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (confirming || receipt || alt || showCustomer || showRx || showShift) return;
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === 'F4') { e.preventDefault(); requestPay(); }
      else if (e.key === 'F8') { e.preventDefault(); hold(); }
      else if (e.key === 'Escape') { setQ(''); if (document.activeElement === document.body) clearCart(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const toggleFull = () => {
    if (!document.fullscreenElement) { root.current?.requestFullscreen?.(); setFull(true); } else { document.exitFullscreen?.(); setFull(false); }
  };

  const loadRx = async (id: number) => {
    const rx = await api.get(`/prescriptions/${id}`);
    const lines: CartLine[] = [];
    for (const it of rx.items) {
      const found = await api.get(`/products?${qs({ q: it.brand_name, size: 20 })}`);
      const p: Product | undefined = found.rows.find((x: Product) => x.id === it.product_id);
      if (!p || (p.stock ?? 0) <= 0) { toast(`${it.brand_name}: ${t('out_of_stock')}`, 'error'); continue; }
      lines.push({ key: `${p.id}:pack`, unit: 'pack', product_id: p.id, name: p.brand_name, dosage: p.dosage, unit_price: p.price ?? 0, list_price: p.price ?? 0, quantity: Math.min(it.quantity, p.stock ?? 0), max: p.stock ?? 0 });
    }
    patch({ lines, prescriptionId: id });
    setShowRx(false);
  };

  const quick = [5000, 10000, 25000, 50000];
  const methods: [Method, string][] = [['cash', 'pay_cash'], ['card', 'pay_card'], ['mixed', 'pay_mixed'], ['qarz', 'pay_qarz']];
  const dosageOf = (p: Product) => p.dosage ?? '';

  return (
    <div ref={root} className="h-full flex flex-col lg:flex-row bg-slate-100 min-h-0">
      {/* Product panel */}
      <section className="flex-1 min-w-0 flex flex-col min-h-0 lg:max-w-[62%]">
        <div className="bg-slate-900 p-3 space-y-3 no-print">
          <div className="flex items-center justify-between text-white">
            <h2 className="font-extrabold flex items-center gap-2"><ShoppingBag size={18} />{t('medicine_store')}</h2>
            <div className="flex items-center gap-1">
              <button className="p-1.5 rounded-lg hover:bg-slate-700 text-xs flex items-center gap-1" onClick={() => setShowRx(true)}><FileText size={16} />{t('eprescriptions')}</button>
              <button className="p-1.5 rounded-lg hover:bg-slate-700" onClick={toggleFull}>{full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>
            </div>
          </div>
          <div className="relative">
            <Barcode size={18} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input ref={searchRef} className="w-full rounded-xl bg-white ps-10 pe-3 py-2.5 text-sm outline-none" value={q} autoFocus
              placeholder={`${t('search_or_scan')} (F2)`} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onSearchEnter()} />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {['', ...cats].map((c) => (
              <button key={c || 'all'} onClick={() => setCat(c)} className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${cat === c ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'}`}>
                {c || t('all_categories')}</button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {!products ? <Skeleton rows={6} /> : products.length === 0 ? <Empty icon={<ShoppingBag size={36} />} text={t('no_products_found')} /> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {products.map((p) => {
                const out = (p.stock ?? 0) <= 0 && (p.loose ?? 0) <= 0;
                return (
                  <div key={p.id} className={`card !p-3 flex flex-col gap-1 ${out ? 'opacity-60' : 'hover:border-blue-400 cursor-pointer'}`} onClick={() => !out && addProduct(p)}>
                    <div className="flex items-start justify-between gap-1">
                      <div className="font-extrabold text-sm leading-tight">{p.brand_name} <span className="text-slate-500 font-medium">{dosageOf(p)}</span></div>
                      {p.is_rx ? <Badge tone="purple">Rx</Badge> : null}
                    </div>
                    <div className="text-xs text-slate-500 truncate">{p.generic_name || '—'} • {p.unit}</div>
                    <div className="flex items-center justify-between mt-1">
                      <b className="text-blue-600">{iqd(p.price)}</b>
                      {out ? <span className="text-xs font-bold text-red-600">{t('out_of_stock')}</span> : <span className="text-xs font-bold text-emerald-600">{unitsOf(p).length > 1 ? stockText(p.stock ?? 0, p.loose ?? 0, sppOf(p), tpsOf(p), t) : `${p.stock} ${t('pcs')}`}</span>}
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>{p.shelf_rack || ''}</span><span>{p.nearest_expiry?.slice(0, 7) ?? ''}</span>
                    </div>
                    <button className="text-[11px] font-bold text-blue-600 flex items-center gap-1 self-start" onClick={(e) => { e.stopPropagation(); setAlt(p); }}>
                      <Repeat size={12} />{t('alternatives')}</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Cart panel */}
      <section className="w-full lg:w-[38%] lg:min-w-[340px] bg-white border-s border-slate-200 flex flex-col min-h-0 max-lg:h-[70vh]">
        <div className="p-3 border-b border-slate-200 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-extrabold flex items-center gap-2"><ShoppingCart size={18} />{t('purchase_receipt')}</h2>
            <button className="text-xs font-bold text-blue-600 flex items-center gap-1" onClick={() => setShowCustomer(true)}>
              <UserPlus size={14} />{cart.customer ? cart.customer.name : t('select_customer')}</button>
          </div>
          {carts.length > 1 && (
            <div className="flex gap-1 overflow-x-auto">
              {carts.map((c, i) => (
                <button key={c.id} onClick={() => setActive(c.id)} className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold ${c.id === active ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                  #{i + 1} ({c.lines.length})</button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {cart.lines.length === 0 ? <Empty icon={<ShoppingBag size={40} />} text={t('receipt_empty')} /> : (
            <ul className="space-y-2">
              {cart.lines.map((l) => (
                <li key={lkey(l)} className="rounded-xl border border-slate-200 p-2">
                  <div className="flex justify-between gap-2">
                    <div className="text-sm font-bold">{l.name} <span className="text-slate-500 font-medium">{l.dosage}</span>
                      {l.unit && l.unit !== 'pack' && <span className={`ms-1 text-[11px] px-1.5 py-0.5 rounded-md ${l.unit === 'sheet' ? 'bg-violet-100 text-violet-700' : 'bg-amber-100 text-amber-700'}`}>{t(l.unit === 'sheet' ? 'unit_sheet' : 'unit_tablet')}</span>}</div>
                    <button onClick={() => patch({ lines: cart.lines.filter((x) => lkey(x) !== lkey(l)) })} className="text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <div className="flex items-center gap-1">
                      <button className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center" onClick={() => setQty(lkey(l), l.quantity - 1)}><Minus size={14} /></button>
                      <input className="w-12 text-center text-sm font-bold border rounded-lg py-1" value={l.quantity} onChange={(e) => setQty(lkey(l), parseNum(e.target.value) || 1)} />
                      <button className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center" onClick={() => setQty(lkey(l), l.quantity + 1)}><Plus size={14} /></button>
                      {isAdmin && <span className="text-xs text-slate-500 ms-2">×</span>}
                      {isAdmin && (
                        <input className={`w-20 text-center text-sm font-bold border rounded-lg py-1 ${l.list_price !== undefined && l.unit_price !== l.list_price ? 'border-amber-400 bg-amber-50' : ''}`}
                          inputMode="numeric" title={t('selling_price')} value={l.unit_price}
                          onFocus={(e) => e.target.select()} onChange={(e) => setPrice(lkey(l), parseNum(e.target.value))} />
                      )}
                    </div>
                    <b className="text-sm">{iqd(l.unit_price * l.quantity)}</b>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-slate-200 p-3 space-y-3 bg-slate-50">
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">{t('discount')} %</label><input className="input" inputMode="decimal" value={cart.discPct} onChange={(e) => patch({ discPct: e.target.value })} /></div>
            <div><label className="label">{t('discount')} د.ع</label><input className="input" inputMode="numeric" value={cart.discAmt} onChange={(e) => patch({ discAmt: e.target.value })} /></div>
          </div>
          <div className="flex items-end justify-between">
            <span className="text-xs text-slate-500">{t('items')}: <b>{itemCount}</b>{discount > 0 && <> • {t('discount')}: -{iqd(discount)}</>}</span>
            <span className="text-2xl font-extrabold text-blue-600">{iqd(total)}</span>
          </div>

          <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-200 p-1">
            {methods.map(([m, k]) => (
              <button key={m} onClick={() => patch({ method: m })} className={`rounded-lg py-1.5 text-xs font-bold ${cart.method === m ? 'bg-white text-blue-700 shadow' : 'text-slate-600'}`}>{t(k)}</button>
            ))}
          </div>

          {cart.method === 'mixed' && (
            <div><label className="label">{t('pay_card')} د.ع</label><input className="input" inputMode="numeric" value={cart.card} onChange={(e) => patch({ card: e.target.value })} /></div>
          )}
          {(cart.method === 'cash' || cart.method === 'mixed' || cart.method === 'qarz') && (
            <div>
              <label className="label">{cart.method === 'qarz' ? t('down_payment') : t('amount_received')}</label>
              <input className="input" inputMode="numeric" value={cart.received} onChange={(e) => patch({ received: e.target.value })} />
              <div className="flex flex-wrap gap-1 mt-1">
                {cart.method !== 'qarz' && <button className="btn-ghost !py-1 !px-2 !text-xs" onClick={() => patch({ received: String(cashDue) })}>{t('exact')}</button>}
                {quick.map((v) => <button key={v} className="btn-ghost !py-1 !px-2 !text-xs" onClick={() => patch({ received: String(v) })}>{v.toLocaleString('en-US')}</button>)}
              </div>
              {cart.method === 'cash' && (received > baseTotal || cart.keepExtra) && (
                <label className="mt-2 flex items-center gap-2 text-sm font-bold text-amber-700">
                  <input type="checkbox" checked={!!cart.keepExtra} onChange={(e) => patch({ keepExtra: e.target.checked })} />{t('keep_extra')}</label>
              )}
              {extra > 0 && (
                <div className="mt-2 rounded-xl bg-amber-50 border border-amber-200 p-2 flex justify-between text-amber-700 font-extrabold">
                  <span>{t('extra_amount')}</span><span>+{iqd(extra)}</span></div>
              )}
              {cart.method !== 'qarz' && change > 0 && (
                <div className="mt-2 rounded-xl bg-emerald-50 border border-emerald-200 p-2 flex justify-between text-emerald-700 font-extrabold">
                  <span>{t('change')}</span><span>{iqd(change)}</span></div>
              )}
              {cart.method === 'qarz' && <div className="mt-2 text-xs font-bold text-orange-600">{t('pay_qarz')}: {iqd(qarzPart)}</div>}
            </div>
          )}

          <div className="flex gap-2">
            <button className="btn-ghost" title="F8" onClick={hold} disabled={!cart.lines.length}><Pause size={16} />{t('hold')}</button>
            <button className="btn-ghost" title="Esc" onClick={clearCart} disabled={!cart.lines.length && carts.length === 1}><X size={16} /></button>
            <button className="btn-green flex-1" title="F4" onClick={requestPay} disabled={busy || !cart.lines.length}>{t('pay')} (F4)</button>
          </div>
        </div>
      </section>

      {alt && <AlternativeMedicineModal product={alt} onClose={() => setAlt(null)} onPick={addProduct} />}
      {confirming && <CheckoutModal busy={busy} onClose={() => setConfirming(false)} onConfirm={doCheckout}
        s={{ items: itemCount, subtotal, discount, total, method: cart.method, customer: cart.customer?.name,
          cash: cart.method === 'cash' ? total : cart.method === 'mixed' ? cashDue : cart.method === 'qarz' ? Math.min(total, received) : 0,
          card: cart.method === 'card' ? total : cart.method === 'mixed' ? cardAmt : 0, qarz: qarzPart, change, extra }} />}
      {unitPick && (
        <Modal title={`${t(unitsOf(unitPick).length > 2 ? 'choose_unit_3' : 'choose_unit')} — ${unitPick.brand_name}`} onClose={() => setUnitPick(null)}>
          <div className={`grid gap-3 ${unitsOf(unitPick).length > 2 ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {unitsOf(unitPick).map((u, i) => {
              const tone = u === 'pack' ? 'border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700' : u === 'sheet' ? 'border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700' : 'border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700';
              const avail = availOf(unitPick, u);
              return (
                <button key={u} autoFocus={i === 0} disabled={avail <= 0} className={`rounded-2xl border-2 p-4 text-center disabled:opacity-40 ${tone}`}
                  onClick={() => { addLine(unitPick, u); setUnitPick(null); }}>
                  <div className="text-lg font-extrabold">{t(`unit_${u}`)}</div>
                  <div className="text-sm font-bold text-slate-800">{iqd(priceOf(unitPick, u))}</div>
                  <div className="text-xs text-slate-500">{avail} {t(`unit_${u}s`)}</div>
                </button>
              );
            })}
          </div>
        </Modal>
      )}
      {receipt && <ThermalReceiptModal invoiceId={receipt} onClose={() => { setReceipt(null); searchRef.current?.focus(); }} />}
      {showCustomer && <CustomerPicker onClose={() => setShowCustomer(false)} onPick={(c) => { patch({ customer: c }); setShowCustomer(false); }} />}
      {showRx && <RxPicker onClose={() => setShowRx(false)} onPick={loadRx} />}
      {showShift && <ShiftDialog onClose={() => setShowShift(false)} onDone={() => { setShowShift(false); refresh(); }} />}
    </div>
  );
}

function CustomerPicker({ onClose, onPick }: { onClose: () => void; onPick: (c: { id: number; name: string } | null) => void }) {
  const { t } = useI18n();
  const { run } = useAction();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [rows, setRows] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  useEffect(() => { api.get(`/customers?${qs({ q: dq })}`).then(setRows).catch(() => {}); }, [dq]);
  const create = async () => {
    const r = await run(() => api.post('/customers', { name, phone }), t('saved'));
    if (r) onPick({ id: r.id, name });
  };
  const list = useMemo(() => rows.slice(0, 8), [rows]);
  return (
    <Modal title={t('select_customer')} onClose={onClose}>
      <input className="input mb-3" autoFocus placeholder={t('search_customer')} value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="divide-y divide-slate-100 mb-4">
        <li><button className="w-full text-start py-2 text-sm text-slate-500" onClick={() => onPick(null)}>{t('walk_in')}</button></li>
        {list.map((c) => (
          <li key={c.id}><button className="w-full text-start py-2 flex justify-between text-sm hover:bg-slate-50" onClick={() => onPick({ id: c.id, name: c.name })}>
            <span className="font-bold">{c.name} <span className="text-slate-400 font-normal">{c.phone}</span></span>
            {c.balance > 0 && <span className="text-orange-600 font-bold">{iqd(c.balance)}</span>}</button></li>
        ))}
      </ul>
      <div className="border-t pt-3">
        <div className="card-title mb-2">{t('new_customer')}</div>
        <div className="grid grid-cols-2 gap-2">
          <input className="input" placeholder={t('name')} value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" placeholder={t('phone')} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <button className="btn-primary mt-2" disabled={!name.trim()} onClick={create}><UserPlus size={16} />{t('add_customer')}</button>
      </div>
    </Modal>
  );
}

function RxPicker({ onClose, onPick }: { onClose: () => void; onPick: (id: number) => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { api.get('/prescriptions').then(setRows).catch(() => setRows([])); }, []);
  return (
    <Modal title={t('eprescriptions')} onClose={onClose}>
      {!rows ? <Skeleton rows={3} /> : rows.length === 0 ? <Empty text={t('no_requests')} /> : (
        <ul className="divide-y divide-slate-100">
          {rows.filter((r) => r.item_count > 0).map((r) => (
            <li key={r.id} className="py-2 flex items-center justify-between gap-2">
              <div><div className="font-bold text-sm">{r.patient_name}</div>
                <div className="text-xs text-slate-500">{r.doctor_name} • {r.item_count} {t('medicines')}</div></div>
              <div className="flex items-center gap-2">
                <Badge tone={r.status === 'dispensed' ? 'green' : 'amber'}>{t(r.status === 'dispensed' ? 'status_dispensed' : 'status_sent')}</Badge>
                <button className="btn-primary !py-1" onClick={() => onPick(r.id)}>{t('load_to_cart')}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
