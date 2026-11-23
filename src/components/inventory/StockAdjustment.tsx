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
  const [loose, setLoose] = useState('');
  const [reason, setReason] = useState('count_correction');
  const hist = useLoad(() => api.get('/adjustments'), []);
  useEffect(() => { if (dq.length > 0) api.get(`/batches?${qs({ q: dq, all: 1 })}`).then(setBatches).catch(() => {}); else setBatches([]); }, [dq]);
  // Opened packs: loose stock is kept in the smallest unit (tablets, or sheets when a sheet is not split).
  const tps = Math.max(1, Number(sel?.tablets_per_sheet) || 1);
  const packSize = Math.max(1, Number(sel?.sheets_per_pack) || 1) * tps;
  const looseUnit = tps > 1 ? t('unit_tablets') : t('unit_sheets');
  const stockText = (b: any) => `${b.quantity} ${t('unit_packs')}${b.loose_units > 0 ? ` + ${b.loose_units} ${Number(b.tablets_per_sheet) > 1 ? t('unit_tablets') : t('unit_sheets')}` : ''}`;
  const looseNum = loose === '' ? 0 : Number(loose);
  const looseBad = packSize > 1 && (looseNum < 0 || looseNum >= packSize);
  // Difference in the smallest unit, shown as packs + loose so a counted sheet is visible.
  const diffUnits = sel && counted !== '' ? (Number(counted) * packSize + (packSize > 1 ? looseNum : 0)) - (sel.quantity * packSize + (packSize > 1 ? (sel.loose_units ?? 0) : 0)) : 0;
  const diffText = () => {
    if (packSize === 1) return `${diffUnits > 0 ? '+' : ''}${diffUnits}`;
    const sign = diffUnits > 0 ? '+' : diffUnits < 0 ? '-' : '';
    const a = Math.abs(diffUnits);
    return `${sign}${Math.floor(a / packSize)} ${t('unit_packs')} + ${a % packSize} ${looseUnit}`;
  };
  const pick = (b: any) => { setSel(b); setCounted(''); setLoose(''); };

  const save = async () => {
    const body: any = { batch_id: sel.id, counted_qty: Number(counted), reason };
    if (packSize > 1) body.counted_loose = looseNum;
    const r = await run(() => api.post('/adjustments', body), t('saved'));
    if (r) { setSel(null); setCounted(''); setLoose(''); setQ(''); hist.reload(); }
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
                <li key={b.id}><button className="w-full text-start py-2 hover:bg-slate-50 px-2 rounded" onClick={() => pick(b)}>
                  <div className="text-sm font-bold">{b.brand_name} {b.dosage}</div><div className="text-xs text-slate-500">{t('batch')} {b.batch_number} • {b.expiry_date} • {stockText(b)}
                    {b.quantity === 0 && !(b.loose_units > 0) && <span className="ms-2 rounded bg-amber-100 text-amber-700 px-1.5 font-bold">{t('out_of_stock_tag')}</span>}</div></button></li>
              ))}
            </ul>
          )}
          {sel && (
            <div className="mt-4 space-y-3">
              <div className="rounded-xl bg-slate-50 border p-3 text-sm"><b>{sel.brand_name} {sel.dosage}</b><div className="text-xs text-slate-500">{t('batch')} {sel.batch_number} • {sel.expiry_date}</div>
                <div className="mt-1">{t('system_qty')}: <b>{stockText(sel)}</b></div></div>
              <Field label={packSize > 1 ? t('counted_packs') : t('counted_qty')}><input className="input" type="number" min={0} step={1} value={counted} onChange={(e) => setCounted(e.target.value)} /></Field>
              {packSize > 1 && (
                <Field label={tps > 1 ? t('counted_loose_tablets') : t('counted_loose_sheets')}>
                  <input className="input" type="number" min={0} max={packSize - 1} step={1} placeholder="0" value={loose} onChange={(e) => setLoose(e.target.value)} />
                  <div className={`text-xs mt-1 ${looseBad ? 'text-red-600 font-bold' : 'text-slate-500'}`}>{t('loose_max_hint')} {packSize} {looseUnit}</div>
                </Field>
              )}
              {counted !== '' && <div className={`text-sm font-bold ${diffUnits === 0 ? 'text-slate-500' : diffUnits < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{t('difference')}: {diffText()}</div>}
              <Field label={t('reason')}><select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r} value={r}>{t('reason_' + r)}</option>)}</select></Field>
              <button className="btn-primary" disabled={busy || counted === '' || looseBad} onClick={save}>{t('save')}</button>
            </div>
          )}
        </div>
        <div className="card !p-0 overflow-x-auto">
          <div className="p-4 card-title">{t('adjust_history')}</div>
          {hist.loading ? <div className="p-4"><Skeleton /></div> : !(hist.data?.length) ? <Empty text={t('no_adjustments')} /> : (
            <table className="w-full"><thead><tr><th className="th">{t('date')}</th><th className="th">{t('medicine')}</th><th className="th">{t('system_qty')}</th><th className="th">{t('counted_qty')}</th><th className="th">{t('reason')}</th></tr></thead>
              <tbody>{hist.data.map((a: any) => <tr key={a.id}><td className="td">{fmtDateTime(a.created_at)}</td><td className="td font-bold">{a.brand_name}</td><td className="td">{a.system_qty}{a.system_loose > 0 ? ` + ${a.system_loose}` : ''}</td><td className="td">{a.counted_qty}{a.counted_loose > 0 ? ` + ${a.counted_loose}` : ''}</td><td className="td">{t('reason_' + a.reason)}</td></tr>)}</tbody></table>
          )}
        </div>
      </div>
    </div>
  );
}
