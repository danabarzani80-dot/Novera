import { useEffect, useState } from 'react';
import { HelpCircle, LogOut, Send, Stethoscope, Trash2 } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { useAuth } from '../../lib/auth';
import { api, qs } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import type { Product } from '../../types/pharmacy';
import { Badge, Empty, Field, Modal, PageTitle, Skeleton, Tabs, useAction, useDebounced, useLoad } from '../common/ui';

export default function DoctorPortal() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const list = useLoad(() => api.get('/prescriptions'), []);

  if (user?.role !== 'doctor') {
    // Pharmacy side: incoming e-prescriptions (they are loaded into the POS cart from the POS screen).
    return (
      <div className="max-w-5xl mx-auto">
        <PageTitle icon={<Stethoscope className="text-amber-500" />} title={t('incoming_requests')} subtitle={t('incoming_requests_sub')} />
        <RequestList loading={list.loading} rows={list.data ?? []} showDoctor />
      </div>
    );
  }

  return <DoctorForm list={list} onLogout={logout} />;
}

function RequestList({ rows, loading, showDoctor }: { rows: any[]; loading: boolean; showDoctor?: boolean }) {
  const { t } = useI18n();
  const dest: Record<string, string> = { pharmacy: 'dest_pharmacy', lab: 'dest_lab', both: 'dest_both' };
  if (loading) return <Skeleton rows={4} />;
  if (!rows.length) return <div className="card"><Empty text={t('no_requests')} /></div>;
  return (
    <div className="card !p-0 overflow-x-auto"><table className="w-full"><thead><tr><th className="th">{t('date')}</th><th className="th">{t('patient')}</th>{showDoctor && <th className="th">{t('doctor')}</th>}<th className="th">{t('destination')}</th><th className="th">{t('medicines')}</th><th className="th">{t('status')}</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}><td className="td">{fmtDateTime(r.created_at)}</td><td className="td font-bold">{r.patient_name}</td>{showDoctor && <td className="td">{r.doctor_name}</td>}
        <td className="td">{t(dest[r.destination])}</td><td className="td">{r.item_count}</td><td className="td"><Badge tone={r.status === 'dispensed' ? 'green' : 'amber'}>{t(r.status === 'dispensed' ? 'status_dispensed' : 'status_sent')}</Badge></td></tr>)}</tbody></table></div>
  );
}

function DoctorForm({ list, onLogout }: { list: ReturnType<typeof useLoad<any>>; onLogout: () => void }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const { run, busy } = useAction();
  const [dest, setDest] = useState<'pharmacy' | 'lab' | 'both'>('pharmacy');
  const [f, setF] = useState({ patient_name: '', patient_phone: '', patient_age: '' });
  const [items, setItems] = useState<{ p: Product; quantity: number; dose: string; instructions: string }[]>([]);
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [found, setFound] = useState<Product[]>([]);
  const [help, setHelp] = useState(false);
  useEffect(() => { if (dq) api.get(`/products?${qs({ q: dq, size: 8 })}`).then((r) => setFound(r.rows)).catch(() => {}); else setFound([]); }, [dq]);

  const send = async () => {
    const r = await run(() => api.post('/prescriptions', { destination: dest, ...f, patient_age: f.patient_age || null,
      items: dest === 'lab' ? [] : items.map((i) => ({ product_id: i.p.id, quantity: i.quantity, dose: i.dose, instructions: i.instructions })) }), t('request_sent'));
    if (r) { setF({ patient_name: '', patient_phone: '', patient_age: '' }); setItems([]); list.reload(); }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <PageTitle icon={<Stethoscope className="text-amber-500" />} title={`${t('role_doctor')}: ${user?.name}`} subtitle={user?.specialty ?? ''}
        right={<><button className="btn-ghost" onClick={() => setHelp(true)}><HelpCircle size={16} />{t('how_to_use')}</button><button className="btn-ghost" onClick={onLogout}><LogOut size={16} className="rtl:rotate-180" />{t('logout')}</button></>} />
      <div className="card mb-4 space-y-4">
        <h3 className="font-extrabold">{t('send_new_request')}</h3>
        <Tabs value={dest} onChange={setDest} items={[{ id: 'pharmacy', label: t('dest_pharmacy_only') }, { id: 'lab', label: t('dest_lab_only') }, { id: 'both', label: t('dest_both') }]} />
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label={`${t('patient_name')} *`} className="sm:col-span-2"><input className="input" value={f.patient_name} onChange={(e) => setF({ ...f, patient_name: e.target.value })} /></Field>
          <Field label={t('age')}><input className="input" type="number" min={0} value={f.patient_age} onChange={(e) => setF({ ...f, patient_age: e.target.value })} /></Field>
          <Field label={`${t('phone')} (${t('optional')})`}><input className="input" value={f.patient_phone} onChange={(e) => setF({ ...f, patient_phone: e.target.value })} /></Field>
        </div>
        {dest !== 'lab' && (
          <div>
            <div className="card-title mb-1">{t('eprescription')}</div>
            <div className="relative"><input className="input" placeholder={t('search_medicine_add')} value={q} onChange={(e) => setQ(e.target.value)} />
              {found.length > 0 && <ul className="absolute z-20 inset-x-0 mt-1 bg-white border rounded-xl shadow-lg max-h-56 overflow-y-auto">{found.map((p) => (
                <li key={p.id}><button className="w-full text-start px-3 py-2 hover:bg-slate-50 text-sm" onClick={() => { if (!items.find((i) => i.p.id === p.id)) setItems([...items, { p, quantity: 1, dose: '', instructions: '' }]); setQ(''); setFound([]); }}>
                  <b>{p.brand_name}</b> {p.dosage} <span className="text-xs text-slate-400">{p.generic_name}</span></button></li>))}</ul>}</div>
            {items.map((i, idx) => (
              <div key={i.p.id} className="grid grid-cols-[1fr_70px_1fr_1fr_auto] gap-2 items-center mt-2 max-sm:grid-cols-2">
                <b className="text-sm">{i.p.brand_name} {i.p.dosage}</b>
                <input type="number" min={1} className="input !py-1" title={t('qty')} value={i.quantity} onChange={(e) => setItems(items.map((x, k) => (k === idx ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x)))} />
                <input className="input !py-1" placeholder={t('dose')} value={i.dose} onChange={(e) => setItems(items.map((x, k) => (k === idx ? { ...x, dose: e.target.value } : x)))} />
                <input className="input !py-1" placeholder={t('instructions')} value={i.instructions} onChange={(e) => setItems(items.map((x, k) => (k === idx ? { ...x, instructions: e.target.value } : x)))} />
                <button className="text-slate-400 hover:text-red-600" onClick={() => setItems(items.filter((_, k) => k !== idx))}><Trash2 size={16} /></button>
              </div>))}
          </div>
        )}
        <button className="btn-primary" disabled={busy || !f.patient_name.trim() || (dest !== 'lab' && items.length === 0)} onClick={send}><Send size={16} />{t('send_online')}</button>
      </div>
      <div className="flex items-center gap-2 mb-2"><h3 className="font-extrabold">{t('sent_requests')}</h3><Badge tone="blue">{list.data?.length ?? 0}</Badge></div>
      <RequestList loading={list.loading} rows={list.data ?? []} />
      {help && <Modal title={t('how_to_use')} onClose={() => setHelp(false)}><ol className="list-decimal ps-5 space-y-2 text-sm text-slate-700"><li>{t('help_1')}</li><li>{t('help_2')}</li><li>{t('help_3')}</li><li>{t('help_4')}</li></ol></Modal>}
    </div>
  );
}
