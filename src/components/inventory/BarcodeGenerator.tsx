import { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import { Printer, Tag } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { api, qs } from '../../lib/api';
import { iqd } from '../../lib/format';
import type { Product } from '../../types/pharmacy';
import { Empty, Field, PageTitle, useDebounced, useAction } from '../common/ui';

function Barcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try { JsBarcode(ref.current, value, { format: /^\d{13}$/.test(value) ? 'EAN13' : 'CODE128', height: 32, width: 1.4, fontSize: 9, margin: 0, displayValue: true }); }
    catch { try { JsBarcode(ref.current, value, { format: 'CODE128', height: 32, width: 1.4, fontSize: 9, margin: 0 }); } catch { /* ignore */ } }
  }, [value]);
  return <svg ref={ref} style={{ maxWidth: '46mm' }} />;
}

export default function BarcodeGenerator() {
  const { t } = useI18n();
  const { run } = useAction();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [rows, setRows] = useState<Product[]>([]);
  const [sel, setSel] = useState<Product | null>(null);
  const [copies, setCopies] = useState(12);
  useEffect(() => { if (dq) api.get(`/products?${qs({ q: dq, size: 8 })}`).then((r) => setRows(r.rows)).catch(() => {}); else setRows([]); }, [dq]);

  const ensureBarcode = async () => {
    if (!sel || sel.barcode) return;
    const code = (await api.get('/barcode/next')).barcode;
    const r = await run(() => api.put(`/products/${sel.id}`, { ...sel, barcode: code }), t('saved'));
    if (r) setSel({ ...sel, barcode: code });
  };

  return (
    <div className="max-w-5xl mx-auto">
      <PageTitle icon={<Tag className="text-purple-500" />} title={t('barcode_title')} subtitle={t('barcode_sub')} />
      <div className="grid lg:grid-cols-[340px_1fr] gap-4">
        <div className="card no-print space-y-3">
          <Field label={t('search_medicine')}><input className="input" value={q} onChange={(e) => { setQ(e.target.value); setSel(null); }} /></Field>
          {!sel && rows.length > 0 && <ul className="divide-y divide-slate-100">{rows.map((p) => (
            <li key={p.id}><button className="w-full text-start py-2 px-2 hover:bg-slate-50 rounded text-sm font-bold" onClick={() => { setSel(p); setQ(p.brand_name); }}>{p.brand_name} {p.dosage}</button></li>))}</ul>}
          {sel && (
            <>
              <Field label={t('copies')}><input className="input" type="number" min={1} max={500} value={copies} onChange={(e) => setCopies(Math.max(1, Math.min(500, Number(e.target.value) || 1)))} /></Field>
              {!sel.barcode && <button className="btn-ghost w-full" onClick={ensureBarcode}>{t('generate')} {t('barcode')}</button>}
              <button className="btn-primary w-full" disabled={!sel.barcode} onClick={() => window.print()}><Printer size={16} />{t('print_stickers')}</button>
            </>
          )}
        </div>
        <div className="card">
          {!sel ? <Empty icon={<Tag size={36} />} text={t('select_medicine_stickers')} /> : (
            <div className="print-area flex flex-wrap gap-1">
              {sel.barcode && Array.from({ length: copies }).map((_, i) => (
                <div key={i} className="sticker">
                  <b style={{ fontSize: 9, textAlign: 'center', lineHeight: 1.1 }}>{sel.brand_name} {sel.dosage}</b>
                  <Barcode value={sel.barcode!} />
                  <div style={{ display: 'flex', gap: 6, fontSize: 9 }}><b>{iqd(sel.price)}</b>{sel.nearest_expiry && <span>EXP {sel.nearest_expiry.slice(0, 7)}</span>}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
