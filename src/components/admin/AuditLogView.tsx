import { useState } from 'react';
import { ScrollText } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { api, qs } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Badge, Empty, PageTitle, Skeleton, useLoad } from '../common/ui';

const MODULES = ['auth', 'pos', 'returns', 'products', 'adjust', 'transfers', 'receive', 'rtv', 'supplier', 'customers', 'shifts', 'accounting', 'users', 'branches', 'doctor', 'admin'];

export default function AuditLogView() {
  const { t } = useI18n();
  const [user, setUser] = useState('');
  const [module, setModule] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const users = useLoad(() => api.get('/users'), []);
  const { data, loading } = useLoad(() => api.get(`/audit?${qs({ user, module, from, to })}`), [user, module, from, to]);
  return (
    <div className="max-w-6xl mx-auto">
      <PageTitle icon={<ScrollText className="text-blue-600" />} title={t('nav_audit')} subtitle={t('audit_sub')}
        right={<>
          <select className="input !w-auto" value={user} onChange={(e) => setUser(e.target.value)}><option value="">{t('all_users')}</option>{(users.data ?? []).map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          <select className="input !w-auto" value={module} onChange={(e) => setModule(e.target.value)}><option value="">{t('all_modules')}</option>{MODULES.map((m) => <option key={m}>{m}</option>)}</select>
          <input type="date" className="input !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} /><input type="date" className="input !w-auto" value={to} onChange={(e) => setTo(e.target.value)} /></>} />
      <div className="card !p-0 overflow-x-auto">
        {loading ? <div className="p-4"><Skeleton rows={8} /></div> : !data?.length ? <Empty text={t('no_logs')} /> : (
          <table className="w-full"><thead><tr><th className="th">{t('timestamp')}</th><th className="th">{t('user_role')}</th><th className="th">{t('module')}</th><th className="th">{t('action_code')}</th><th className="th">{t('operation_details')}</th></tr></thead>
            <tbody>{data.map((l: any) => (<tr key={l.id}><td className="td whitespace-nowrap">{fmtDateTime(l.ts)}</td><td className="td">{l.user_name ?? '—'} <span className="text-xs text-slate-400">{l.role}</span></td><td className="td">{l.module}</td>
              <td className="td"><Badge tone="blue">{l.action_code}</Badge></td><td className="td"><code className="text-[11px] text-slate-600 break-all" dir="ltr">{l.details_json}</code></td></tr>))}</tbody></table>
        )}
      </div>
    </div>
  );
}
