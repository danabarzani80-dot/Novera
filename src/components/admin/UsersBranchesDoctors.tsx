import { useRef, useState } from 'react';
import { Building2, Download, KeyRound, Pencil, Plus, Power, Upload, UserCog } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { useAuth } from '../../lib/auth';
import { api, ApiError } from '../../lib/api';
import { Badge, Confirm, Field, Modal, PageTitle, Skeleton, useAction, useLoad, useToast } from '../common/ui';

const ROLES = ['super_admin', 'pharmacist', 'cashier', 'warehouse_manager', 'doctor'];

export default function UsersBranchesDoctors({ mode }: { mode: 'users' | 'branches' }) {
  return mode === 'branches' ? <Branches /> : <Users />;
}

function Branches() {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const { data, loading, reload } = useLoad(() => api.get('/branches'), []);
  const [f, setF] = useState<any>(null);
  const save = async () => { const r = await run(() => (f.id ? api.put(`/branches/${f.id}`, f) : api.post('/branches', f)), t('saved')); if (r) { setF(null); reload(); } };
  return (
    <div className="max-w-4xl mx-auto">
      <PageTitle icon={<Building2 className="text-blue-600" />} title={t('nav_branches')} right={<button className="btn-primary" onClick={() => setF({ name: '', address: '', phone: '' })}><Plus size={16} />{t('add_branch')}</button>} />
      {loading ? <Skeleton /> : <div className="card !p-0 overflow-x-auto"><table className="w-full"><thead><tr><th className="th">{t('name')}</th><th className="th">{t('address')}</th><th className="th">{t('phone')}</th><th className="th" /></tr></thead>
        <tbody>{data.map((b: any) => <tr key={b.id}><td className="td font-bold">{b.name}</td><td className="td">{b.address}</td><td className="td">{b.phone}</td><td className="td"><button className="p-1.5 text-slate-500 hover:text-blue-600" onClick={() => setF(b)}><Pencil size={16} /></button></td></tr>)}</tbody></table></div>}
      {f && <Modal title={f.id ? t('edit') : t('add_branch')} onClose={() => setF(null)} footer={<><button className="btn-ghost" onClick={() => setF(null)}>{t('cancel')}</button><button className="btn-primary" disabled={busy || !f.name.trim()} onClick={save}>{t('save')}</button></>}>
        <div className="space-y-3"><Field label={t('name')}><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={t('address')}><input className="input" value={f.address ?? ''} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <Field label={t('phone')}><input className="input" value={f.phone ?? ''} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field></div></Modal>}
    </div>
  );
}

