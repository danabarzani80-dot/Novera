import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n/I18nContext';
import { api } from '../../lib/api';
import { iqd } from '../../lib/format';
import type { Product } from '../../types/pharmacy';
import { Empty, Modal, Skeleton } from '../common/ui';

export function AlternativeMedicineModal({ product, onClose, onPick }: { product: Product; onClose: () => void; onPick: (p: Product) => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<Product[] | null>(null);
  useEffect(() => { api.get(`/products/${product.id}/alternatives`).then(setRows).catch(() => setRows([])); }, [product.id]);
  return (
    <Modal title={`${t('alternatives')}: ${product.brand_name}`} onClose={onClose}>
      <p className="text-xs text-slate-500 mb-3">{t('same_generic')}: <b>{product.generic_name || '—'}</b></p>
      {!rows ? <Skeleton rows={3} /> : rows.length === 0 ? <Empty text={t('no_alternatives')} /> : (
        <ul className="divide-y divide-slate-100">
          {rows.map((p) => (
            <li key={p.id} className="py-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-bold text-sm">{p.brand_name} {p.dosage}</div>
                <div className="text-xs text-slate-500">{p.manufacturer} • {p.stock} {t('pcs')} • {p.shelf_rack}</div>
              </div>
              <div className="flex items-center gap-3">
                <b className="text-sm">{iqd(p.price)}</b>
                <button className="btn-primary !py-1" onClick={() => { onPick(p); onClose(); }}>{t('add')}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
