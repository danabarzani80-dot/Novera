import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { fmtDateTime, num } from '../../lib/format';
import { Modal, Skeleton } from './ui';

export function ThermalReceiptModal({ invoiceId, onClose }: { invoiceId: number; onClose: () => void }) {
  const { t } = useI18n();
  const { pharmacyName } = useAuth();
  const [inv, setInv] = useState<any>(null);
  useEffect(() => { api.get(`/invoices/${invoiceId}`).then(setInv).catch(() => {}); }, [invoiceId]);
  const methodKey: Record<string, string> = { cash: 'pay_cash', card: 'pay_card', mixed: 'pay_mixed', qarz: 'pay_qarz' };

  return (
    <Modal title={t('receipt')} onClose={onClose} footer={<>
      <button className="btn-ghost" onClick={onClose}>{t('close')}</button>
      <button className="btn-primary" onClick={() => window.print()}><Printer size={16} />{t('print')}</button>
    </>}>
      {!inv ? <Skeleton rows={6} /> : (
        <div className="flex justify-center">
          <div className="receipt print-area shadow border border-slate-200" dir="auto">
            <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 14 }}>{pharmacyName || 'Pharmacy'}</div>
            <div style={{ textAlign: 'center' }}>{inv.invoice_number}</div>
            <div style={{ textAlign: 'center' }}>{fmtDateTime(inv.created_at)}</div>
            <div style={{ textAlign: 'center' }}>{t('cashier')}: {inv.cashier}</div>
            {inv.customer_name && <div style={{ textAlign: 'center' }}>{t('customer')}: {inv.customer_name}</div>}
            <hr />
            {inv.items.map((i: any) => (
              <div key={i.id} style={{ marginBottom: 3 }}>
                <div>{i.brand_name} {i.dosage ?? ''}</div>
                <div className="row"><span>{i.quantity}{i.pack_size > 1 ? ` ${t(`unit_${i.sale_unit}`)}` : ''} × {num(i.unit_price)}</span><span>{num(i.total_amount)}</span></div>
              </div>
            ))}
            <hr />
            <div className="row"><span>{t('subtotal')}</span><span>{num(inv.subtotal)}</span></div>
            {inv.discount_amount > 0 && <div className="row"><span>{t('discount')}</span><span>-{num(inv.discount_amount)}</span></div>}
            {inv.discount_amount < 0 && <div className="row"><span>{t('extra_amount')}</span><span>+{num(-inv.discount_amount)}</span></div>}
            <div className="row" style={{ fontWeight: 700, fontSize: 14 }}><span>{t('total')}</span><span>{num(inv.grand_total)} د.ع</span></div>
            <div className="row"><span>{t('payment_method')}</span><span>{t(methodKey[inv.payment_method])}</span></div>
            {inv.payment_method !== 'card' && inv.received_amount > 0 && <div className="row"><span>{t('amount_received')}</span><span>{num(inv.received_amount)}</span></div>}
            {inv.change_amount > 0 && <div className="row"><span>{t('change')}</span><span>{num(inv.change_amount)}</span></div>}
            {inv.qarz_amount > 0 && <div className="row"><span>{t('pay_qarz')}</span><span>{num(inv.qarz_amount)}</span></div>}
            <hr />
            <div style={{ textAlign: 'center' }}>{t('thank_you')}</div>
          </div>
        </div>
      )}
    </Modal>
  );
}
