import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { I18nProvider } from './i18n/I18nContext';
import { AuthProvider } from './lib/auth';
import { ToastProvider } from './components/common/ui';
import { api } from './lib/api';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider onChange={(l) => { api.put('/auth/lang', { lang: l }).catch(() => {}); }}>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </I18nProvider>
  </StrictMode>,
);
