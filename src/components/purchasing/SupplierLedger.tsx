import { useState } from 'react';
import { Plus, RefreshCw, Truck } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { api } from '../../lib/api';
import { fmtDateTime, iqd, parseNum } from '../../lib/format';
import { Empty, Field, Modal, PageTitle, Skeleton, Tabs, useAction, useLoad } from '../common/ui';
import { SupplierModal } from './ReceiveInvoice';

export default function SupplierLedger() {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const suppliers = useLoad(() => api.get('/suppliers'), []);
  const [sel, setSel] = useState<any>(null);
  const [tab, setTab] = useState<'history' | 'statement'>('statement');
  const [add, setAdd] = useState(false);
  const [pay, setPay] = useState<null | 'payment' | 'old_invoice'>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const st = useLoad(() => (sel ? api.get(`/suppliers/${sel.id}/statement`) : Promise.resolve(null)), [sel?.id]);
  const typeKey: Record<string, string> = { purchase: 'tx_purchase', payment: 'tx_payment', old_invoice: 'tx_old_invoice', rtv: 'tx_rtv' };

  const refreshAll = () => { suppliers.reload(); st.reload(); };
  const submit = async () => {
    const r = await run(() => api.post(`/suppliers/${sel.id}/payments`, { amount: parseNum(amount), kind: pay, note }), t('saved'));
    if (r) { setPay(null); setAmount(''); setNote(''); refreshAll(); }
  };
  const current = (suppliers.data ?? []).find((s: any) => s.id === sel?.id);

  return (
    <div className="max-w-6xl mx-auto">
      <PageTitle icon={<Truck className="text-blue-600" />} title={t('nav_supplier')} subtitle={t('supplier_sub')} />
      <div className="grid lg:grid-cols-[280px_1fr] gap-4">
        <div className="card !p-3">
          <button className="btn-primary w-full mb-2" onClick={() => setAdd(true)}><Plus size={16} />{t('add_supplier')}</button>
          {suppliers.loading ? <Skeleton rows={4} /> : (suppliers.data ?? []).length === 0 ? <Empty text={t('no_suppliers')} /> : (
            <ul>{suppliers.data.map((s: any) => (
              <li key={s.id}><button onClick={() => setSel(s)} className={`w-full text-start px-3 py-2 rounded-lg mb-1 ${sel?.id === s.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-slate-50'}`}>
                <div className="font-bold text-sm">{s.name}</div><div className={`text-xs font-bold ${s.balance > 0 ? 'text-red-600' : 'text-slate-400'}`}>{iqd(s.balance)}</div></button></li>))}</ul>
          )}
        </div>
        <div>
          {!sel ? <div className="card"><Empty icon={<Truck size={36} />} text={t('select_supplier')} /></div> : (
            <>
              <div className="card mb-4 flex flex-wrap items-center justify-between gap-3">
                <div><div className="text-lg font-extrabold uppercase">{sel.name}</div><div className="card-title mt-1">{t('balance_due')}</div>
                  <div className={`text-2xl font-extrabold ${(current?.balance ?? 0) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{iqd(current?.balance ?? 0)}</div></div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-green" onClick={() => setPay('payment')}>{t('record_payment_company')}</button>
                  <button className="btn-ghost" onClick={() => setPay('old_invoice')}>{t('record_old_invoice')}</button>
                  <button className="btn-ghost" onClick={async () => { await api.post(`/suppliers/${sel.id}/sync`); refreshAll(); }}><RefreshCw size={16} />{t('recalculate')}</button>
                </div>
              </div>
              <div className="mb-3"><Tabs value={tab} onChange={setTab} items={[{ id: 'history', label: t('purchase_history') }, { id: 'statement', label: t('statement') }]} /></div>
              <div className="card !p-0 overflow-x-auto">
                {st.loading || !st.data ? <div className="p-4"><Skeleton /></div> : tab === 'statement' ? (
                  st.data.rows.length === 0 ? <Empty text={t('no_transactions')} /> : (
                    <table className="w-full"><thead><tr><th className="th">{t('date')}</th><th className="th">{t('transaction_type')}</th><th className="th">{t('reference')}</th><th className="th">{t('debit_debt_up')}</th><th className="th">{t('credit_debt_down')}</th><th className="th">{t('running_balance')}</th></tr></thead>
                      <tbody>{st.data.rows.map((r: any, i: number) => (<tr key={i}><td className="td">{fmtDateTime(r.date)}</td><td className="td">{t(typeKey[r.type])}</td><td className="td">{r.ref}</td>
                        <td className="td text-red-600 font-bold">{r.debit ? iqd(r.debit) : ''}</td><td className="td text-emerald-600 font-bold">{r.credit ? iqd(r.credit) : ''}</td><td className="td font-extrabold">{iqd(r.balance)}</td></tr>))}</tbody></table>)
                ) : (
                  st.data.purchases.length === 0 ? <Empty text={t('no_transactions')} /> : (
                    <table className="w-full"><thead><tr><th className="th">{t('date')}</th><th className="th">{t('invoice_number')}</th><th className="th">{t('payment_type')}</th><th className="th">{t('total')}</th></tr></thead>
                      <tbody>{st.data.purchases.map((p: any) => <tr key={p.id}><td className="td">{fmtDateTime(p.approved_at)}</td><td className="td">{p.invoice_number || `#${p.id}`}</td><td className="td">{t(p.payment_type === 'credit' ? 'credit_qarz' : 'cash_naqd')}</td><td className="td font-bold">{iqd(p.total_cost)}</td></tr>)}</tbody></table>)
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {add && <SupplierModal onClose={() => setAdd(false)} onSaved={() => { setAdd(false); suppliers.reload(); }} />}
      {pay && (
        <Modal title={t(pay === 'payment' ? 'record_payment_company' : 'record_old_invoice')} onClose={() => setPay(null)} footer={<><button className="btn-ghost" onClick={() => setPay(null)}>{t('cancel')}</button>
          <button className="btn-primary" disabled={busy || parseNum(amount) <= 0} onClick={submit}>{t('save')}</button></>}>
          <div className="space-y-3"><Field label={t('amount')}><input className="input" autoFocus inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            <Field label={t('note')}><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
        </Modal>
      )}
    </div>
  );
}
