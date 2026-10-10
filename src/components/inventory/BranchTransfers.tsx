import { useEffect, useState } from 'react';
import { Building2, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { useAuth } from '../../lib/auth';
import { api, qs } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Badge, Empty, Field, Modal, PageTitle, Skeleton, Tabs, useAction, useDebounced, useLoad } from '../common/ui';

export default function BranchTransfers() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { run } = useAction();
  const [tab, setTab] = useState<'in' | 'out'>('in');
  const [creating, setCreating] = useState(false);
  const { data, loading, reload } = useLoad(() => api.get('/transfers'), []);
  const branches = useLoad(() => api.get('/branches'), []);
  const mine = user?.branch_id;
  const rows = (data ?? []).filter((x: any) => (tab === 'in' ? x.to_branch === mine : x.from_branch === mine));
  const tone: any = { pending: 'amber', approved: 'blue', received: 'green', rejected: 'red' };
  const act = async (id: number, a: string) => { await run(() => api.post(`/transfers/${id}/${a}`), t('saved')); reload(); };

  return (
    <div className="max-w-5xl mx-auto">
      <PageTitle icon={<Building2 className="text-emerald-500" />} title={t('transfers_title')} subtitle={t('transfers_sub')}
        right={<><Tabs value={tab} onChange={setTab} items={[{ id: 'in', label: t('incoming') }, { id: 'out', label: t('outgoing') }]} />
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} />{t('new_transfer')}</button></>} />
      <div className="space-y-3">
        {loading ? <Skeleton rows={4} /> : rows.length === 0 ? <div className="card"><Empty text={t('no_transfers')} /></div> : rows.map((x: any) => (
          <div key={x.id} className="card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-extrabold">#{x.id} • {x.from_name} → {x.to_name}</div>
              <div className="flex items-center gap-2"><Badge tone={tone[x.status]}>{t('tr_' + x.status)}</Badge><span className="text-xs text-slate-500">{fmtDateTime(x.created_at)}</span></div>
            </div>
            <ul className="text-sm text-slate-600 my-2">{x.items.map((i: any) => <li key={i.id}>• {i.brand_name} ({t('batch')} {i.batch_number}) × {i.quantity}</li>)}</ul>
            <div className="flex gap-2">
              {x.status === 'pending' && x.from_branch === mine && <><button className="btn-primary !py-1" onClick={() => act(x.id, 'approve')}>{t('approve')}</button><button className="btn-ghost !py-1" onClick={() => act(x.id, 'reject')}>{t('reject')}</button></>}
              {x.status === 'approved' && x.to_branch === mine && <button className="btn-green !py-1" onClick={() => act(x.id, 'receive')}>{t('mark_received')}</button>}
            </div>
          </div>
        ))}
      </div>
      {creating && branches.data && <NewTransfer branches={branches.data} mine={mine!} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />}
    </div>
  );
}

function NewTransfer({ branches, mine, onClose, onSaved }: { branches: any[]; mine: number; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [from, setFrom] = useState(mine);
  const [to, setTo] = useState(branches.find((b) => b.id !== mine)?.id ?? 0);
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [found, setFound] = useState<any[]>([]);
  const [items, setItems] = useState<{ batch: any; quantity: number }[]>([]);
  useEffect(() => { api.get(`/branch-batches/${from}?${qs({ q: dq })}`).then(setFound).catch(() => {}); }, [from, dq]);
  const save = async () => {
    const r = await run(() => api.post('/transfers', { from_branch: from, to_branch: to, items: items.map((i) => ({ batch_id: i.batch.id, quantity: i.quantity })) }), t('saved'));
    if (r) onSaved();
  };
  return (
    <Modal wide title={t('new_transfer')} onClose={onClose} footer={<><button className="btn-ghost" onClick={onClose}>{t('cancel')}</button>
      <button className="btn-primary" disabled={busy || !items.length || from === to} onClick={save}>{t('save')}</button></>}>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <Field label={t('from_branch')}><select className="input" value={from} onChange={(e) => { setFrom(Number(e.target.value)); setItems([]); }}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label={t('to_branch')}><select className="input" value={to} onChange={(e) => setTo(Number(e.target.value))}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
      </div>
      <Field label={t('search_medicine')}><input className="input" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
      <ul className="divide-y divide-slate-100 max-h-40 overflow-y-auto my-2">
        {found.map((b) => <li key={b.id}><button className="w-full text-start py-1.5 text-sm hover:bg-slate-50 px-2" onClick={() => !items.find((i) => i.batch.id === b.id) && setItems([...items, { batch: b, quantity: 1 }])}>
          <b>{b.brand_name} {b.dosage}</b> <span className="text-xs text-slate-500">{t('batch')} {b.batch_number} • {b.expiry_date} • {b.quantity}</span></button></li>)}
      </ul>
      {items.map((i, idx) => (
        <div key={i.batch.id} className="flex items-center gap-2 py-1 text-sm">
          <span className="flex-1">{i.batch.brand_name} ({i.batch.batch_number})</span>
          <input type="number" min={1} max={i.batch.quantity} className="input !w-24 !py-1" value={i.quantity}
            onChange={(e) => setItems(items.map((x, k) => (k === idx ? { ...x, quantity: Math.max(1, Math.min(i.batch.quantity, Number(e.target.value) || 1)) } : x)))} />
          <button className="text-slate-400 hover:text-red-600" onClick={() => setItems(items.filter((_, k) => k !== idx))}><Trash2 size={16} /></button>
        </div>
      ))}
    </Modal>
  );
}
