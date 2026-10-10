import { useState } from 'react';
import { Clock, Printer, RefreshCw } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { fmtDateTime, fmtTime, iqd } from '../../lib/format';
import { Empty, PageTitle, Skeleton, StatCard, useLoad } from '../common/ui';
import { ShiftDialog } from '../common/Shell';
import { ThermalReceiptModal } from '../common/ThermalReceiptModal';
import { Banknote, CreditCard, HandCoins, Wallet } from 'lucide-react';

export default function ShiftZReport() {
  const { t } = useI18n();
  const { shift, refresh } = useAuth();
  const shifts = useLoad(() => api.get('/shifts'), [shift?.id]);
  const [selId, setSelId] = useState<number | null>(null);
  const cur = selId ?? shift?.id ?? shifts.data?.[0]?.id ?? null;
  const rep = useLoad(() => (cur ? api.get(`/shifts/${cur}`) : Promise.resolve(null)), [cur]);
  const [dlg, setDlg] = useState(false);
  const [rc, setRc] = useState<number | null>(null);
  const methodKey: Record<string, string> = { cash: 'pay_cash', card: 'pay_card', mixed: 'pay_mixed', qarz: 'pay_qarz' };
  const r = rep.data;

  return (
    <div className="max-w-6xl mx-auto">
      <PageTitle icon={<Clock className="text-orange-500" />} title={t('nav_shifts')} subtitle={t('z_sub')}
        right={<>
          <select className="input !w-auto" value={cur ?? ''} onChange={(e) => setSelId(Number(e.target.value))}>
            {(shifts.data ?? []).map((s: any) => <option key={s.id} value={s.id}>#{s.id} • {s.user_name} • {fmtDateTime(s.opened_at)}{s.closed_at ? '' : ` (${t('open')})`}</option>)}</select>
          <button className="btn-ghost !px-2" onClick={() => { shifts.reload(); rep.reload(); }}><RefreshCw size={16} /></button>
          <button className={shift ? 'btn-danger' : 'btn-primary'} onClick={() => setDlg(true)}>{shift ? t('close_shift') : t('open_shift')}</button>
          <button className="btn-ghost" disabled={!r} onClick={() => window.print()}><Printer size={16} />{t('print_z')}</button></>} />

      {rep.loading || !r ? (rep.loading ? <Skeleton rows={6} /> : <div className="card"><Empty text={t('no_shifts')} /></div>) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4 no-print">
            <StatCard title={t('cash_sales')} value={iqd(r.cash)} icon={<Banknote />} tone="green" />
            <StatCard title={t('electronic_sales')} value={iqd(r.card)} icon={<CreditCard />} tone="blue" />
            <StatCard title={t('qarz_sales')} value={iqd(r.qarz)} icon={<HandCoins />} tone="orange" />
            <StatCard title={t('grand_total')} value={iqd(r.total)} icon={<Wallet />} tone="purple" sub={<span className="text-slate-500">{r.receipts} {t('receipts')}</span>} />
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="card !p-0 overflow-x-auto no-print">
              <div className="p-4 card-title">{t('shift_receipts')}</div>
              {r.invoices.length === 0 ? <Empty text={t('no_sales_yet')} /> : (
                <table className="w-full"><tbody>{r.invoices.map((i: any) => (
                  <tr key={i.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setRc(i.id)}><td className="td font-bold">{i.invoice_number}</td><td className="td">{fmtTime(i.created_at)}</td><td className="td">{t(methodKey[i.payment_method])}</td><td className="td font-bold">{iqd(i.grand_total)}</td></tr>))}</tbody></table>)}
            </div>
            <div className="flex justify-center">
              <div className="receipt print-area border border-slate-200 self-start" dir="auto">
                <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 14 }}>{t('z_report')}</div>
                <div style={{ textAlign: 'center' }}>{r.pharmacy}</div><div style={{ textAlign: 'center' }}>{t('shift')} #{r.id} • {r.user_name}</div>
                <div style={{ textAlign: 'center' }}>{fmtDateTime(r.opened_at)} → {r.closed_at ? fmtDateTime(r.closed_at) : '…'}</div><hr />
                <div className="row"><span>{t('opening_cash')}</span><span>{iqd(r.opening_cash)}</span></div>
                <div className="row"><span>{t('cash_sales')}</span><span>{iqd(r.cash)}</span></div>
                <div className="row"><span>{t('electronic_sales')}</span><span>{iqd(r.card)}</span></div>
                <div className="row"><span>{t('qarz_sales')}</span><span>{iqd(r.qarz)}</span></div>
                <div className="row"><span>{t('qarz_collected')}</span><span>{iqd(r.qarz_collected)}</span></div>
                <div className="row"><span>{t('cash_refunds')}</span><span>-{iqd(r.cash_refunds)}</span></div><hr />
                <div className="row" style={{ fontWeight: 700 }}><span>{t('grand_total')} ({r.receipts})</span><span>{iqd(r.total)}</span></div>
                <div className="row"><span>{t('expected_cash')}</span><span>{iqd(r.expected_cash)}</span></div>
                {r.counted_cash != null && <><div className="row"><span>{t('counted_cash')}</span><span>{iqd(r.counted_cash)}</span></div>
                  <div className="row" style={{ fontWeight: 700 }}><span>{t('difference')}</span><span>{iqd(r.difference)}</span></div></>}
              </div>
            </div>
          </div>
        </>
      )}
      {dlg && <ShiftDialog onClose={() => setDlg(false)} onDone={() => { setDlg(false); refresh(); shifts.reload(); rep.reload(); }} />}
      {rc && <ThermalReceiptModal invoiceId={rc} onClose={() => setRc(null)} />}
    </div>
  );
}
