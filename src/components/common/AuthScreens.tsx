import { useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../i18n/I18nContext';
import { useAction } from './ui';
import type { Lang } from '../../types/pharmacy';

function Frame({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  const { lang, setLang } = useI18n();
  const langs: [Lang, string][] = [['en', 'EN'], ['ku', 'کوردی'], ['ar', 'عربي']];
  return (
    <div className="min-h-full flex items-center justify-center p-4 bg-slate-100">
      <div className="card w-full max-w-md">
        <div className="flex justify-end mb-2">
          <div className="flex bg-slate-100 rounded-full p-0.5 text-xs font-bold">
            {langs.map(([l, label]) => <button key={l} onClick={() => setLang(l)} className={`px-2.5 py-1 rounded-full ${lang === l ? 'bg-blue-600 text-white' : 'text-slate-600'}`}>{label}</button>)}
          </div>
        </div>
        <div className="w-12 h-12 rounded-xl bg-blue-600 text-white font-extrabold text-2xl flex items-center justify-center mb-3">P</div>
        <h1 className="text-xl font-extrabold">{title}</h1>
        <p className="text-sm text-slate-500 mb-5">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

export function SetupScreen() {
  const { t } = useI18n();
  const { refresh } = useAuth();
  const { run, busy } = useAction();
  const [f, setF] = useState({ pharmacy_name: '', name: '', username: '', password: '', confirm: '' });
  const [err, setErr] = useState('');
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (f.password.length < 8) return setErr(t('err_password_len'));
    if (f.password !== f.confirm) return setErr(t('err_password_match'));
    setErr('');
    const ok = await run(async () => {
      await api.post('/auth/setup', f);
      await api.post('/auth/login', { username: f.username, password: f.password });
      return true;
    });
    if (ok) refresh();
  };
  return (
    <Frame title={t('setup_title')} subtitle={t('setup_sub')}>
      <form onSubmit={submit} className="space-y-3">
        <div><label className="label">{t('pharmacy_name')}</label><input className="input" required value={f.pharmacy_name} onChange={set('pharmacy_name')} /></div>
        <div><label className="label">{t('full_name')} *</label><input className="input" required value={f.name} onChange={set('name')} /></div>
        <div><label className="label">{t('username')} *</label><input className="input" required autoComplete="username" value={f.username} onChange={set('username')} /></div>
        <div><label className="label">{t('password')} *</label><input className="input" type="password" required autoComplete="new-password" value={f.password} onChange={set('password')} /></div>
        <div><label className="label">{t('confirm_password')} *</label><input className="input" type="password" required autoComplete="new-password" value={f.confirm} onChange={set('confirm')} /></div>
        {err && <p className="text-sm text-red-600 font-medium">{err}</p>}
        <button className="btn-primary w-full" disabled={busy}><ShieldCheck size={16} />{t('create_super_admin')}</button>
      </form>
    </Frame>
  );
}

export function LoginScreen() {
  const { t } = useI18n();
  const { refresh, pharmacyName } = useAuth();
  const { run, busy } = useAction();
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(async () => { await api.post('/auth/login', { username, password }); return true; });
    if (ok) refresh();
  };
  return (
    <Frame title={pharmacyName || t('login_title')} subtitle={t('login_sub')}>
      <form onSubmit={submit} className="space-y-3">
        <div><label className="label">{t('username')}</label><input className="input" autoFocus autoComplete="username" value={username} onChange={(e) => setU(e.target.value)} /></div>
        <div><label className="label">{t('password')}</label><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setP(e.target.value)} /></div>
        <button className="btn-primary w-full" disabled={busy || !username || !password}>{t('login')}</button>
      </form>
    </Frame>
  );
}
