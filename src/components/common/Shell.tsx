import { useEffect, useState } from 'react';
import {
  Activity, AlertTriangle, BarChart3, Building2, CheckCircle2, ClipboardList, Clock, FileText, Globe, LayoutDashboard, LogOut, Menu,
  PackageSearch, RotateCcw, ScrollText, Settings, ShoppingCart, Stethoscope, Tag, Truck, Undo2, Users, UserCog, Wallet, X, Wifi, WifiOff, BookOpen, Boxes, ArrowLeftRight, Receipt,
} from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { useAuth } from '../../lib/auth';
import { can, type Lang, type Module } from '../../types/pharmacy';
import { api } from '../../lib/api';
import { Modal, useAction } from './ui';
import { iqd, parseNum } from '../../lib/format';

const ROLE_KEY: Record<string, string> = {
  super_admin: 'role_super_admin', pharmacist: 'role_pharmacist', cashier: 'role_cashier', warehouse_manager: 'role_warehouse_manager', doctor: 'role_doctor',
};

const MENU: { section: string; items: { id: Module; label: string; icon: any; color?: string; badge?: boolean }[] }[] = [
  { section: 'sec_main', items: [
    { id: 'dashboard', label: 'nav_dashboard', icon: LayoutDashboard },
    { id: 'pos', label: 'nav_pos', icon: ShoppingCart },
    { id: 'returns', label: 'nav_returns', icon: Undo2 },
    { id: 'doctor', label: 'nav_doctor', icon: Stethoscope, color: 'text-amber-400' },
  ] },
  { section: 'sec_inventory', items: [
    { id: 'products', label: 'nav_products', icon: Boxes },
    { id: 'barcode', label: 'nav_barcode', icon: Tag, color: 'text-purple-400' },
    { id: 'transfers', label: 'nav_transfers', icon: Building2, color: 'text-emerald-400' },
    { id: 'adjust', label: 'nav_adjust', icon: ClipboardList },
    { id: 'expiry', label: 'nav_expiry', icon: AlertTriangle, color: 'text-amber-400', badge: true },
    { id: 'receive', label: 'nav_receive', icon: PackageSearch },
    { id: 'rtv', label: 'nav_rtv', icon: RotateCcw },
    { id: 'supplier', label: 'nav_supplier', icon: Truck },
  ] },
  { section: 'sec_management', items: [
    { id: 'customers', label: 'nav_customers', icon: Users },
    { id: 'shifts', label: 'nav_shifts', icon: Clock },
    { id: 'accounting', label: 'nav_accounting', icon: BarChart3 },
  ] },
  { section: 'sec_system', items: [
    { id: 'branches', label: 'nav_branches', icon: Building2 },
    { id: 'users', label: 'nav_users', icon: UserCog },
    { id: 'audit', label: 'nav_audit', icon: ScrollText },
    { id: 'architecture', label: 'nav_architecture', icon: BookOpen },
  ] },
];
void [Activity, CheckCircle2, FileText, Settings, Wallet, ArrowLeftRight, Receipt];

