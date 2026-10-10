import { Activity, AlertTriangle, Box, Calendar, CheckCircle2, ChevronRight, Clock, ShieldCheck, TrendingUp, Users } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { api } from '../lib/api';
import { fmtTime, iqd } from '../lib/format';
import type { Module } from '../types/pharmacy';
import { Badge, Empty, Skeleton, StatCard, useLoad } from './common/ui';
import { useAuth } from '../lib/auth';

export default function Dashboard({ onNavigate }: { onNavigate: (m: Module) => void }) {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const { data: d, loading } = useLoad(() => api.get('/dashboard'), []);
  const locale = lang === 'ku' ? 'ckb-IQ' : lang === 'ar' ? 'ar-IQ' : 'en-US';
  const dateStr = new Date().toLocaleDateString(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const methodKey: Record<string, string> = { cash: 'pay_cash', card: 'pay_card', mixed: 'pay_mixed', qarz: 'pay_qarz' };
  const a = d?.alerts;
  const noIssues = a && !a.low_stock && !a.expired && !a.critical && !a.overdue_customers;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-extrabold flex items-center gap-2">{t('nav_dashboard')} <Badge tone="blue">{t('live_audit')}</Badge></h1>
          <p className="text-sm text-slate-500 mt-1 flex items-center gap-1"><Calendar size={14} />{dateStr}</p>
        </div>
        {user && ['super_admin', 'pharmacist', 'cashier'].includes(user.role) && (
          <button className="btn-ghost" onClick={() => onNavigate('shifts')}><Clock size={16} />{t('nav_shifts')}<ChevronRight size={16} className="rtl:rotate-180" /></button>
        )}
      </div>

      {loading || !d ? <Skeleton rows={6} /> : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <StatCard title={t('total_revenue')} tone="blue" icon={<TrendingUp />} value={iqd(d.revenue)}
              sub={<div className="flex items-center justify-between"><Badge tone="green">+{d.receipts} {t('receipts')}</Badge>
                <span className="font-bold text-emerald-600">{t('net_profit')}: {iqd(d.net_profit)}</span></div>} />
            <StatCard title={t('nav_expiry')} tone="red" icon={<AlertTriangle />} valueClass="text-red-600"
              value={`${d.expired} ${t('medicines')}`} sub={<span className="text-slate-500">{t('more_close_expiry', { n: d.critical })}</span>} />
            <StatCard title={t('nav_customers')} tone="amber" icon={<Users />} value={iqd(d.qarz)}
              sub={<span className="text-orange-600 font-medium">{t('needs_follow_up')}</span>} />
            <StatCard title={t('nav_products')} tone="purple" icon={<Box />} value={`${d.products} ${t('types')}`}
              sub={<span className="text-emerald-600 font-medium">{t('all_shelves_registered')}</span>} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-extrabold flex items-center gap-2"><Activity size={18} className="text-blue-600" />{t('recent_sales')}</h3>
                {(user?.role !== 'cashier') && <button className="text-xs font-bold text-blue-600" onClick={() => onNavigate('shifts')}>{t('view_all')}</button>}
              </div>
              {d.recent.length === 0 ? <Empty text={t('no_sales_yet')} /> : (
                <ul className="divide-y divide-slate-100">
                  {d.recent.map((s: any) => (
                    <li key={s.id} className="py-2 flex items-center justify-between text-sm">
                      <div><div className="font-bold">{s.invoice_number}</div>
                        <div className="text-xs text-slate-500">{fmtTime(s.created_at)} • {s.cashier} • {t(methodKey[s.payment_method])}</div></div>
                      <div className="font-extrabold">{iqd(s.grand_total)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card">
              <h3 className="font-extrabold flex items-center gap-2 mb-3"><ShieldCheck size={18} className="text-blue-600" />{t('action_required')}</h3>
              <div className="space-y-2">
                {a.suppliers_due > 0 && (
                  <Alert tone="blue" text={`${t('alert_month_end')} (${a.suppliers_due} • ${iqd(a.suppliers_due_total)})`} />
                )}
                {a.low_stock > 0 && <Alert tone="amber" text={t('alert_low_stock', { n: a.low_stock })} onClick={() => onNavigate('products')} />}
                {a.expired > 0 && <Alert tone="red" text={t('alert_expired', { n: a.expired })} onClick={() => onNavigate('expiry')} />}
                {a.critical > 0 && <Alert tone="orange" text={t('alert_critical', { n: a.critical })} onClick={() => onNavigate('expiry')} />}
                {a.overdue_customers > 0 && <Alert tone="orange" text={t('alert_overdue', { n: a.overdue_customers })} onClick={() => onNavigate('customers')} />}
                {noIssues && a.suppliers_due === 0 && (
                  <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 font-medium">
                    <CheckCircle2 size={18} />{t('all_normal')}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Alert({ tone, text, onClick }: { tone: 'blue' | 'amber' | 'red' | 'orange'; text: string; onClick?: () => void }) {
  const m = { blue: 'border-blue-200 bg-blue-50 text-blue-800', amber: 'border-amber-200 bg-amber-50 text-amber-800', red: 'border-red-200 bg-red-50 text-red-800', orange: 'border-orange-200 bg-orange-50 text-orange-800' };
  const dot = { blue: 'bg-blue-500', amber: 'bg-amber-500', red: 'bg-red-500', orange: 'bg-orange-500' };
  return (
    <button onClick={onClick} disabled={!onClick} className={`w-full text-start flex items-start gap-2 rounded-xl border p-3 text-sm font-medium ${m[tone]}`}>
      <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${dot[tone]}`} />{text}
    </button>
  );
}
