import { useEffect, useState } from 'react';
import { RefreshCw, Search, Undo2 } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { api, qs } from '../../lib/api';
import { fmtDateTime, iqd } from '../../lib/format';
import { Badge, Empty, PageTitle, Skeleton, Tabs, useAction, useDebounced, useLoad } from '../common/ui';

export default function SalesReturns() {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [tab, setTab] = useState<'new' | 'history'>('new');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const list = useLoad(() => api.get(`/invoices?${qs({ q: dq })}`), [dq]);
  const hist = useLoad(() => api.get('/returns'), []);
  const [inv, setInv] = useState<any>(null);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [method, setMethod] = useState<'cash' | 'card' | 'qarz'>('cash');

  const open = async (id: number) => { setInv(await api.get(`/invoices/${id}`)); setQty({}); setMethod('cash'); };
  useEffect(() => { if (inv?.customer_id && inv.payment_method === 'qarz') setMethod('qarz'); }, [inv]);

  const refund = inv ? inv.items.reduce((s: number, i: any) => s + (qty[i.id] || 0) * i.unit_price, 0) * (inv.subtotal ? inv.grand_total / inv.subtotal : 1) : 0;
  const submit = async () => {
    const items = Object.entries(qty).filter(([, q]) => q > 0).map(([id, q]) => ({ invoice_item_id: Number(id), quantity: q }));
    const r = await run(() => api.post('/returns', { invoice_id: inv.id, items, refund_method: method }), t('return_saved'));
    if (r) { await open(inv.id); hist.reload(); }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <PageTitle icon={<Undo2 className="text-blue-600" />} title={t('returns_title')} subtitle={t('returns_sub')}
        right={<Badge tone="green">{t('automated_restock')}</Badge>} />
      <div className="mb-4"><Tabs value={tab} onChange={setTab} items={[{ id: 'new', label: t('process_return') }, { id: 'history', label: `${t('returns_history')} (${hist.data?.length ?? 0})` }]} /></div>

      {tab === 'new' ? (
        <div className="grid lg:grid-cols-[320px_1fr] gap-4">
          <div className="card !p-3">
            <div className="flex gap-2 mb-2">
              <div className="relative flex-1"><Search size={14} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="input !ps-8" placeholder={t('search_invoice')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <button className="btn-ghost !px-2" onClick={list.reload}><RefreshCw size={16} /></button>
            </div>
            {list.loading ? <Skeleton rows={5} /> : (
              <ul className="divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
                {(list.data ?? []).map((i: any) => (
                  <li key={i.id}><button onClick={() => open(i.id)} className={`w-full text-start py-2 px-2 rounded-lg ${inv?.id === i.id ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                    <div className="flex justify-between text-sm font-bold"><span>{i.invoice_number}</span><span>{iqd(i.grand_total)}</span></div>
                    <div className="text-xs text-slate-500">{fmtDateTime(i.created_at)} • {i.customer_name ?? t('walk_in')}</div></button></li>
                ))}
              </ul>
            )}
          </div>
          <div className="card">
            {!inv ? <Empty icon={<Undo2 size={36} />} text={t('select_invoice_left')} /> : (
              <>
                <div className="flex justify-between mb-3"><h3 className="font-extrabold">{inv.invoice_number}</h3><span className="text-sm text-slate-500">{fmtDateTime(inv.created_at)}</span></div>
                <table className="w-full"><thead><tr><th className="th">{t('medicine')}</th><th className="th">{t('batch')}</th><th className="th">{t('price')}</th><th className="th">{t('sold')}</th><th className="th">{t('returned')}</th><th className="th w-28">{t('return_qty')}</th></tr></thead>
                  <tbody>{inv.items.map((i: any) => {
                    const left = i.quantity - i.returned_qty;
                    return (<tr key={i.id}><td className="td font-bold">{i.brand_name} {i.dosage}</td><td className="td">{i.batch_number}</td><td className="td">{iqd(i.unit_price)}</td>
                      <td className="td">{i.quantity}</td><td className="td">{i.returned_qty}</td>
                      <td className="td"><input type="number" min={0} max={left} disabled={left === 0} className="input !py-1" value={qty[i.id] ?? ''}
                        onChange={(e) => setQty({ ...qty, [i.id]: Math.max(0, Math.min(left, Number(e.target.value) || 0)) })} /></td></tr>);
                  })}</tbody></table>
                <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
                  <div className="flex gap-2">
                    {(['cash', 'card', 'qarz'] as const).map((m) => (
                      <button key={m} disabled={m === 'qarz' && !inv.customer_id} onClick={() => setMethod(m)}
                        className={`btn !py-1.5 ${method === m ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'}`}>{t(m === 'qarz' ? 'refund_reduce_qarz' : m === 'cash' ? 'pay_cash' : 'pay_card')}</button>
                    ))}
                  </div>
                  <div className="text-end"><div className="card-title">{t('refund_total')}</div><div className="text-2xl font-extrabold text-blue-600">{iqd(refund)}</div></div>
                </div>
                <button className="btn-primary mt-4" disabled={busy || refund <= 0} onClick={submit}><Undo2 size={16} />{t('process_return')}</button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="card !p-0 overflow-x-auto">
          {hist.loading ? <div className="p-4"><Skeleton /></div> : !(hist.data?.length) ? <Empty text={t('no_returns')} /> : (
            <table className="w-full"><thead><tr><th className="th">{t('date')}</th><th className="th">{t('invoice')}</th><th className="th">{t('refund_method')}</th><th className="th">{t('user')}</th><th className="th">{t('total')}</th></tr></thead>
              <tbody>{hist.data.map((r: any) => <tr key={r.id}><td className="td">{fmtDateTime(r.created_at)}</td><td className="td font-bold">{r.invoice_number}</td>
                <td className="td">{t(r.refund_method === 'qarz' ? 'refund_reduce_qarz' : r.refund_method === 'cash' ? 'pay_cash' : 'pay_card')}</td><td className="td">{r.user_name}</td><td className="td font-bold">{iqd(r.total)}</td></tr>)}</tbody></table>
          )}
        </div>
      )}
    </div>
  );
}