function Users() {
  const { t } = useI18n();
  const { user: me, pharmacyName, refresh } = useAuth();
  const { toast } = useToast();
  const { run, busy } = useAction();
  const users = useLoad(() => api.get('/users'), []);
  const branches = useLoad(() => api.get('/branches'), []);
  const [f, setF] = useState<any>(null);
  const [reset, setReset] = useState<any>(null);
  const [pw, setPw] = useState('');
  const [toggle, setToggle] = useState<any>(null);
  const [name, setName] = useState(pharmacyName);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = async () => {
    const r = await run(() => (f.id ? api.put(`/users/${f.id}`, f) : api.post('/users', f)), t('saved'));
    if (r) { setF(null); users.reload(); }
  };
  const doRestore = async () => {
    if (!restoreFile) return;
    try {
      const res = await fetch('/api/restore', { method: 'POST', body: await restoreFile.arrayBuffer(), credentials: 'same-origin' });
      const d = await res.json();
      if (!res.ok) throw new ApiError(d.error, res.status);
      toast(t('restore_done'));
      setTimeout(() => window.location.reload(), 800);
    } catch (e: any) { toast(e.message, 'error'); }
    setRestoreFile(null);
  };

  return (
    <div className="max-w-5xl mx-auto">
      <PageTitle icon={<UserCog className="text-blue-600" />} title={t('nav_users')} right={<button className="btn-primary" onClick={() => setF({ role: 'cashier', name: '', username: '', password: '', branch_id: branches.data?.[0]?.id ?? '', specialty: '' })}><Plus size={16} />{t('add_user')}</button>} />
      {users.loading ? <Skeleton /> : (
        <div className="card !p-0 overflow-x-auto mb-6"><table className="w-full"><thead><tr><th className="th">{t('full_name')}</th><th className="th">{t('username')}</th><th className="th">{t('role')}</th><th className="th">{t('branch')}</th><th className="th">{t('status')}</th><th className="th" /></tr></thead>
          <tbody>{users.data.map((u: any) => <tr key={u.id}><td className="td font-bold">{u.name}{u.specialty && <span className="text-xs text-slate-400"> • {u.specialty}</span>}</td><td className="td">{u.username}</td><td className="td">{t('role_' + u.role)}</td><td className="td">{u.branch_name}</td>
            <td className="td"><Badge tone={u.active ? 'green' : 'slate'}>{t(u.active ? 'active' : 'inactive')}</Badge></td>
            <td className="td whitespace-nowrap"><button title={t('edit')} className="p-1.5 text-slate-500 hover:text-blue-600" onClick={() => setF({ ...u })}><Pencil size={16} /></button>
              <button title={t('reset_password')} className="p-1.5 text-slate-500 hover:text-amber-600" onClick={() => { setReset(u); setPw(''); }}><KeyRound size={16} /></button>
              {u.id !== me?.id && <button title={t(u.active ? 'deactivate' : 'activate')} className="p-1.5 text-slate-500 hover:text-red-600" onClick={() => setToggle(u)}><Power size={16} /></button>}</td></tr>)}</tbody></table></div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card space-y-3"><h3 className="font-extrabold">{t('pharmacy_name')}</h3>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn-primary" disabled={!name.trim()} onClick={async () => { await run(() => api.put('/settings', { pharmacy_name: name }), t('saved')); refresh(); }}>{t('save')}</button></div>
        <div className="card space-y-3"><h3 className="font-extrabold">{t('backup_restore')}</h3>
          <a className="btn-ghost" href="/api/backup"><Download size={16} />{t('export_backup')}</a>
          <input ref={fileRef} type="file" accept=".db,.sqlite" className="hidden" onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)} />
          <button className="btn-ghost" onClick={() => fileRef.current?.click()}><Upload size={16} />{t('import_backup')}</button></div>
      </div>

      {f && <Modal title={f.id ? t('edit') : t('add_user')} onClose={() => setF(null)} footer={<><button className="btn-ghost" onClick={() => setF(null)}>{t('cancel')}</button>
        <button className="btn-primary" disabled={busy || !f.name || (!f.id && (!f.username || !f.password))} onClick={save}>{t('save_user')}</button></>}>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={`${t('role')} *`}><select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{t('role_' + r)}</option>)}</select></Field>
          <Field label={`${t('full_name')} *`}><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={`${t('username')} *`}><input className="input" disabled={!!f.id} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
          {!f.id && <Field label={`${t('password')} *`}><input className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>}
          <Field label={t('branch')}><select className="input" value={f.branch_id ?? ''} onChange={(e) => setF({ ...f, branch_id: Number(e.target.value) })}>{(branches.data ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          {f.role === 'doctor' && <Field label={t('specialty')}><input className="input" value={f.specialty ?? ''} onChange={(e) => setF({ ...f, specialty: e.target.value })} /></Field>}
        </div></Modal>}
      {reset && <Modal title={`${t('reset_password')}: ${reset.name}`} onClose={() => setReset(null)} footer={<><button className="btn-ghost" onClick={() => setReset(null)}>{t('cancel')}</button>
        <button className="btn-primary" disabled={pw.length < 8} onClick={async () => { const r = await run(() => api.put(`/users/${reset.id}`, { password: pw }), t('saved')); if (r) setReset(null); }}>{t('save')}</button></>}>
        <Field label={t('new_password')}><input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field><p className="text-xs text-slate-500 mt-1">{t('err_password_len')}</p></Modal>}
      {toggle && <Confirm danger={!!toggle.active} title={t(toggle.active ? 'deactivate' : 'activate')} message={toggle.name} onCancel={() => setToggle(null)}
        onConfirm={async () => { await run(() => api.put(`/users/${toggle.id}`, { active: !toggle.active }), t('saved')); setToggle(null); users.reload(); }} />}
      {restoreFile && <Confirm title={t('import_backup')} message={t('restore_warning')} onCancel={() => setRestoreFile(null)} onConfirm={doRestore} />}
    </div>
  );
}
