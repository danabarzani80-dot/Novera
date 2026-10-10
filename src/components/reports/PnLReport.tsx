import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, Coins, Plus, Receipt, TrendingUp, Wallet } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { api, qs } from '../../lib/api';
import { iqd, localDate, parseNum } from '../../lib/format';
import { Badge, Empty, Field, Modal, PageTitle, Skeleton, StatCard, useAction, useLoad } from '../common/ui';

export default function PnLReport() {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [from, setFrom] = useState(localDate(new Date(Date.now() - 29 * 86400_000)));
  const [to, setTo] = useState(localDate());
  const { data: d, loading, reload } = useLoad(() => api.get(`/pnl?${qs({ from, to })}`), [from, to]);
  const exps = useLoad(() => api.get(`/expenses?${qs({ from, to })}`), [from, to]);
  const [adding, setAdding] = useState(false);
  const [e, setE] = useState({ category: 'rent', amount: '', note: '', date: localDate() });

  const save = async () => {
    const r = await run(() => api.post('/expenses', { ...e, amount: parseNum(e.amount) }), t('saved'));
    if (r) { setAdding(false); setE({ ...e, amount: '', note: '' }); reload(); exps.reload(); }
  };
  const rows: [string, number, boolean?][] = d ? [
    [t('pnl_revenue'), d.revenue], [`− ${t('pnl_returns')}`, -d.returns], [t('net_revenue'), d.net_revenue, true], [`− ${t('cogs')}`, -d.cogs],
    [t('gross_profit'), d.gross_profit, true], [`− ${t('shrinkage')}`, -d.shrinkage],
    ...d.expense_breakdown.map((x: any): [string, number] => [`− ${t('exp_' + x.category)}`, -x.a]), [t('net_profit'), d.net_profit, true],
  ] : [];

  return (
    <div className="max-w-6xl mx-auto">
      <PageTitle icon={<BarChart3 className="text-blue-600" />} title={t('pnl_title')} subtitle={t('pnl_sub')}
        right={<><Badge tone="green">{t('active_review')}</Badge><input type="date" className="input !w-auto" value={from} onChange={(x) => setFrom(x.target.value)} />
          <input type="date" className="input !w-auto" value={to} onChange={(x) => setTo(x.target.value)} />
          <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={16} />{t('add_expense')}</button></>} />
      {loading || !d ? <Skeleton rows={6} /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <StatCard title={t('net_revenue')} value={iqd(d.net_revenue)} icon={<TrendingUp />} tone="blue" />
            <StatCard title={t('cogs')} value={iqd(d.cogs)} icon={<Receipt />} tone="orange" />
            <StatCard title={t('gross_profit')} value={iqd(d.gross_profit)} icon={<Coins />} tone="green" />
            <StatCard title={t('net_profit')} value={iqd(d.net_profit)} icon={<Wallet />} tone={d.net_profit >= 0 ? 'purple' : 'red'} valueClass={d.net_profit < 0 ? 'text-red-600' : ''} />
          </div>
          <div className="grid lg:grid-cols-[1fr_380px] gap-4">
            <div className="card">
              <div className="card-title mb-3">{t('revenue_vs_profit')}</div>
              <div style={{ height: 280 }} dir="ltr">
                <ResponsiveContainer><AreaChart data={d.series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} /><YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : v)} />
                  <Tooltip formatter={(v: any) => iqd(Number(v))} /><Legend />
                  <Area type="monotone" dataKey="revenue" name={t('net_revenue')} stroke="#2563eb" fill="#2563eb33" />
                  <Area type="monotone" dataKey="profit" name={t('net_profit')} stroke="#059669" fill="#05966933" /></AreaChart></ResponsiveContainer>
              </div>
            </div>
            <div className="card !p-0">
              <div className="p-4 card-title">{t('pnl_breakdown')}</div>
              <table className="w-full"><tbody>{rows.map(([k, v, strong], i) => (
                <tr key={i} className={strong ? 'bg-slate-50' : ''}><td className={`td ${strong ? 'font-extrabold' : ''}`}>{k}</td><td className={`td text-end ${strong ? 'font-extrabold' : ''} ${v < 0 ? 'text-red-600' : ''}`}>{iqd(v)}</td></tr>))}</tbody></table>
            </div>
          </div>
          <div className="card !p-0 mt-4 overflow-x-auto">
            <div className="p-4 card-title">{t('expenses')}</div>
            {(exps.data ?? []).length === 0 ? <Empty text={t('no_expenses')} /> : (
              <table className="w-full"><tbody>{exps.data.map((x: any) => <tr key={x.id}><td className="td">{x.date}</td><td className="td">{t('exp_' + x.category)}</td><td className="td">{x.note}</td><td className="td font-bold text-end">{iqd(x.amount)}</td></tr>)}</tbody></table>)}
          </div>
        </>
      )}
      {adding && <Modal title={t('add_expense')} onClose={() => setAdding(false)} footer={<><button className="btn-ghost" onClick={() => setAdding(false)}>{t('cancel')}</button>
        <button className="btn-primary" disabled={busy || parseNum(e.amount) <= 0} onClick={save}>{t('save')}</button></>}>
        <div className="space-y-3"><Field label={t('category')}><select className="input" value={e.category} onChange={(x) => setE({ ...e, category: x.target.value })}>{['rent', 'salaries', 'utilities', 'other'].map((c) => <option key={c} value={c}>{t('exp_' + c)}</option>)}</select></Field>
          <Field label={t('amount')}><input className="input" inputMode="numeric" value={e.amount} onChange={(x) => setE({ ...e, amount: x.target.value })} /></Field>
          <Field label={t('date')}><input type="date" className="input" value={e.date} onChange={(x) => setE({ ...e, date: x.target.value })} /></Field>
          <Field label={t('note')}><input className="input" value={e.note} onChange={(x) => setE({ ...e, note: x.target.value })} /></Field></div></Modal>}
    </div>
  );
}
