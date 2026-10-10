import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';

// ───────── Toasts ─────────
type ToastKind = 'success' | 'error' | 'info';
interface ToastApi { toast: (msg: string, kind?: ToastKind) => void }
const ToastCtx = createContext<ToastApi>({ toast: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; kind: ToastKind }[]>([]);
  const idRef = useRef(0);
  const toast = useCallback((msg: string, kind: ToastKind = 'success') => {
    const id = ++idRef.current;
    setItems((s) => [...s, { id, msg, kind }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="no-print fixed bottom-4 end-4 z-[100] flex flex-col gap-2 w-80 max-w-[90vw]">
        {items.map((i) => (
          <div key={i.id} className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm shadow-lg bg-white ${
            i.kind === 'error' ? 'border-red-200 text-red-700' : i.kind === 'info' ? 'border-blue-200 text-blue-700' : 'border-emerald-200 text-emerald-700'}`}>
            {i.kind === 'error' ? <XCircle size={18} className="mt-0.5 shrink-0" /> : i.kind === 'info' ? <Info size={18} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={18} className="mt-0.5 shrink-0" />}
            <span className="flex-1 font-medium">{i.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// Runs an async action, toasts any error.
export function useAction() {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      if (success) toast(success, 'success');
      return r;
    } catch (e: any) {
      toast(e?.message || 'Error', 'error');
    } finally { setBusy(false); }
  }, [toast]);
  return { run, busy };
}

// Loads data with loading + reload.
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const reload = useCallback(() => {
    setLoading(true);
    return fn().then(setData).catch((e) => toast(e.message, 'error')).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { data, loading, reload, setData };
}

// ───────── Layout bits ─────────
export function Spinner() { return <Loader2 className="animate-spin text-blue-600" size={20} />; }

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return <div className="space-y-2">{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton h-9 w-full" />)}</div>;
}

export function Empty({ icon, text }: { icon?: ReactNode; text: string }) {
  return <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">{icon}<p className="text-sm font-medium text-center">{text}</p></div>;
}

export function PageTitle({ icon, title, subtitle, right }: { icon?: ReactNode; title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5 no-print">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">{icon}{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2 flex-wrap">{right}</div>
    </div>
  );
}

export function StatCard({ title, value, sub, tone = 'blue', icon, valueClass = '' }: {
  title: string; value: ReactNode; sub?: ReactNode; tone?: 'blue' | 'red' | 'amber' | 'green' | 'purple' | 'orange'; icon: ReactNode; valueClass?: string;
}) {
  const tones: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600', red: 'bg-red-50 text-red-600', amber: 'bg-amber-50 text-amber-600',
    green: 'bg-emerald-50 text-emerald-600', purple: 'bg-purple-50 text-purple-600', orange: 'bg-orange-50 text-orange-600',
  };
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="card-title">{title}</div>
          <div className={`text-2xl font-extrabold mt-2 ${valueClass}`}>{value}</div>
        </div>
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${tones[tone]}`}>{icon}</div>
      </div>
      {sub && <div className="mt-2 text-xs">{sub}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'red' | 'orange' | 'amber' | 'green' | 'blue' | 'purple' }) {
  const m: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-600', red: 'bg-red-100 text-red-700', orange: 'bg-orange-100 text-orange-700',
    amber: 'bg-amber-100 text-amber-700', green: 'bg-emerald-100 text-emerald-700', blue: 'bg-blue-100 text-blue-700', purple: 'bg-purple-100 text-purple-700',
  };
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${m[tone]}`}>{children}</span>;
}

export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 no-print" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[92vh] flex flex-col`}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="font-extrabold text-slate-900">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ title, message, onConfirm, onCancel, danger = true }: { title: string; message: string; onConfirm: () => void; onCancel: () => void; danger?: boolean }) {
  const { t } = useI18n();
  return (
    <Modal title={title} onClose={onCancel} footer={<>
      <button className="btn-ghost" onClick={onCancel}>{t('cancel')}</button>
      <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm}>{t('confirm')}</button>
    </>}>
      <div className="flex gap-3"><AlertTriangle className="text-amber-500 shrink-0" /><p className="text-sm text-slate-700">{message}</p></div>
    </Modal>
  );
}

export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <div className={className}><label className="label">{label}</label>{children}</div>;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-xl bg-slate-200/70 p-1 no-print">
      {items.map((i) => (
        <button key={i.id} onClick={() => onChange(i.id)}
          className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${value === i.id ? 'bg-slate-900 text-white shadow' : 'text-slate-600 hover:text-slate-900'}`}>{i.label}</button>
      ))}
    </div>
  );
}

export function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => { const h = setTimeout(() => setV(value), ms); return () => clearTimeout(h); }, [value, ms]);
  return v;
}