export function Sidebar({ page, onNavigate, badge, open, onClose }: { page: Module; onNavigate: (m: Module) => void; badge: number; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <>
      {open && <div className="fixed inset-0 bg-black/40 z-30 lg:hidden no-print" onClick={onClose} />}
      <aside className={`no-print bg-slate-900 w-56 shrink-0 flex flex-col overflow-hidden z-40
        fixed lg:static inset-y-0 start-0 pt-16 lg:pt-0 transition-transform ${open ? 'translate-x-0' : 'ltr:-translate-x-full rtl:translate-x-full'} lg:!translate-x-0`}>
        <nav className="flex-1 overflow-y-auto p-3">
          {MENU.map((sec) => {
            const items = sec.items.filter((i) => can(user.role, i.id));
            if (!items.length) return null;
            return (
              <div key={sec.section} className="mb-4">
                <div className="px-3 mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{t(sec.section)}</div>
                {items.map((i) => {
                  const Icon = i.icon;
                  const active = page === i.id;
                  return (
                    <button key={i.id} onClick={() => { onNavigate(i.id); onClose(); }}
                      className={`w-full flex items-center justify-between px-3 py-2 mb-1 rounded-lg text-xs transition-all ${
                        active ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-500/20' : 'text-slate-400 font-medium hover:bg-slate-800 hover:text-slate-100'}`}>
                      <span className="flex items-center gap-2 min-w-0">
                        <Icon size={16} className={active ? 'text-white' : i.color} />
                        <span className="truncate">{t(i.label)}</span>
                      </span>
                      {i.badge && badge > 0 && <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 min-w-5 text-center">{badge}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="p-3 border-t border-slate-800">
          <button onClick={logout} className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg py-2 text-xs font-bold">
            <LogOut size={14} className="rtl:rotate-180" />{t('logout')}
          </button>
        </div>
      </aside>
    </>
  );
}

export function ShiftDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const { shift } = useAuth();
  const { run, busy } = useAction();
  const [cash, setCash] = useState('');
  const [summary, setSummary] = useState<any>(null);
  useEffect(() => { if (shift) api.get('/shifts/current').then(setSummary).catch(() => {}); }, [shift]);
  const counted = parseNum(cash);
  return (
    <Modal title={shift ? t('close_shift') : t('open_shift')} onClose={onClose} footer={<>
      <button className="btn-ghost" onClick={onClose}>{t('cancel')}</button>
      <button className="btn-primary" disabled={busy || cash === ''} onClick={async () => {
        const r = await run(() => shift ? api.post('/shifts/close', { counted_cash: counted }) : api.post('/shifts/open', { opening_cash: counted }), t(shift ? 'shift_closed' : 'shift_opened'));
        if (r) onDone();
      }}>{shift ? t('close_shift') : t('open_shift')}</button>
    </>}>
      {shift && summary && (
        <div className="mb-4 rounded-xl bg-slate-50 border border-slate-200 p-3 text-sm space-y-1">
          <div className="flex justify-between"><span>{t('opening_cash')}</span><b>{iqd(summary.opening_cash)}</b></div>
          <div className="flex justify-between"><span>{t('cash_sales')}</span><b>{iqd(summary.cash)}</b></div>
          <div className="flex justify-between"><span>{t('qarz_collected')}</span><b>{iqd(summary.qarz_collected)}</b></div>
          <div className="flex justify-between"><span>{t('cash_refunds')}</span><b>-{iqd(summary.cash_refunds)}</b></div>
          <div className="flex justify-between border-t pt-1"><span>{t('expected_cash')}</span><b>{iqd(summary.expected_cash)}</b></div>
          {cash !== '' && <div className={`flex justify-between font-bold ${counted - summary.expected_cash === 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            <span>{t('difference')}</span><span>{iqd(counted - summary.expected_cash)}</span></div>}
        </div>
      )}
      <label className="label">{shift ? t('counted_cash') : t('opening_cash')}</label>
      <input className="input" inputMode="numeric" autoFocus value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0" />
    </Modal>
  );
}

export function Header({ onMenu, badge, onShiftChanged }: { onMenu: () => void; badge?: number; onShiftChanged: () => void }) {
  const { t, lang, setLang } = useI18n();
  const { user, shift, pharmacyName } = useAuth();
  const [online, setOnline] = useState(navigator.onLine);
  const [showShift, setShowShift] = useState(false);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  void badge;
  if (!user) return null;
  const initials = user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const langs: [Lang, string][] = [['en', 'EN'], ['ku', 'کوردی'], ['ar', 'عربي']];
  const showShiftPill = can(user.role, 'pos') || can(user.role, 'shifts');
  return (
    <header className="no-print h-16 shrink-0 bg-white border-b border-slate-200 px-4 flex justify-between items-center gap-3 z-50 relative">
      <div className="flex items-center gap-3 min-w-0">
        <button className="lg:hidden p-2 rounded-lg hover:bg-slate-100" onClick={onMenu}><Menu size={20} /></button>
        <div className="w-10 h-10 rounded-xl bg-blue-600 text-white font-extrabold text-xl flex items-center justify-center shrink-0">P</div>
        <div className="min-w-0">
          <div className="font-extrabold uppercase text-sm text-slate-900 truncate">{pharmacyName || 'Pharmacy'} {t('app_name_suffix')}</div>
          <div className="text-[11px] text-slate-400 truncate hidden sm:block">
            {t('app_subtitle')} •{' '}
            {online ? <span className="text-emerald-600 font-bold inline-flex items-center gap-1"><Wifi size={11} />✓ {t('synced')}</span>
              : <span className="text-red-500 font-bold inline-flex items-center gap-1"><WifiOff size={11} />{t('offline')}</span>}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        {showShiftPill && (
          <button onClick={() => setShowShift(true)} className="hidden sm:flex items-center gap-2 bg-orange-50 border border-orange-300 text-orange-700 rounded-full px-3 py-1.5 text-xs font-bold">
            <Clock size={14} className="text-orange-500" />
            {shift ? t('shift_active', { n: shift.id }) : t('no_active_shift')}
          </button>
        )}
        <div className="flex items-center bg-slate-100 rounded-full p-0.5 text-xs font-bold">
          <Globe size={14} className="mx-2 text-slate-500" />
          {langs.map(([l, label]) => (
            <button key={l} onClick={() => setLang(l)} className={`px-2.5 py-1 rounded-full ${lang === l ? 'bg-blue-600 text-white' : 'text-slate-600'}`}>{label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-purple-600 text-white text-xs font-bold flex items-center justify-center">{initials}</div>
          <div className="hidden md:block leading-tight">
            <div className="text-sm font-bold text-slate-900">{user.name}</div>
            <div className="text-[11px] font-bold text-blue-600">{t(ROLE_KEY[user.role])}</div>
          </div>
        </div>
      </div>
      {showShift && <ShiftDialog onClose={() => setShowShift(false)} onDone={() => { setShowShift(false); onShiftChanged(); }} />}
    </header>
  );
}
void X;
