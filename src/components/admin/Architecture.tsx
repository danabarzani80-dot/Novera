import { useState } from 'react';
import { BookOpen, Check, Copy } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import schema from '../../db/schema.sql?raw';
import { PageTitle } from '../common/ui';

const TREE = `pharmacy-pos/
├── electron/            main.ts, preload.ts, builder.config.js
├── src/
│   ├── components/      common, pos, inventory, purchasing, ledger, reports, doctors, admin
│   ├── db/              schema.sql, database.ts
│   ├── i18n/            translations.ts, I18nContext.tsx
│   ├── server/          core.ts (business rules), routes.ts (REST API)
│   ├── types/           pharmacy.ts (roles, permissions)
│   ├── App.tsx, main.tsx
├── server.ts            Express API + serves the Vite build
├── tests/               core.test.ts (FEFO, expiry lock, Qarz, P&L)
└── package.json, vite.config.ts`;

const I18N = `Languages: EN (LTR), کوردی / Kurdish Sorani (RTL), عربي / Arabic (RTL)

• I18nContext keeps the language and sets <html dir> and <html lang>:
    en -> dir="ltr"     ku, ar -> dir="rtl"
• Every string is a key in translations.ts: key -> [English, Kurdish, Arabic].
  t('key') falls back to English, and warns in dev mode if a key is missing.
• Layout uses Tailwind logical properties (ms-, me-, ps-, pe-, start-, end-,
  text-start) so the whole screen mirrors automatically in RTL.
• Directional icons use rtl:rotate-180. The chosen language is stored per user.`;

function Block({ title, code }: { title: string; code: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <div className="card !p-0 mb-4 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-slate-50">
        <b className="text-sm">{title}</b>
        <button className="btn-ghost !py-1" onClick={() => { navigator.clipboard?.writeText(code); setDone(true); setTimeout(() => setDone(false), 1500); }}>
          {done ? <Check size={14} /> : <Copy size={14} />}{done ? t('copied') : t('copy')}</button>
      </div>
      <pre className="p-4 text-xs overflow-x-auto bg-slate-900 text-slate-100 max-h-96" dir="ltr">{code}</pre>
    </div>
  );
}

export default function Architecture() {
  const { t } = useI18n();
  return (
    <div className="max-w-5xl mx-auto">
      <PageTitle icon={<BookOpen className="text-blue-600" />} title={t('nav_architecture')} subtitle={t('architecture_sub')} />
      <Block title={t('arch_tree')} code={TREE} />
      <Block title={t('arch_schema')} code={schema} />
      <Block title={t('arch_i18n')} code={I18N} />
    </div>
  );
}
