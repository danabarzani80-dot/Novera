import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Lang } from '../types/pharmacy';
import { dictionary } from './translations';

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  dir: 'ltr' | 'rtl';
}

const Ctx = createContext<I18n>(null as unknown as I18n);
const warned = new Set<string>();

export function I18nProvider({ children, initial, onChange }: { children: ReactNode; initial?: Lang; onChange?: (l: Lang) => void }) {
  const [lang, setLangState] = useState<Lang>(() => initial ?? ((localStorage.getItem('lang') as Lang) || 'en'));
  const dir: 'ltr' | 'rtl' = lang === 'en' ? 'ltr' : 'rtl';

  useEffect(() => {
    document.documentElement.dir = dir;
    document.documentElement.lang = lang;
  }, [lang, dir]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem('lang', l);
    onChange?.(l);
  }, [onChange]);

  const t = useCallback((key: string, vars?: Record<string, string | number>) => {
    const entry = dictionary[key];
    let s: string;
    if (!entry) {
      if (import.meta.env?.DEV && !warned.has(key)) { warned.add(key); console.warn(`[i18n] missing key: ${key}`); }
      s = key;
    } else {
      const idx = lang === 'en' ? 0 : lang === 'ku' ? 1 : 2;
      s = entry[idx] || entry[0];
      if (import.meta.env?.DEV && !entry[idx] && !warned.has(key + lang)) { warned.add(key + lang); console.warn(`[i18n] missing ${lang} translation: ${key}`); }
    }
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t, dir }), [lang, setLang, t, dir]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
