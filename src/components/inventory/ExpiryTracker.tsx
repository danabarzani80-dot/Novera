import { useState } from 'react';
import { AlertTriangle, Lock } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { api } from '../../lib/api';
import { iqd } from '../../lib/format';
import { Badge, Empty, PageTitle, Skeleton, useLoad } from '../common/ui';

type St = 'expired' | 'critical' | 'warning' | 'good';
const TONE: Record<St, 'red' | 'orange' | 'amber' | 'green'> = { expired: 'red', critical: 'orange', warning: 'amber', good: 'green' };

export default function ExpiryTracker() {
  const { t } = useI18n();
  const { data, loading } = useLoad(() => api.get('/expiry'), []);
  const [f, setF] = useState<St | 'all'>('all');
  const cards: [St, string, string, string][] = [
    ['expired', 'st_expired', 'sub_expired', 'border-red-200 bg-red-50 text-red-700'],
    ['critical', 'st_critical', 'sub_critical', 'border-orange-200 bg-orange-50 text-orange-700'],
    ['warning', 'st_warning', 'sub_warning', 'border-amber-200 bg-amber-50 text-amber-700'],
    ['good', 'st_good', 'sub_good', 'border-emerald-200 bg-emerald-50 text-emerald-700'],
  ];
  const items = (data?.items ?? []).filter((i: any) => f === 'all' || i.status === f);
  return (
    <div className="max-w-6xl mx-auto">
      <PageTitle icon={<AlertTriangle className="text-amber-500" />} title={t('nav_expiry')} subtitle={t('expiry_sub')} />
      <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 text-red-700 p-3 text-sm font-bold mb-4"><Lock size={18} />{t('safety_lock')}</div>
      {loading || !data ? <Skeleton rows={6} /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {cards.map(([k, label, sub, cls]) => (
              <button key={k} onClick={() => setF(f === k ? 'all' : k)} className={`rounded-2xl border p-4 text-start ${cls} ${f === k ? 'ring-2 ring-offset-1 ring-slate-400' : ''}`}>
                <div className="text-[11px] font-bold uppercase tracking-wide">{t(label)}</div>
                <div className="text-3xl font-extrabold">{data.counts[k]}</div>
                <div className="text-xs font-medium">{t(sub)}</div>
              </button>
            ))}
          </div>
          <div className="card !p-0 overflow-x-auto">
            {items.length === 0 ? <Empty text={t('no_batches')} /> : (
              <table className="w-full"><thead><tr><th className="th">{t('medicine')}</th><th className="th">{t('batch')}</th><th className="th">{t('expiry')}</th><th className="th">{t('days_left')}</th><th className="th">{t('qty')}</th><th className="th">{t('value_at_cost')}</th></tr></thead>
                <tbody>{items.map((b: any) => (
                  <tr key={b.id}><td className="td font-bold">{b.brand_name} {b.dosage}</td><td className="td">{b.batch_number}</td><td className="td">{b.expiry_date}</td>
                    <td className="td"><Badge tone={TONE[b.status as St]}>{b.days_left < 0 ? t('expired_ago', { n: -b.days_left }) : t('days_n', { n: b.days_left })}</Badge></td>
                    <td className="td">{b.quantity}</td><td className="td">{iqd(b.value)}</td></tr>))}</tbody></table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
