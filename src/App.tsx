import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './lib/auth';
import { useI18n } from './i18n/I18nContext';
import { api } from './lib/api';
import { can, ROLE_MODULES, type Module } from './types/pharmacy';
import { Header, Sidebar } from './components/common/Shell';
import { LoginScreen, SetupScreen } from './components/common/AuthScreens';
import { Skeleton, Spinner } from './components/common/ui';

import Dashboard from './components/Dashboard';
import POSScreen from './components/pos/POSScreen';

const L = {
  returns: lazy(() => import('./components/pos/SalesReturns')),
  doctor: lazy(() => import('./components/doctors/DoctorPortal')),
  products: lazy(() => import('./components/inventory/ProductsCatalog')),
  barcode: lazy(() => import('./components/inventory/BarcodeGenerator')),
  transfers: lazy(() => import('./components/inventory/BranchTransfers')),
  adjust: lazy(() => import('./components/inventory/StockAdjustment')),
  expiry: lazy(() => import('./components/inventory/ExpiryTracker')),
  receive: lazy(() => import('./components/purchasing/ReceiveInvoice')),
  rtv: lazy(() => import('./components/purchasing/ReturnToVendor')),
  supplier: lazy(() => import('./components/purchasing/SupplierLedger')),
  customers: lazy(() => import('./components/ledger/CustomerLedgerView')),
  shifts: lazy(() => import('./components/reports/ShiftZReport')),
  accounting: lazy(() => import('./components/reports/PnLReport')),
  branches: lazy(() => import('./components/admin/UsersBranchesDoctors')),
  users: lazy(() => import('./components/admin/UsersBranchesDoctors')),
  audit: lazy(() => import('./components/admin/AuditLogView')),
  architecture: lazy(() => import('./components/admin/Architecture')),
};

export default function App() {
  const { user, loading, needsSetup, refresh } = useAuth();
  const { setLang } = useI18n();
  const [page, setPage] = useState<Module>('dashboard');
  const [menuOpen, setMenuOpen] = useState(false);
  const [badge, setBadge] = useState(0);
  const langApplied = useRef<number | null>(null);

  // Apply the saved per-user language once after sign-in.
  useEffect(() => {
    if (user && langApplied.current !== user.id) {
      langApplied.current = user.id;
      if (user.lang) setLang(user.lang);
    }
    if (!user) langApplied.current = null;
  }, [user, setLang]);

  // Land on the first module the role may use.
  useEffect(() => {
    if (user && !can(user.role, page)) setPage(ROLE_MODULES[user.role][0]);
  }, [user, page]);

  const loadBadge = useCallback(() => {
    if (!user || user.role === 'doctor') return;
    api.get('/badges').then((b) => setBadge(b.expiry)).catch(() => {});
  }, [user]);
  useEffect(() => { loadBadge(); const h = setInterval(loadBadge, 60_000); return () => clearInterval(h); }, [loadBadge]);

  if (loading) return <div className="h-full flex items-center justify-center"><Spinner /></div>;
  if (needsSetup) return <SetupScreen />;
  if (!user) return <LoginScreen />;

  const go = (m: Module) => { setPage(m); loadBadge(); };
  let body;
  if (page === 'dashboard') body = <Dashboard onNavigate={go} />;
  else if (page === 'pos') body = <POSScreen onSold={loadBadge} />;
  else {
    const Cmp: any = L[page as keyof typeof L];
    body = Cmp ? <Suspense fallback={<div className="p-6"><Skeleton rows={6} /></div>}><Cmp mode={page} onNavigate={go} /></Suspense> : null;
  }

  return (
    <div className="h-full flex flex-col">
      <Header onMenu={() => setMenuOpen(true)} badge={badge} onShiftChanged={refresh} />
      <div className="flex flex-1 min-h-0">
        <Sidebar page={page} onNavigate={go} badge={badge} open={menuOpen} onClose={() => setMenuOpen(false)} />
        <main className={`flex-1 min-w-0 overflow-y-auto bg-slate-100 ${page === 'pos' ? '' : 'p-4 lg:p-6'}`}>{body}</main>
      </div>
    </div>
  );
}
