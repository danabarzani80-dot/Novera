import { useEffect, useState } from 'react';
import { Boxes, ChevronLeft, ChevronRight, Edit3, Layers, Plus, Printer, RefreshCw, Search, SlidersHorizontal, Trash2, Wand2 } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { api, qs } from '../../lib/api';
import { iqd } from '../../lib/format';
import type { Product } from '../../types/pharmacy';
import { Badge, Confirm, Empty, Field, Modal, PageTitle, Skeleton, Tabs, useAction, useDebounced, useLoad } from '../common/ui';
import { useAuth } from '../../lib/auth';

const BLANK = { barcode: '', brand_name: '', generic_name: '', category: '', manufacturer: '', dosage: '', form: '', unit: 'tablet', shelf_rack: '', is_rx: false, reorder_level: 10 };

export default function ProductsCatalog() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [view, setView] = useState<'catalog' | 'reorder'>('catalog');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const [low, setLow] = useState(false);
  const [cat, setCat] = useState('');
  const [filters, setFilters] = useState(false);
  const { data, loading, reload } = useLoad(() => api.get(`/products?${qs({ q: dq, page, size: 20, low: low ? 1 : '', category: cat })}`), [dq, page, low, cat]);
  const cats = useLoad(() => api.get('/categories'), []);
  const [edit, setEdit] = useState<any>(null);
  const [batchesOf, setBatchesOf] = useState<Product | null>(null);
  const [del, setDel] = useState<Product | null>(null);
  const { run } = useAction();
  useEffect(() => setPage(1), [dq, low, cat]);
  const canEdit = user?.role !== 'cashier';

  return (
    <div className="max-w-7xl mx-auto">
      <PageTitle icon={<Boxes className="text-blue-600" />} title={t('nav_products')} subtitle={t('products_sub')}
        right={<>
          <Tabs value={view} onChange={setView} items={[{ id: 'catalog', label: t('medicine_catalog') }, { id: 'reorder', label: t('smart_reorder') }]} />
          <button className="btn-ghost !px-2" onClick={reload}><RefreshCw size={16} /></button>
          {canEdit && <button className="btn-primary" onClick={() => setEdit({ ...BLANK })}><Plus size={16} />{t('add_drug')}</button>}
        </>} />

      {view === 'reorder' ? <Reorder /> : (
        <>
          <div className="flex gap-2 mb-3 no-print">
            <div className="relative flex-1"><Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input !ps-9" placeholder={t('search_brand_barcode')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <button className="btn-ghost" onClick={() => setFilters(!filters)}><SlidersHorizontal size={16} />{t('more_filters')}</button>
          </div>
          {filters && (
            <div className="card !p-3 mb-3 flex flex-wrap gap-3 items-end">
              <Field label={t('category')}><select className="input" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">{t('all_categories')}</option>{(cats.data ?? []).map((c: string) => <option key={c}>{c}</option>)}</select></Field>
              <label className="flex items-center gap-2 text-sm font-bold pb-2"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} />{t('low_stock_only')}</label>
            </div>
          )}
          <div className="card !p-0 overflow-x-auto">
            {loading ? <div className="p-4"><Skeleton rows={8} /></div> : !data?.rows.length ? <Empty icon={<Boxes size={36} />} text={t('no_products_found')} /> : (
              <table className="w-full min-w-[900px]"><thead><tr>
                <th className="th">{t('barcode_drug')}</th><th className="th">{t('generic_ingredient')}</th><th className="th">{t('manufacturer')}</th><th className="th">{t('stock_level')}</th>
                <th className="th">{t('selling_price')}</th><th className="th">{t('category')}</th><th className="th">{t('dosage_form')}</th><th className="th">{t('shelf')}</th><th className="th">{t('expiry')}</th><th className="th" /></tr></thead>
                <tbody>{data.rows.map((p: Product) => {
                  const st = p.stock ?? 0;
                  return (<tr key={p.id}>
                    <td className="td"><div className="font-bold">{p.brand_name} {p.is_rx ? <Badge tone="purple">Rx</Badge> : null}</div><div className="text-xs text-slate-400 font-mono">{p.barcode}</div></td>
                    <td className="td">{p.generic_name}</td><td className="td">{p.manufacturer}</td>
                    <td className="td"><span className={`font-bold ${st === 0 ? 'text-red-600' : st <= p.reorder_level ? 'text-amber-600' : 'text-emerald-600'}`}>{st}</span></td>
                    <td className="td font-bold">{p.price ? iqd(p.price) : '—'}</td><td className="td">{p.category}</td>
                    <td className="td">{[p.dosage, p.form].filter(Boolean).join(' / ')}</td><td className="td">{p.shelf_rack}</td><td className="td">{p.nearest_expiry?.slice(0, 7) ?? '—'}</td>
                    <td className="td whitespace-nowrap">
                      <button className="p-1.5 text-slate-500 hover:text-blue-600" title={t('batches')} onClick={() => setBatchesOf(p)}><Layers size={16} /></button>
                      {canEdit && <><button className="p-1.5 text-slate-500 hover:text-blue-600" onClick={() => setEdit({ ...p, is_rx: !!p.is_rx })}><Edit3 size={16} /></button>
                        <button className="p-1.5 text-slate-500 hover:text-red-600" onClick={() => setDel(p)}><Trash2 size={16} /></button></>}
                    </td></tr>);
                })}</tbody></table>
            )}
            <div className="flex items-center justify-between p-3 border-t border-slate-100 text-sm">
              <span className="text-slate-500">{t('total_items')}: <b>{data?.total ?? 0}</b></span>
              <div className="flex items-center gap-2">
                <button className="btn-ghost !p-1.5" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={16} className="rtl:rotate-180" /></button>
                <span>{t('page_of', { p: page, n: data?.pages ?? 1 })}</span>
                <button className="btn-ghost !p-1.5" disabled={page >= (data?.pages ?? 1)} onClick={() => setPage(page + 1)}><ChevronRight size={16} className="rtl:rotate-180" /></button>
              </div>
            </div>
          </div>
        </>
      )}
      {edit && <ProductForm initial={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); cats.reload(); }} />}
      {batchesOf && <BatchesModal product={batchesOf} canEdit={canEdit} onClose={() => setBatchesOf(null)} />}
      {del && <Confirm title={t('delete')} message={t('confirm_delete_product', { name: del.brand_name })} onCancel={() => setDel(null)}
        onConfirm={async () => { await run(() => api.del(`/products/${del.id}`), t('deleted')); setDel(null); reload(); }} />}
    </div>
  );
}

