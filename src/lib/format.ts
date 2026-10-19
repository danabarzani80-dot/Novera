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
// Stock text for medicines sold loose: packs + opened sheets/tablets. loose is in the smallest unit.
export const stockText = (packs: number, loose: number, spp: number, tps: number, t: (k: string) => string) => {
  const parts = [`${packs} ${t('unit_packs')}`];
  const sheets = tps > 1 ? Math.floor(loose / tps) : loose;
  const tabs = tps > 1 ? loose % tps : 0;
  if (spp > 1 && sheets > 0) parts.push(`${sheets} ${t('unit_sheets')}`);
  if (tabs > 0) parts.push(`${tabs} ${t('unit_tablets')}`);
  return parts.join(' + ');
};
export const parseNum = (s: string) => Math.max(0, Math.round(Number(String(s).replace(/[^\d.]/g, '')) || 0));
