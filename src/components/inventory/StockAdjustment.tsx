import { useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { api, qs } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Empty, Field, PageTitle, Skeleton, useAction, useDebounced, useLoad } from '../common/ui';

const REASONS = ['damaged', 'lost', 'expired_disposal', 'count_correction'];

export default function StockAdjustment() {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [batches, setBatches] = useState<any[]>([]);
  const [sel, setSel] = useState<any>(null);
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('count_correction');
  const hist = useLoad(() => api.get('/adjustments'), []);
  useEffect(() => { if (dq.length > 0) api.get(`/batches?${qs({ q: dq })}`).then(setBatches).catch(() => {}); else setBatches([]); }, [dq]);
  const diff = sel && counted !== '' ? Number(counted) - sel.quantity : 0;

  const save = async () => {
    const r = await run(() => api.post('/adjustments', { batch_id: sel.id, counted_qty: Number(counted), reason }), t('saved'));
    if (r) { setSel(null); setCounted(''); setQ(''); hist.reload(); }
  };
  return (
    <div className="max-w-5xl mx-auto">
      <PageTitle icon={<ClipboardList className="text-blue-600" />} title={t('adjust_title')} subtitle={t('adjust_sub')} />
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card">
          <Field label={t('search_medicine')}><input className="input" value={q} onChange={(e) => { setQ(e.target.value); setSel(null); }} /></Field>
          {!sel && batches.length > 0 && (
            <ul className="mt-2 divide-y divide-slate-100 max-h-64 overflow-y-auto">
              {batches.map((b) => (
                <li key={b.id}><button className="w-full text-start py-2 hover:bg-slate-50 px-2 rounded" onClick={() => setSel(b)}>
                  <div className="text-sm font-bold">{b.brand_name} {b.dosage}</div><div className="text-xs text-slate-500">{t('batch')} {b.batch_number} • {b.expiry_date} • {b.quantity}</div></button></li>
              ))}
            </ul>
          )}
          {sel && (
            <div className="mt-4 space-y-3">
              <div className="rounded-xl bg-slate-50 border p-3 text-sm"><b>{sel.brand_name} {sel.dosage}</b><div className="text-xs text-slate-500">{t('batch')} {sel.batch_number} • {sel.expiry_date}</div>
                <div className="mt-1">{t('system_qty')}: <b>{sel.quantity}</b></div></div>
              <Field label={t('counted_qty')}><input className="input" type="number" min={0} value={counted} onChange={(e) => setCounted(e.target.value)} /></Field>
              {counted !== '' && <div className={`text-sm font-bold ${diff === 0 ? 'text-slate-500' : diff < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{t('difference')}: {diff > 0 ? '+' : ''}{diff}</div>}
              <Field label={t('reason')}><select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r} value={r}>{t('reason_' + r)}</option>)}</select></Field>
              <button className="btn-primary" disabled={busy || counted === ''} onClick={save}>{t('save')}</button>
            </div>
          )}
        </div>
        <div className="card !p-0 overflow-x-auto">
          <div className="p-4 card-title">{t('adjust_history')}</div>
          {hist.loading ? <div className="p-4"><Skeleton /></div> : !(hist.data?.length) ? <Empty text={t('no_adjustments')} /> : (
            <table className="w-full"><thead><tr><th className="th">{t('date')}</th><th className="th">{t('medicine')}</th><th className="th">{t('system_qty')}</th><th className="th">{t('counted_qty')}</th><th className="th">{t('reason')}</th></tr></thead>
              <tbody>{hist.data.map((a: any) => <tr key={a.id}><td className="td">{fmtDateTime(a.created_at)}</td><td className="td font-bold">{a.brand_name}</td><td className="td">{a.system_qty}</td><td className="td">{a.counted_qty}</td><td className="td">{t('reason_' + a.reason)}</td></tr>)}</tbody></table>
          )}
        </div>
      </div>
    </div>
  );
}
