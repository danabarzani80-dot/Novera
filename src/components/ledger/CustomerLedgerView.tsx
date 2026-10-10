import { useState } from 'react';
import { Plus, Printer, Search, Users } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { useAuth } from '../../lib/auth';
import { api, qs } from '../../lib/api';
import { fmtDateTime, iqd, parseNum } from '../../lib/format';
import { Badge, Empty, Field, Modal, PageTitle, Skeleton, useAction, useDebounced, useLoad } from '../common/ui';

export default function CustomerLedgerView() {
  const { t } = useI18n();
  const { pharmacyName } = useAuth();
  const { run, busy } = useAction();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const list = useLoad(() => api.get(`/customers?${qs({ q: dq })}`), [dq]);
  const [selId, setSelId] = useState<number | null>(null);
  const detail = useLoad(() => (selId ? api.get(`/customers/${selId}`) : Promise.resolve(null)), [selId]);
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);
  const [f, setF] = useState({ name: '', phone: '', notes: '' });
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const typeKey: Record<string, string> = { sale: 'tx_sale_qarz', payment: 'tx_payment_in', return: 'tx_return' };

  const addCustomer = async () => {
    const r = await run(() => api.post('/customers', f), t('saved'));
    if (r) { setAdding(false); setF({ name: '', phone: '', notes: '' }); list.reload(); setSelId(r.id); }
  };
  const pay = async () => {
    const amt = parseNum(amount);
    const r = await run(() => api.post(`/customers/${selId}/payments`, { amount: amt, method, note }), t('saved'));
    if (r) { setReceipt({ amount: amt, balance: r.balance, name: detail.data.customer.name, date: new Date().toISOString(), id: r.id }); setPaying(false); setAmount(''); setNote(''); list.reload(); detail.reload(); }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <PageTitle icon={<Users className="text-amber-500" />} title={t('nav_customers')} subtitle={t('customers_sub')}
        right={<button className="btn-primary" onClick={() => setAdding(true)}><Plus size={16} />{t('add_customer')}</button>} />
      <div className="grid lg:grid-cols-[320px_1fr] gap-4">
        <div className="card !p-3">
          <div className="relative mb-2"><Search size={14} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-400" /><input className="input !ps-8" placeholder={t('search_customer')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {list.loading ? <Skeleton rows={5} /> : (list.data ?? []).length === 0 ? <Empty text={t('no_customers')} /> : (
            <ul className="max-h-[65vh] overflow-y-auto">{list.data.map((c: any) => (
              <li key={c.id}><button onClick={() => setSelId(c.id)} className={`w-full text-start px-3 py-2 rounded-lg mb-1 ${selId === c.id ? 'bg-blue-50 border border-blue-200' : c.overdue ? 'bg-red-50' : 'hover:bg-slate-50'}`}>
                <div className="flex justify-between"><span className="font-bold text-sm">{c.name}</span>{c.overdue && <Badge tone="red">{t('overdue')}</Badge>}</div>
                <div className="flex justify-between text-xs text-slate-500"><span>{c.phone}</span><span className={`font-bold ${c.balance > 0 ? 'text-orange-600' : ''}`}>{iqd(c.balance)}</span></div>
                <div className="text-[11px] text-slate-400">{t('last_payment')}: {c.last_payment ? fmtDateTime(c.last_payment) : '—'}</div></button></li>))}</ul>
          )}
        </div>
        <div>
          {!selId ? <div className="card"><Empty icon={<Users size={36} />} text={t('select_customer_left')} /></div> : detail.loading || !detail.data ? <Skeleton rows={6} /> : (
            <>
              <div className="card mb-4 flex flex-wrap items-center justify-between gap-3">
                <div><div className="text-lg font-extrabold">{detail.data.customer.name}</div><div className="text-sm text-slate-500">{detail.data.customer.phone}</div>
                  <div className="card-title mt-2">{t('total_qarz')}</div><div className={`text-2xl font-extrabold ${detail.data.balance > 0 ? 'text-orange-600' : 'text-emerald-600'}`}>{iqd(detail.data.balance)}</div></div>
                <button className="btn-green" disabled={detail.data.balance <= 0} onClick={() => setPaying(true)}>{t('record_payment')}</button>
              </div>
              <div className="card !p-0 overflow-x-auto">
                {detail.data.rows.length === 0 ? <Empty text={t('no_transactions')} /> : (
                  <table className="w-full"><thead><tr><th className="th">{t('date')}</th><th className="th">{t('transaction_type')}</th><th className="th">{t('reference')}</th><th className="th">{t('debit_debt_up')}</th><th className="th">{t('credit_debt_down')}</th><th className="th">{t('running_balance')}</th></tr></thead>
                    <tbody>{detail.data.rows.map((r: any, i: number) => (<tr key={i}><td className="td">{fmtDateTime(r.date)}</td><td className="td">{t(typeKey[r.type])}</td><td className="td">{r.ref}</td>
                      <td className="td text-red-600 font-bold">{r.debit ? iqd(r.debit) : ''}</td><td className="td text-emerald-600 font-bold">{r.credit ? iqd(r.credit) : ''}</td><td className="td font-extrabold">{iqd(r.balance)}</td></tr>))}</tbody></table>)}
              </div>
            </>
          )}
        </div>
      </div>

      {adding && <Modal title={t('add_customer')} onClose={() => setAdding(false)} footer={<><button className="btn-ghost" onClick={() => setAdding(false)}>{t('cancel')}</button><button className="btn-primary" disabled={busy || !f.name.trim()} onClick={addCustomer}>{t('save')}</button></>}>
        <div className="space-y-3"><Field label={t('name')}><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={t('phone')}><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label={t('note')}><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div></Modal>}

      {paying && detail.data && <Modal title={t('record_payment')} onClose={() => setPaying(false)} footer={<><button className="btn-ghost" onClick={() => setPaying(false)}>{t('cancel')}</button>
        <button className="btn-green" disabled={busy || parseNum(amount) <= 0 || parseNum(amount) > detail.data.balance} onClick={pay}>{t('save')}</button></>}>
        <div className="space-y-3"><p className="text-sm text-slate-500">{t('total_qarz')}: <b>{iqd(detail.data.balance)}</b></p>
          <Field label={t('amount')}><input className="input" autoFocus inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label={t('payment_method')}><select className="input" value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash">{t('pay_cash')}</option><option value="card">{t('pay_card')}</option></select></Field>
          <Field label={t('note')}><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field></div></Modal>}

      {receipt && <Modal title={t('payment_receipt')} onClose={() => setReceipt(null)} footer={<><button className="btn-ghost" onClick={() => setReceipt(null)}>{t('close')}</button><button className="btn-primary" onClick={() => window.print()}><Printer size={16} />{t('print')}</button></>}>
        <div className="flex justify-center"><div className="receipt print-area border border-slate-200" dir="auto">
          <div style={{ textAlign: 'center', fontWeight: 700 }}>{pharmacyName}</div><div style={{ textAlign: 'center' }}>{t('payment_receipt')} PAY-{receipt.id}</div><div style={{ textAlign: 'center' }}>{fmtDateTime(receipt.date)}</div><hr />
          <div className="row"><span>{t('customer')}</span><span>{receipt.name}</span></div>
          <div className="row" style={{ fontWeight: 700 }}><span>{t('amount')}</span><span>{iqd(receipt.amount)}</span></div>
          <div className="row"><span>{t('remaining_balance')}</span><span>{iqd(receipt.balance)}</span></div><hr /><div style={{ textAlign: 'center' }}>{t('thank_you')}</div></div></div></Modal>}
    </div>
  );
}
