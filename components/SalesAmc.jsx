'use client';

// components/SalesAmc.jsx — Sales → AMC tab (Sales Mantra parity, SYSTEM.md §5dr): AMC contracts with value,
// received, days committed / left, visits and profit, plus the "Preventive maintenance due" list.
// Built on the existing service_contracts table (Service department still sees the same contracts); all maths in lib/amc.mjs.
import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import CustomerPicker from '@/components/CustomerPicker';
import { PlusIcon, ChevronDownIcon, ChevronRightIcon, Trash2Icon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { formatMoney, formatDate } from '@/lib/format';
import { todayISO } from '@/lib/date';

const STATUS_CLS = { active: 'bg-success/10 text-success', expired: 'bg-warning/10 text-warning', renewed: 'bg-info/10 text-info', cancelled: 'bg-muted text-muted-foreground' };
const FREQ = ['Monthly', 'Quarterly', 'Half-yearly', 'Yearly'];

function ContractDialog({ renewing, onClose, onSaved }) {
  const [f, setF] = useState(renewing
    ? { customer_name: renewing.customer, start_date: renewing.end_date || todayISO(), end_date: '', contract_value: renewing.contract_value ?? '' }
    : { customer_id: '', customer_name: '', project_id: '', start_date: todayISO(), end_date: '', visit_frequency: 'Quarterly', entitlement: '', contract_value: '', received_value: '', service_engineer: '' });
  const [projects, setProjects] = useState([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!renewing) api('/api/projects').then(r => setProjects(r.projects || [])).catch(() => {}); }, [renewing]);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  async function save() {
    setSaving(true);
    try {
      const r = renewing
        ? await api(`/api/amc/${renewing.id}`, { method: 'PATCH', body: { action: 'renew', ...f } })
        : await api('/api/amc', { method: 'POST', body: f });
      showToast(`SVC-${r.contract_no} created`); onSaved(); onClose();
    } catch (e) { showToast(e.message, 'error'); } finally { setSaving(false); }
  }
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>{renewing ? `Renew SVC-${renewing.contract_no}` : 'New AMC contract'}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {!renewing && <>
            <div className="col-span-2 grid gap-1.5"><Label>Customer *</Label>
              <CustomerPicker value={f.customer_id} name={f.customer_name} onChange={(id, name) => setF(p => ({ ...p, customer_id: id, customer_name: name }))} /></div>
            <div className="col-span-2 grid gap-1.5"><Label>Equipment / project (so visits can be scheduled)</Label>
              <Select value={f.project_id || '_none'} onValueChange={v => set('project_id', v === '_none' ? '' : v)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="_none">Not linked</SelectItem>{projects.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.project_no} · {p.customer_name}</SelectItem>)}</SelectContent>
              </Select></div>
          </>}
          <div className="grid gap-1.5"><Label>Start date *</Label><Input type="date" value={f.start_date} onChange={e => set('start_date', e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>End date *</Label><Input type="date" value={f.end_date} onChange={e => set('end_date', e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>Contract value (₹)</Label><Input type="number" min="0" value={f.contract_value} onChange={e => set('contract_value', e.target.value)} /></div>
          {!renewing && <>
            <div className="grid gap-1.5"><Label>Received so far (₹)</Label><Input type="number" min="0" value={f.received_value} onChange={e => set('received_value', e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Preventive maintenance every</Label>
              <Select value={f.visit_frequency || '_none'} onValueChange={v => set('visit_frequency', v === '_none' ? '' : v)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="_none">No schedule</SelectItem>{FREQ.map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="col-span-2 grid gap-1.5"><Label>Service engineer (looks after this AMC)</Label><Input value={f.service_engineer} onChange={e => set('service_engineer', e.target.value)} placeholder="Name" /></div>
            <div className="col-span-2 grid gap-1.5"><Label>What is covered</Label><Textarea value={f.entitlement} onChange={e => set('entitlement', e.target.value)} placeholder="Visits included, parts, response time…" /></div>
          </>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : renewing ? 'Renew' : 'Create contract'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContractRow({ c, open, onToggle }) {
  const s = c.summary;
  return (
    <TableRow className={`cursor-pointer ${open ? 'bg-muted/40' : ''}`} onClick={onToggle}>
      <TableCell className="font-medium"><span className="inline-flex items-center gap-1">{open ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}SVC-{c.contract_no}</span></TableCell>
      <TableCell>{c.customer || '—'}{c.project_no ? <span className="block text-xs text-muted-foreground">{c.project_no}</span> : null}</TableCell>
      <TableCell><Badge className={STATUS_CLS[c.status]}>{c.status}</Badge>{s.expiringSoon ? <Badge variant="destructive" className="ml-1">Expiring soon</Badge> : null}</TableCell>
      <TableCell className="min-w-40">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-chart-1" style={{ width: `${Math.min(100, s.pctElapsed ?? 0)}%` }} /></div>
        <span className="text-xs text-muted-foreground">{s.committed ?? '—'} days committed · {s.left == null ? '—' : s.left < 0 ? 'ended' : `${s.left} left`}</span>
      </TableCell>
      <TableCell className="tnum">{s.visitsDone}/{s.visitsPlanned}</TableCell>
      <TableCell className="tnum">{formatMoney(s.value)}</TableCell>
      <TableCell className="tnum">{formatMoney(s.received)}</TableCell>
      <TableCell className="tnum">{formatMoney(s.cost)}</TableCell>
      <TableCell className={`tnum font-medium ${s.profit < 0 ? 'text-destructive' : ''}`}>{s.received || s.cost ? formatMoney(s.profit) : '—'}</TableCell>
    </TableRow>
  );
}

// The open contract's details sit in their own card under the table (a wide table would otherwise squeeze them).
function ContractDetail({ c, reload, onClose }) {
  const [renewing, setRenewing] = useState(false);
  const [cost, setCost] = useState({ cost_date: todayISO(), description: '', amount: '' });
  const [rec, setRec] = useState(c.received_value ?? '');
  const [engineer, setEngineer] = useState(c.service_engineer || '');
  const [receipt, setReceipt] = useState({ receipt_date: todayISO(), amount: '', received_by: '', note: '' });
  useEffect(() => { setRec(c.received_value ?? ''); setEngineer(c.service_engineer || ''); }, [c.id, c.received_value, c.service_engineer]);
  const logged = (c.receipts || []).reduce((t, r) => t + r.amount, 0);
  const undated = Math.max(0, (Number(c.received_value) || 0) - logged);
  const act = async (body, msg) => { try { await api(`/api/amc/${c.id}`, { method: 'PATCH', body }); if (msg) showToast(msg); reload(); return true; } catch (e) { showToast(e.message, 'error'); return false; } };
  return (
    <Card>
      <CardHeader><CardTitle>SVC-{c.contract_no} · {c.customer}</CardTitle><CardAction><Button size="sm" variant="ghost" onClick={onClose}>Close</Button></CardAction></CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium">Value received (total)</div>
          <div className="flex items-center gap-2"><Input className="h-8 w-40" type="number" min="0" value={rec} onChange={e => setRec(e.target.value)} />
            <Button size="sm" variant="outline" onClick={() => act({ received_value: rec }, 'Saved')}>Save</Button></div>
          <div className="flex items-center gap-2 pt-1"><span className="shrink-0 text-sm font-medium">Service engineer</span>
            <Input className="h-8 w-44" value={engineer} onChange={e => setEngineer(e.target.value)} placeholder="Name" />
            <Button size="sm" variant="outline" disabled={engineer === (c.service_engineer || '')} onClick={() => act({ service_engineer: engineer }, 'Saved')}>Save</Button></div>
          <div className="pt-2 text-sm font-medium">Receipts</div>
          {(c.receipts || []).length === 0 && <p className="text-xs text-muted-foreground">No dated receipts yet.</p>}
          {(c.receipts || []).map(r => (
            <div key={r.id} className="flex items-center gap-2 text-sm"><span className="w-24 shrink-0 text-muted-foreground">{formatDate(r.receipt_date)}</span>
              <span className="min-w-0 flex-1 truncate">{[r.received_by, r.note].filter(Boolean).join(' · ') || '—'}</span><span className="tnum">{formatMoney(r.amount)}</span>
              <Button size="icon" variant="ghost" className="size-7" aria-label="Delete receipt" onClick={() => confirm('Remove this receipt? The received total goes down by the same amount.') && act({ action: 'delete_receipt', receipt_id: r.id })}><Trash2Icon /></Button></div>
          ))}
          {undated > 0 && <p className="text-xs text-muted-foreground">{formatMoney(undated)} of the received total has no date recorded (entered before receipts were logged).</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" className="h-8 w-36" value={receipt.receipt_date} onChange={e => setReceipt({ ...receipt, receipt_date: e.target.value })} />
            <Input className="h-8 w-28" type="number" min="0" placeholder="Amount" value={receipt.amount} onChange={e => setReceipt({ ...receipt, amount: e.target.value })} />
            <Input className="h-8 w-32" placeholder={engineer || 'Received by'} value={receipt.received_by} onChange={e => setReceipt({ ...receipt, received_by: e.target.value })} />
            <Button size="sm" onClick={async () => { if (await act({ action: 'add_receipt', ...receipt }, 'Receipt added')) setReceipt({ ...receipt, amount: '', received_by: '', note: '' }); }}>Add receipt</Button>
          </div>
          {c.entitlement && <p className="text-xs text-muted-foreground">Covers: {c.entitlement}</p>}
          {c.visit_frequency && <p className="text-xs text-muted-foreground">Preventive maintenance: {c.visit_frequency}</p>}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {c.project_id && c.status === 'active' && <ScheduleVisit act={act} />}
            {(c.status === 'active' || c.status === 'expired') && <Button size="sm" variant="outline" onClick={() => setRenewing(true)}>Renew</Button>}
            {c.status === 'active' && <Button size="sm" variant="outline" onClick={() => confirm('Cancel this contract?') && act({ action: 'cancel' })}>Cancel contract</Button>}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium">Cost booked against this contract</div>
          {c.costs.length === 0 && <p className="text-xs text-muted-foreground">No cost entered yet.</p>}
          {c.costs.map(k => (
            <div key={k.id} className="flex items-center gap-2 text-sm"><span className="w-24 shrink-0 text-muted-foreground">{formatDate(k.cost_date)}</span><span className="min-w-0 flex-1 truncate">{k.description || '—'}</span><span className="tnum">{formatMoney(k.amount)}</span>
              <Button size="icon" variant="ghost" className="size-7" onClick={() => act({ action: 'delete_cost', cost_id: k.id })}><Trash2Icon /></Button></div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" className="h-8 w-36" value={cost.cost_date} onChange={e => setCost({ ...cost, cost_date: e.target.value })} />
            <Input className="h-8 w-40" placeholder="What for" value={cost.description} onChange={e => setCost({ ...cost, description: e.target.value })} />
            <Input className="h-8 w-28" type="number" min="0" placeholder="Amount" value={cost.amount} onChange={e => setCost({ ...cost, amount: e.target.value })} />
            <Button size="sm" onClick={async () => { if (await act({ action: 'add_cost', ...cost })) setCost({ ...cost, description: '', amount: '' }); }}>Add</Button>
          </div>
        </div>
      </CardContent>
      {renewing && <ContractDialog renewing={c} onClose={() => setRenewing(false)} onSaved={reload} />}
    </Card>
  );
}

function ScheduleVisit({ act }) {
  const [d, setD] = useState(todayISO());
  return (
    <span className="inline-flex items-center gap-1.5">
      <Input type="date" className="h-8 w-36" value={d} onChange={e => setD(e.target.value)} />
      <Button size="sm" variant="outline" onClick={() => act({ action: 'schedule_pm', visit_date: d }, 'Visit scheduled — it shows on the Home calendar')}>Schedule PM visit</Button>
    </span>
  );
}

export function AmcTab() {
  const [data, setData] = useState(null);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState(null);
  const load = useCallback(() => { api('/api/amc').then(setData).catch(e => { showToast(e.message, 'error'); setData({ contracts: [], pm: [] }); }); }, []);
  useEffect(load, [load]);

  const contracts = data?.contracts || [];
  const active = contracts.filter(c => c.status === 'active');
  const tot = active.reduce((t, c) => ({ v: t.v + c.summary.value, r: t.r + c.summary.received, k: t.k + c.summary.cost }), { v: 0, r: 0, k: 0 });
  const pmAct = async (p, due) => {
    const c = contracts.find(x => `SVC-${x.contract_no}` === p.ref);
    try { await api(`/api/amc/${c.id}`, { method: 'PATCH', body: { action: 'schedule_pm', visit_date: due } }); showToast('Visit scheduled — it shows on the Home calendar'); load(); } catch (e) { showToast(e.message, 'error'); }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[['Active contracts', active.length], ['Contract value', formatMoney(tot.v)], ['Received', formatMoney(tot.r)], ['Profit so far', formatMoney(tot.r - tot.k)]].map(([l, v]) => (
          <div key={l} className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{l}</div><div className="text-lg font-semibold tnum">{v}</div></div>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle>Preventive maintenance due</CardTitle></CardHeader>
        <CardContent>
          {data === null ? <p className="text-sm text-muted-foreground">Loading…</p> : data.pm.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing due. Visits appear here from active AMC contracts with a maintenance schedule and from items still under warranty that have one.</p>
          ) : (
            <Table>
              <TableHeader><TableRow>{['Due', 'Customer', 'What', 'Every', 'Source', ''].map(h => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {data.pm.slice(0, 100).map((p, i) => (
                  <TableRow key={i}>
                    <TableCell><Badge variant={p.status === 'overdue' ? 'destructive' : p.status === 'due_soon' ? 'secondary' : 'outline'}>{formatDate(p.due)}</Badge>
                      <span className="ml-2 text-xs text-muted-foreground">{p.days < 0 ? `${-p.days} days late` : p.days === 0 ? 'today' : `in ${p.days} days`}</span></TableCell>
                    <TableCell>{p.customer || '—'}<span className="block text-xs text-muted-foreground">{p.project_no}</span></TableCell>
                    <TableCell className="max-w-64 truncate">{p.item}</TableCell>
                    <TableCell>{p.every}</TableCell>
                    <TableCell><Badge variant="outline">{p.source} {p.ref}</Badge></TableCell>
                    <TableCell>{p.source === 'AMC' && <Button size="sm" variant="outline" onClick={() => pmAct(p, p.due)}>Schedule visit</Button>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>AMC contracts</CardTitle><CardAction><Button size="sm" onClick={() => setAdding(true)}><PlusIcon />New contract</Button></CardAction></CardHeader>
        <CardContent>
          {data !== null && contracts.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No AMC contracts yet.</p> : (
            <Table>
              <TableHeader><TableRow>{['Contract', 'Customer', 'Status', 'Days committed / left', 'Visits', 'Value', 'Received', 'Cost', 'Profit'].map(h => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader>
              <TableBody>{contracts.map(c => <ContractRow key={c.id} c={c} open={openId === c.id} onToggle={() => setOpenId(openId === c.id ? null : c.id)} />)}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {contracts.find(c => c.id === openId) && <ContractDetail c={contracts.find(c => c.id === openId)} reload={load} onClose={() => setOpenId(null)} />}
      {adding && <ContractDialog onClose={() => setAdding(false)} onSaved={load} />}
    </div>
  );
}
