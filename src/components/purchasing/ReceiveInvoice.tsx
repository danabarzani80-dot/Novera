import { useEffect, useState } from 'react';
import { FileText, PackageSearch, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { api, qs } from '../../lib/api';
import { fmtDateTime, iqd } from '../../lib/format';
import { Empty, Field, Modal, PageTitle, Tabs, useAction, useDebounced, useLoad } from '../common/ui';

interface Line { product_id: number; name: string; batch_number: string; expiry_date: string; quantity: number; cost_price: number; margin_pct: number; selling_price: number }

export default function ReceiveInvoice() {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const suppliers = useLoad(() => api.get('/suppliers'), []);
  const drafts = useLoad(() => api.get('/purchases?status=draft'), []);
  const [id, setId] = useState<number | undefined>();
  const [supplier, setSupplier] = useState<number | ''>('');
  const [number, setNumber] = useState('');
  const [ptype, setPtype] = useState<'credit' | 'cash'>('credit');
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [found, setFound] = useState<any[]>([]);
  const [showDrafts, setShowDrafts] = useState(false);
  const [newSup, setNewSup] = useState(false);
  useEffect(() => { if (dq) api.get(`/products?${qs({ q: dq, size: 8 })}`).then((r) => setFound(r.rows)).catch(() => {}); else setFound([]); }, [dq]);

  const total = lines.reduce((s, l) => s + l.quantity * l.cost_price, 0);
  const upd = (i: number, p: Partial<Line>) => setLines(lines.map((l, k) => {
    if (k !== i) return l;
    const n = { ...l, ...p };
    if ('cost_price' in p || 'margin_pct' in p) n.selling_price = Math.round(n.cost_price * (1 + n.margin_pct / 100));
    if ('selling_price' in p && n.cost_price > 0) n.margin_pct = Math.round(((n.selling_price / n.cost_price) - 1) * 1000) / 10;
    return n;
  }));
  const reset = () => { setId(undefined); setSupplier(''); setNumber(''); setLines([]); setPtype('credit'); };

  const save = async (approve: boolean) => {
    const body = { id, supplier_id: supplier, invoice_number: number, payment_type: ptype, approve,
      items: lines.map(({ name: _n, ...l }) => l) };
    const r = await run(() => api.post('/purchases', body), t(approve ? 'invoice_approved' : 'draft_saved'));
    if (r) { reset(); drafts.reload(); suppliers.reload(); }
  };
  const loadDraft = async (d: any) => {
    const p = await api.get(`/purchases/${d.id}`);
    setId(p.id); setSupplier(p.supplier_id); setNumber(p.invoice_number ?? ''); setPtype(p.payment_type);
    setLines(p.items.map((i: any) => ({ product_id: i.product_id, name: `${i.brand_name} ${i.dosage ?? ''}`, batch_number: i.batch_number ?? '', expiry_date: i.expiry_date ?? '',
      quantity: i.quantity, cost_price: i.cost_price, margin_pct: i.margin_pct, selling_price: i.selling_price })));
    setShowDrafts(false);
  };
  const ready = supplier !== '' && lines.length > 0;

  return (
    <div className="max-w-7xl mx-auto">
      <PageTitle icon={<PackageSearch className="text-blue-600" />} title={t('receive_title')} subtitle={t('receive_sub')}
        right={<><button className="btn-ghost" onClick={() => setShowDrafts(true)}><FileText size={16} />{t('drafts')} ({drafts.data?.length ?? 0})</button>
          <button className="btn-ghost" disabled={busy || !ready} onClick={() => save(false)}>{t('save_draft')}</button>
          <button className="btn-primary" disabled={busy || !ready} onClick={() => save(true)}>{t('approve_save')}</button></>} />

      <div className="card mb-4 grid sm:grid-cols-3 gap-3 items-end">
        <Field label={`${t('supplier')} *`}>
          <div className="flex gap-2"><select className="input" value={supplier} onChange={(e) => setSupplier(e.target.value ? Number(e.target.value) : '')}>
            <option value="">—</option>{(suppliers.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <button className="btn-ghost !px-2" onClick={() => setNewSup(true)}><Plus size={16} /></button></div></Field>
        <Field label={t('invoice_number')}><input className="input" value={number} onChange={(e) => setNumber(e.target.value)} /></Field>
        <Field label={t('payment_type')}><Tabs value={ptype} onChange={setPtype} items={[{ id: 'credit', label: t('credit_qarz') }, { id: 'cash', label: t('cash_naqd') }]} /></Field>
      </div>

      <div className="card !p-0">
        <div className="p-3 relative">
          <input className="input" placeholder={t('search_medicine_add')} value={q} onChange={(e) => setQ(e.target.value)} />
          {found.length > 0 && (
            <ul className="absolute z-20 start-3 end-3 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
              {found.map((p) => <li key={p.id}><button className="w-full text-start px-3 py-2 hover:bg-slate-50 text-sm" onClick={() => {
                setLines([...lines, { product_id: p.id, name: `${p.brand_name} ${p.dosage ?? ''}`, batch_number: '', expiry_date: '', quantity: 1, cost_price: p.cost ?? 0, margin_pct: 20, selling_price: Math.round((p.cost ?? 0) * 1.2) }]);
                setQ(''); setFound([]);
              }}><b>{p.brand_name}</b> {p.dosage} <span className="text-xs text-slate-400">{p.manufacturer}</span></button></li>)}
            </ul>
          )}
        </div>
        <div className="overflow-x-auto">
          {lines.length === 0 ? <Empty text={t('no_lines')} /> : (
            <table className="w-full min-w-[900px]"><thead><tr><th className="th">#</th><th className="th">{t('medicine')}</th><th className="th">{t('batch')}</th><th className="th">{t('expiry')}</th><th className="th">{t('packs_qty')}</th>
              <th className="th">{t('cost_price')}</th><th className="th">{t('margin_pct')}</th><th className="th">{t('selling_price')}</th><th className="th">{t('line_total')}</th><th className="th" /></tr></thead>
              <tbody>{lines.map((l, i) => (
                <tr key={i}><td className="td">{i + 1}</td><td className="td font-bold">{l.name}</td>
                  <td className="td"><input className="input !py-1 w-28" value={l.batch_number} onChange={(e) => upd(i, { batch_number: e.target.value })} /></td>
                  <td className="td"><input type="date" className="input !py-1 w-36" value={l.expiry_date} onChange={(e) => upd(i, { expiry_date: e.target.value })} /></td>
                  <td className="td"><input type="number" min={1} className="input !py-1 w-20" value={l.quantity} onChange={(e) => upd(i, { quantity: Math.max(1, Number(e.target.value) || 1) })} /></td>
                  <td className="td"><input type="number" min={0} className="input !py-1 w-28" value={l.cost_price} onChange={(e) => upd(i, { cost_price: Math.max(0, Number(e.target.value) || 0) })} /></td>
                  <td className="td"><input type="number" className="input !py-1 w-20" value={l.margin_pct} onChange={(e) => upd(i, { margin_pct: Number(e.target.value) || 0 })} /></td>
                  <td className="td"><input type="number" min={0} className="input !py-1 w-28" value={l.selling_price} onChange={(e) => upd(i, { selling_price: Math.max(0, Number(e.target.value) || 0) })} /></td>
                  <td className="td font-bold">{iqd(l.quantity * l.cost_price)}</td>
                  <td className="td"><button className="text-slate-400 hover:text-red-600" onClick={() => setLines(lines.filter((_, k) => k !== i))}><Trash2 size={16} /></button></td></tr>))}</tbody></table>
          )}
        </div>
        <div className="p-4 border-t border-slate-100 flex justify-between items-center">
          <span className="text-sm text-slate-500">{t('items')}: <b>{lines.length}</b></span>
          <span className="text-xl font-extrabold text-blue-600">{t('total_cost')}: {iqd(total)}</span>
        </div>
      </div>

      {showDrafts && (
        <Modal title={t('drafts')} onClose={() => setShowDrafts(false)}>
          {(drafts.data ?? []).length === 0 ? <Empty text={t('no_drafts')} /> : (
            <ul className="divide-y divide-slate-100">{drafts.data.map((d: any) => (
              <li key={d.id} className="py-2 flex items-center justify-between"><div><b className="text-sm">{d.supplier_name}</b> <span className="text-xs text-slate-500">{d.invoice_number} • {fmtDateTime(d.created_at)} • {iqd(d.total_cost)}</span></div>
                <div className="flex gap-1"><button className="btn-primary !py-1" onClick={() => loadDraft(d)}>{t('open')}</button>
                  <button className="btn-ghost !py-1" onClick={async () => { await run(() => api.del(`/purchases/${d.id}`)); drafts.reload(); }}><Trash2 size={14} /></button></div></li>))}</ul>
          )}
        </Modal>
      )}
      {newSup && <SupplierModal onClose={() => setNewSup(false)} onSaved={(sid) => { setNewSup(false); suppliers.reload(); setSupplier(sid); }} />}
    </div>
  );
}

export function SupplierModal({ onClose, onSaved }: { onClose: () => void; onSaved: (id: number) => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  return (
    <Modal title={t('add_supplier')} onClose={onClose} footer={<><button className="btn-ghost" onClick={onClose}>{t('cancel')}</button>
      <button className="btn-primary" disabled={busy || !name.trim()} onClick={async () => { const r = await run(() => api.post('/suppliers', { name, phone }), t('saved')); if (r) onSaved(r.id); }}>{t('save')}</button></>}>
      <div className="space-y-3"><Field label={t('name')}><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t('phone')}><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field></div>
    </Modal>
  );
}
