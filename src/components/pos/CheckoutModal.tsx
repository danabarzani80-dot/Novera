import { useI18n } from '../../i18n/I18nContext';
import { iqd } from '../../lib/format';
import { Modal } from '../common/ui';

export interface CheckoutSummary {
  items: number; subtotal: number; discount: number; total: number; method: string; cash: number; card: number; qarz: number; change: number; customer?: string;
}

export function CheckoutModal({ s, busy, onConfirm, onClose }: { s: CheckoutSummary; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const m: Record<string, string> = { cash: 'pay_cash', card: 'pay_card', mixed: 'pay_mixed', qarz: 'pay_qarz' };
  const Row = ({ k, v, strong }: { k: string; v: string; strong?: boolean }) => (
    <div className={`flex justify-between py-1 ${strong ? 'text-lg font-extrabold border-t mt-1 pt-2' : 'text-sm'}`}><span className="text-slate-600">{k}</span><span className={strong ? 'text-blue-600' : 'font-bold'}>{v}</span></div>
  );
  return (
    <Modal title={t('confirm_payment')} onClose={onClose} footer={<>
      <button className="btn-ghost" onClick={onClose}>{t('cancel')}</button>
      <button className="btn-green" autoFocus disabled={busy} onClick={onConfirm}>{t('complete_sale')}</button>
    </>}>
      <Row k={t('items')} v={String(s.items)} />
      <Row k={t('subtotal')} v={iqd(s.subtotal)} />
      {s.discount > 0 && <Row k={t('discount')} v={`-${iqd(s.discount)}`} />}
      <Row k={t('payment_method')} v={t(m[s.method])} />
      {s.customer && <Row k={t('customer')} v={s.customer} />}
      {s.cash > 0 && <Row k={t('pay_cash')} v={iqd(s.cash)} />}
      {s.card > 0 && <Row k={t('pay_card')} v={iqd(s.card)} />}
      {s.qarz > 0 && <Row k={t('pay_qarz')} v={iqd(s.qarz)} />}
      {s.change > 0 && <Row k={t('change')} v={iqd(s.change)} />}
      <Row k={t('total')} v={iqd(s.total)} strong />
    </Modal>
  );
}
