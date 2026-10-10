import { useEffect, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { api, qs } from '../../lib/api';
import { iqd } from '../../lib/format';
import { Empty, Field, PageTitle, useAction, useDebounced, useLoad } from '../common/ui';

export default function ReturnToVendor() {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const suppliers = useLoad(() => api.get('/suppliers'), []);
  const [supplier, setSupplier] = useState<number | ''>('');
  const [reason, setReason] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [found, setFound] = useState<any[]>([]);
  const [rows, setRows] = useState<{ b: any; qty: number }[]>([]);
  useEffect(() => { if (dq) api.get(`/batches?${qs({ q: dq })}`).then(setFound).catch(() => {}); else setFound([]); }, [dq]);
  const total = rows.reduce((s, r) => s + r.qty * r.b.purchase_price, 0);

  const submit = async () => {
    const r = await run(() => api.post('/rtv', { supplier_id: supplier, reason, items: rows.map((x) => ({ batch_id: x.b.id, quantity: x.qty })) }), t('rtv_approved'));
    if (r) { setRows([]); setReason(''); suppliers.reload(); }
  };
  return (
    <div className="max-w-5xl mx-auto">
      <PageTitle icon={<RotateCcw className="text-blue-600" />} title={t('rtv_title')} subtitle={t('rtv_sub')}
        right={<button className="btn-primary" disabled={busy || supplier === '' || !rows.length} onClick={submit}>{t('approve_rtv')}</button>} />
      <div className="card mb-4 grid sm:grid-cols-2 gap-3">
        <Field label={`${t('supplier')} *`}><select className="input" value={supplier} onChange={(e) => setSupplier(e.target.value ? Number(e.target.value) : '')}>
          <option value="">—</option>{(suppliers.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label={t('return_reason')}><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
      <div className="card !p-0">
        <div className="p-3 relative">
          <input className="input" placeholder={t('search_batch')} value={q} onChange={(e) => setQ(e.target.value)} />
          {found.length > 0 && <ul className="absolute z-20 start-3 end-3 mt-1 bg-white border rounded-xl shadow-lg max-h-64 overflow-y-auto">
            {found.map((b) => <li key={b.id}><button className="w-full text-start px-3 py-2 hover:bg-slate-50 text-sm" onClick={() => { if (!rows.find((r) => r.b.id === b.id)) setRows([...rows, { b, qty: 1 }]); setQ(''); setFound([]); }}>
              <b>{b.brand_name}</b> {b.dosage} <span className="text-xs text-slate-500">{t('batch')} {b.batch_number} • {b.expiry_date} • {b.quantity}</span></button></li>)}</ul>}
        </div>
        {rows.length === 0 ? <Empty text={t('no_lines')} /> : (
          <table className="w-full"><thead><tr><th className="th">{t('medicine')}</th><th className="th">{t('batch')}</th><th className="th">{t('return_qty')}</th><th className="th">{t('unit_cost')}</th><th className="th">{t('total')}</th><th className="th" /></tr></thead>
            <tbody>{rows.map((r, i) => (<tr key={r.b.id}><td className="td font-bold">{r.b.brand_name} {r.b.dosage}</td><td className="td">{r.b.batch_number}</td>
              <td className="td"><input type="number" min={1} max={r.b.quantity} className="input !py-1 w-24" value={r.qty} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, qty: Math.max(1, Math.min(r.b.quantity, Number(e.target.value) || 1)) } : x)))} /></td>
              <td className="td">{iqd(r.b.purchase_price)}</td><td className="td font-bold">{iqd(r.qty * r.b.purchase_price)}</td>
              <td className="td"><button className="text-slate-400 hover:text-red-600" onClick={() => setRows(rows.filter((_, k) => k !== i))}><Trash2 size={16} /></button></td></tr>))}</tbody></table>
        )}
        <div className="p-4 border-t text-end text-xl font-extrabold text-blue-600">{t('total')}: {iqd(total)}</div>
      </div>
    </div>
  );
}
