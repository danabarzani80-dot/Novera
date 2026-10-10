import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import type { SessionUser } from '../types/pharmacy';

export interface ActiveShift { id: number; opened_at: string; opening_cash: number; receipts?: number }
interface AuthState {
  user: SessionUser | null;
  pharmacyName: string;
  shift: ActiveShift | null;
  needsSetup: boolean | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState>(null as unknown as AuthState);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [pharmacyName, setName] = useState('');
  const [shift, setShift] = useState<ActiveShift | null>(null);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const s = await api.get('/auth/status');
      setNeedsSetup(s.needsSetup);
      if (s.needsSetup) { setUser(null); return; }
      const me = await api.get('/auth/me');
      setUser(me.user); setName(me.pharmacyName); setShift(me.shift);
    } catch {
      setUser(null);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const h = () => setUser(null);
    window.addEventListener('auth:expired', h);
    return () => window.removeEventListener('auth:expired', h);
  }, []);

  const logout = useCallback(async () => { await api.post('/auth/logout'); setUser(null); }, []);

  return <Ctx.Provider value={{ user, pharmacyName, shift, needsSetup, loading, refresh, logout }}>{children}</Ctx.Provider>;
}