function ProductForm({ initial, onClose, onSaved }: { initial: any; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [f, setF] = useState(initial);
  const [sup, setSup] = useState<any[]>([]);
  useEffect(() => { api.get('/suppliers').then(setSup).catch(() => {}); }, []);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    const r = await run(() => (f.id ? api.put(`/products/${f.id}`, f) : api.post('/products', f)), t('saved'));
    if (r) onSaved();
  };
  return (
    <Modal wide title={f.id ? t('edit_drug') : t('add_drug')} onClose={onClose} footer={<><button className="btn-ghost" onClick={onClose}>{t('cancel')}</button>
      <button className="btn-primary" disabled={busy || !f.brand_name.trim()} onClick={save}>{t('save')}</button></>}>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label={t('barcode')}>
          <div className="flex gap-2"><input className="input" value={f.barcode ?? ''} onChange={set('barcode')} placeholder={t('auto_barcode_hint')} />
            <button type="button" className="btn-ghost !px-2" title={t('generate')} onClick={async () => setF({ ...f, barcode: (await api.get('/barcode/next')).barcode })}><Wand2 size={16} /></button></div>
        </Field>
        <Field label={`${t('brand_name')} *`}><input className="input" value={f.brand_name} onChange={set('brand_name')} /></Field>
        <Field label={t('generic_ingredient')}><input className="input" value={f.generic_name ?? ''} onChange={set('generic_name')} /></Field>
        <Field label={t('category')}><input className="input" value={f.category ?? ''} onChange={set('category')} /></Field>
        <Field label={t('manufacturer')}><input className="input" value={f.manufacturer ?? ''} onChange={set('manufacturer')} /></Field>
        <Field label={t('dosage')}><input className="input" placeholder="500mg" value={f.dosage ?? ''} onChange={set('dosage')} /></Field>
        <Field label={t('form')}><input className="input" placeholder="Tablet" value={f.form ?? ''} onChange={set('form')} /></Field>
        <Field label={t('unit')}><input className="input" value={f.unit ?? ''} onChange={set('unit')} /></Field>
        <Field label={t('shelf')}><input className="input" value={f.shelf_rack ?? ''} onChange={set('shelf_rack')} /></Field>
        <Field label={t('reorder_level')}><input className="input" type="number" min={0} value={f.reorder_level} onChange={set('reorder_level')} /></Field>
        <Field label={t('supplier')}><select className="input" value={f.supplier_id ?? ''} onChange={set('supplier_id')}><option value="">—</option>{sup.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <label className="flex items-center gap-2 text-sm font-bold pt-6"><input type="checkbox" checked={!!f.is_rx} onChange={set('is_rx')} />{t('rx_required')}</label>
      </div>
    </Modal>
  );
}

function BatchesModal({ product, canEdit, onClose }: { product: Product; canEdit: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { run } = useAction();
  const { data, reload } = useLoad(() => api.get(`/products/${product.id}/batches`), [product.id]);
  const [price, setPrice] = useState<Record<number, string>>({});
  const tone: any = { expired: 'red', critical: 'orange', warning: 'amber', good: 'green' };
  return (
    <Modal wide title={`${t('batches')}: ${product.brand_name}`} onClose={onClose}>
      {!data ? <Skeleton /> : data.length === 0 ? <Empty text={t('no_batches')} /> : (
        <table className="w-full"><thead><tr><th className="th">{t('batch')}</th><th className="th">{t('expiry')}</th><th className="th">{t('qty')}</th><th className="th">{t('cost_price')}</th><th className="th">{t('selling_price')}</th></tr></thead>
          <tbody>{data.map((b: any) => (
            <tr key={b.id}><td className="td font-bold">{b.batch_number}</td><td className="td">{b.expiry_date} <Badge tone={tone[b.status]}>{t('st_' + b.status)}</Badge></td><td className="td">{b.quantity}</td><td className="td">{iqd(b.purchase_price)}</td>
              <td className="td">{canEdit ? (<div className="flex gap-1"><input className="input !py-1 w-28" defaultValue={b.selling_price} onChange={(e) => setPrice({ ...price, [b.id]: e.target.value })} />
                {price[b.id] !== undefined && <button className="btn-primary !py-1" onClick={async () => { await run(() => api.put(`/batches/${b.id}`, { selling_price: Number(price[b.id]) }), t('saved')); reload(); setPrice({}); }}>{t('save')}</button>}</div>) : iqd(b.selling_price)}</td></tr>))}</tbody></table>
      )}
    </Modal>
  );
}

function Reorder() {
  const { t } = useI18n();
  const { data, loading } = useLoad(() => api.get('/reorder'), []);
  const [po, setPo] = useState(false);
  if (loading) return <Skeleton rows={6} />;
  const rows: any[] = data ?? [];
  const groups = rows.reduce((m: Record<string, any[]>, r) => { (m[r.supplier_name] ||= []).push(r); return m; }, {});
  return (
    <div>
      <div className="flex justify-end mb-3"><button className="btn-primary" disabled={!rows.length} onClick={() => setPo(true)}><Printer size={16} />{t('generate_po')}</button></div>
      {rows.length === 0 ? <div className="card"><Empty text={t('nothing_to_reorder')} /></div> : Object.entries(groups).map(([sup, list]) => (
        <div key={sup} className="card !p-0 mb-3 overflow-x-auto">
          <div className="px-4 py-2 font-extrabold bg-slate-50 border-b">{sup}</div>
          <table className="w-full"><thead><tr><th className="th">{t('medicine')}</th><th className="th">{t('stock_level')}</th><th className="th">{t('reorder_level')}</th><th className="th">{t('sold_30d')}</th><th className="th">{t('suggested_qty')}</th></tr></thead>
            <tbody>{list.map((r) => <tr key={r.id}><td className="td font-bold">{r.brand_name} {r.dosage}</td><td className="td text-red-600 font-bold">{r.stock}</td><td className="td">{r.reorder_level}</td><td className="td">{r.sold_30d}</td><td className="td font-extrabold text-blue-600">{r.suggested}</td></tr>)}</tbody></table>
        </div>
      ))}
      {po && (
        <Modal wide title={t('purchase_order')} onClose={() => setPo(false)} footer={<><button className="btn-ghost" onClick={() => setPo(false)}>{t('close')}</button><button className="btn-primary" onClick={() => window.print()}><Printer size={16} />{t('print')}</button></>}>
          <div className="print-area bg-white p-4">
            <h2 className="text-lg font-extrabold mb-1">{t('purchase_order')}</h2><p className="text-xs text-slate-500 mb-3">{new Date().toLocaleDateString()}</p>
            {Object.entries(groups).map(([sup, list]) => (
              <div key={sup} className="mb-4"><h3 className="font-bold border-b mb-1">{sup}</h3>
                <table className="w-full text-sm"><tbody>{list.map((r) => <tr key={r.id}><td className="py-0.5">{r.brand_name} {r.dosage}</td><td className="text-end font-bold">{r.suggested}</td></tr>)}</tbody></table></div>))}
          </div>
        </Modal>
      )}
    </div>
  );
}
