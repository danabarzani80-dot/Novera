// LTR isolate (U+2066 … U+2069) keeps "1,000 د.ع" in one visual order inside RTL layouts.
export const iqd = (n: number | null | undefined) => `⁦${Math.round(n ?? 0).toLocaleString('en-US')} د.ع⁩`;
export const num = (n: number | null | undefined) => Math.round(n ?? 0).toLocaleString('en-US');
export const pad = (n: number) => String(n).padStart(2, '0');
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fmtDateTime = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fmtTime = (iso: string) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const parseNum = (s: string) => Math.max(0, Math.round(Number(String(s).replace(/[^\d.]/g, '')) || 0));
