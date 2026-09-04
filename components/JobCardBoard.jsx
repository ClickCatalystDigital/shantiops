'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { EntityCode } from '@/components/EntityRefLink';
import RelatedItemsCard from '@/components/RelatedItemsCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem,
} from '@/components/ui/select';
import { PlusIcon } from 'lucide-react';
import QuickAddInline from '@/components/QuickAddInline';
import { RaiseNcrDialog } from '@/components/NcrPanel';

const COLUMNS = [
  { key: 'pending', label: 'Pending' },
  { key: 'progress', label: 'In progress' },
  { key: 'done', label: 'Done' },
];

// The daily-use board (PRODUCTION-MODULE-DESIGN.md §3.1) — three columns by status, a card per job
// card, click through to a detail sheet for status/qty changes, logging hours, and consumables.
// Project/Work Order filters (2026-08-19) are client-side only — `jobCards` is already the full
// unfiltered list (server component prop), and picking a Work Order derives its project from the
// same list `/api/work-orders` already returns, rather than a second filtered fetch.
export default function JobCardBoard({ jobCards, operations, workstations, projects, workers }) {
  const router = useRouter();
  // Deep-link "click-to-open detail" behavior (Part B) — a JC- reference opens straight to the
  // card's own Sheet on load, same as clicking its tile would, rather than just scrolling to it.
  const highlightCode = useSearchParams().get('highlight');
  const [openCard, setOpenCard] = useState(() => jobCards.find(jc => jc.jc_no === highlightCode)?.id || null);
  const [workOrders, setWorkOrders] = useState([]);
  const [projectFilter, setProjectFilter] = useState('all');
  const [workOrderFilter, setWorkOrderFilter] = useState('all');

  useEffect(() => { api('/api/work-orders').then(setWorkOrders).catch(() => {}); }, []);

  function changeWorkOrderFilter(next) {
    setWorkOrderFilter(next);
    // Selecting a Work Order narrows straight to its own project too, so a head doesn't have to
    // pick both — reuses the project_id already sitting on the fetched Work Order row.
    if (next !== 'all') {
      const wo = workOrders.find(w => String(w.id) === next);
      setProjectFilter(wo?.project_id ? String(wo.project_id) : 'all');
    }
  }

  function changeProjectFilter(next) {
    setProjectFilter(next);
    // A project change that contradicts the current Work Order filter clears it, rather than
    // leaving two filters silently disagreeing about which cards should show.
    const wo = workOrders.find(w => String(w.id) === workOrderFilter);
    if (wo && String(wo.project_id || '') !== next) setWorkOrderFilter('all');
  }

  const filteredCards = jobCards.filter(jc =>
    (projectFilter === 'all' || String(jc.project_id || '') === projectFilter) &&
    (workOrderFilter === 'all' || String(jc.work_order_id || '') === workOrderFilter)
  );
  const byStatus = COLUMNS.reduce((acc, c) => {
    acc[c.key] = filteredCards.filter(j => j.status === c.key);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={projectFilter} onValueChange={changeProjectFilter}>
            <SelectTrigger className="w-52"><SelectValue placeholder="All Projects" /></SelectTrigger>
            <SelectContent><SelectGroup>
              <SelectItem value="all">All Projects</SelectItem>
              {projects.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.project_no} · {p.customer_name}</SelectItem>)}
            </SelectGroup></SelectContent>
          </Select>
          <Select value={workOrderFilter} onValueChange={changeWorkOrderFilter}>
            <SelectTrigger className="w-52"><SelectValue placeholder="All Work Orders" /></SelectTrigger>
            <SelectContent><SelectGroup>
              <SelectItem value="all">All Work Orders</SelectItem>
              {workOrders.map(wo => (
                <SelectItem key={wo.id} value={String(wo.id)}>{wo.wo_no} · {wo.project_no || wo.product_description || 'Stock'}</SelectItem>
              ))}
            </SelectGroup></SelectContent>
          </Select>
        </div>
        <NewJobCardDialog router={router} operations={operations} workstations={workstations} projects={projects} />
      </div>
      {filteredCards.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          {jobCards.length === 0 ? 'No job cards yet — create the first one.' : 'No job cards match this filter.'}
        </CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {COLUMNS.map(col => (
            <div key={col.key} className="flex flex-col gap-2">
              <p className="text-sm font-medium text-muted-foreground">{col.label} · {byStatus[col.key].length}</p>
              <div className="flex flex-col gap-2">
                {byStatus[col.key].map(jc => (
                  <JobCardTile key={jc.id} jc={jc} onOpen={() => setOpenCard(jc.id)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {openCard && (
        <JobCardDetailSheet id={openCard} onClose={() => setOpenCard(null)} router={router} workers={workers} />
      )}
    </div>
  );
}

function JobCardTile({ jc, onOpen }) {
  return (
    <Card data-entity-code={jc.jc_no} className="cursor-pointer transition-colors hover:border-foreground/30" onClick={onOpen}>
      <CardContent className="flex flex-col gap-2 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {jc.project_no || jc.wo_product_description || 'Stock'}{jc.wo_no ? ` · WO ${jc.wo_no}` : ''} · {jc.section}
          </span>
          <div className="flex gap-1">
            {jc.is_site ? <Badge variant="outline">Site</Badge> : null}
            {jc.is_paused ? <Badge variant="outline">Paused</Badge> : null}
            {jc.requires_qc_hold && !jc.qc_released_at ? <Badge className="bg-warning/10 text-warning ring-warning/20">Held for QC</Badge> : null}
          </div>
        </div>
        <span className="text-sm font-medium">{jc.jc_no}{jc.operation_name ? ` · ${jc.operation_name}` : ''}</span>
        <span className="text-xs text-muted-foreground">{jc.workstation_name || '—'}</span>
        <div className="flex items-center gap-2">
          <div className="flex -space-x-1.5">
            {jc.workers.map(w => (
              <span key={w} title={w}
                className="flex h-5 w-5 items-center justify-center rounded-full border border-background bg-accent text-[10px] font-medium text-accent-foreground">
                {w.split(' ').map(p => p[0]).slice(0, 2).join('')}
              </span>
            ))}
          </div>
          <div className="ml-auto text-xs text-muted-foreground tnum">
            {jc.qty_done}/{jc.qty_planned || '?'}{jc.hours_logged ? ` · ${jc.hours_logged}h` : ''}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function NewJobCardDialog({ router, operations: initialOperations, workstations: initialWorkstations, projects }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [operations, setOperations] = useState(initialOperations);
  const [workstations, setWorkstations] = useState(initialWorkstations);
  const empty = {
    project_id: '', milestone_id: '', operation_id: '', workstation_id: '',
    qty_planned: '', planned_start: '', planned_end: '', is_outside: false, outside_vendor: '', is_site: false,
  };
  const [form, setForm] = useState(empty);
  const milestoneOptions = projects.find(p => String(p.id) === form.project_id)?.milestones || [];

  async function submit() {
    if (!form.project_id) return showToast('Project is required', 'error');
    if (!form.milestone_id) return showToast('Milestone is required', 'error');
    setBusy(true);
    try {
      await api('/api/job-cards', {
        method: 'POST',
        body: {
          milestone_id: Number(form.milestone_id),
          operation_id: form.operation_id ? Number(form.operation_id) : null,
          workstation_id: form.workstation_id ? Number(form.workstation_id) : null,
          qty_planned: form.qty_planned ? Number(form.qty_planned) : 0,
          planned_start: form.planned_start || null, planned_end: form.planned_end || null,
          is_outside: form.is_outside, outside_vendor: form.outside_vendor, is_site: form.is_site,
        },
      });
      showToast('Job card created');
      setOpen(false);
      setForm(empty);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><PlusIcon data-icon="inline-start" />New job card</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New job card</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Project</Label>
            <Select value={form.project_id}
              onValueChange={v => setForm({ ...form, project_id: v, milestone_id: '' })}>
              <SelectTrigger><SelectValue placeholder="Select a project" /></SelectTrigger>
              <SelectContent><SelectGroup>
                {projects.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.project_no} · {p.customer_name}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Milestone</Label>
            <Select value={form.milestone_id} disabled={!form.project_id}
              onValueChange={v => setForm({ ...form, milestone_id: v })}>
              <SelectTrigger><SelectValue placeholder={form.project_id ? 'Select a milestone' : 'Pick a project first'} /></SelectTrigger>
              <SelectContent><SelectGroup>
                {milestoneOptions.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.label}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label>Operation</Label>
                <QuickAddInline endpoint="/api/operations" placeholder="New operation name"
                  onAdded={o => { setOperations([...operations, o]); setForm(f => ({ ...f, operation_id: String(o.id) })); }} />
              </div>
              <Select value={form.operation_id} onValueChange={v => setForm({ ...form, operation_id: v })}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent><SelectGroup>
                  {operations.map(o => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
                </SelectGroup></SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label>Workstation</Label>
                <QuickAddInline endpoint="/api/workstations" placeholder="New workstation name"
                  onAdded={w => { setWorkstations([...workstations, w]); setForm(f => ({ ...f, workstation_id: String(w.id) })); }} />
              </div>
              <Select value={form.workstation_id} onValueChange={v => setForm({ ...form, workstation_id: v })}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent><SelectGroup>
                  {workstations.map(w => <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>)}
                </SelectGroup></SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="jc-qty">Qty planned</Label>
              <Input id="jc-qty" type="number" min="0" value={form.qty_planned}
                onChange={e => setForm({ ...form, qty_planned: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="jc-start">Planned start</Label>
              <Input id="jc-start" type="date" value={form.planned_start}
                onChange={e => setForm({ ...form, planned_start: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="jc-end">Planned end</Label>
              <Input id="jc-end" type="date" value={form.planned_end}
                onChange={e => setForm({ ...form, planned_end: e.target.value })} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="jc-outside" checked={form.is_outside}
              onCheckedChange={v => setForm({ ...form, is_outside: !!v })} />
            <Label htmlFor="jc-outside" className="font-normal">Subcontracted / outside</Label>
          </div>
          {form.is_outside && (
            <Input placeholder="Vendor name" value={form.outside_vendor}
              onChange={e => setForm({ ...form, outside_vendor: e.target.value })} />
          )}
          <div className="flex items-center gap-2">
            <Checkbox id="jc-site" checked={form.is_site}
              onCheckedChange={v => setForm({ ...form, is_site: !!v })} />
            <Label htmlFor="jc-site" className="font-normal">At customer site, not the shop</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JobCardDetailSheet({ id, onClose, router, workers }) {
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hoursForm, setHoursForm] = useState({ employee_id: '', minutes: '', fromTime: '', toTime: '' });
  const [consumableForm, setConsumableForm] = useState({ item_name: '', qty: '', unit: '' });
  const [raisingNcr, setRaisingNcr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api(`/api/job-cards/${id}`).then(d => { if (!cancelled) setDetail(d); })
      .catch(err => showToast(err.message, 'error'));
    return () => { cancelled = true; };
  }, [id]);

  async function refresh() {
    setDetail(await api(`/api/job-cards/${id}`));
    router.refresh();
  }

  async function updateField(field, value) {
    setBusy(true);
    try {
      await api(`/api/job-cards/${id}`, { method: 'PATCH', body: { [field]: value } });
      await refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  async function logHours() {
    if (!hoursForm.employee_id) return showToast('Pick a worker', 'error');
    const useClock = hoursForm.fromTime && hoursForm.toTime;
    if (!useClock && !(Number(hoursForm.minutes) > 0)) {
      return showToast('Enter minutes worked, or a start and end time', 'error');
    }
    setBusy(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await api(`/api/job-cards/${id}/time-logs`, {
        method: 'POST',
        body: useClock
          ? { employee_id: Number(hoursForm.employee_id), from_time: `${today}T${hoursForm.fromTime}`, to_time: `${today}T${hoursForm.toTime}` }
          : { employee_id: Number(hoursForm.employee_id), minutes: Number(hoursForm.minutes) },
      });
      setHoursForm({ employee_id: '', minutes: '', fromTime: '', toTime: '' });
      await refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  async function addConsumable() {
    if (!consumableForm.item_name.trim()) return showToast('Item name is required', 'error');
    setBusy(true);
    try {
      await api(`/api/job-cards/${id}/consumables`, { method: 'POST', body: consumableForm });
      setConsumableForm({ item_name: '', qty: '', unit: '' });
      await refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  // §3.5 — a QC fail (or any rejected qty) can spawn a rework card against the same milestone
  // without re-walking the New Job Card form. rework_of_job_card_id carries the lineage.
  async function createRework() {
    setBusy(true);
    try {
      await api('/api/job-cards', {
        method: 'POST',
        body: {
          milestone_id: detail.milestone_id, operation_id: detail.operation_id,
          workstation_id: detail.workstation_id, qty_planned: detail.qty_rejected || detail.qty_planned,
          rework_of_job_card_id: detail.id, notes: `Rework of #${detail.id}`,
        },
      });
      showToast('Rework card created');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Sheet open onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {!detail ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex flex-col gap-5 p-4">
            <SheetHeader className="p-0">
              <SheetTitle>{detail.jc_no} · {detail.operation_name || detail.section}{detail.operation_name ? ` · ${detail.section}` : ''}</SheetTitle>
            </SheetHeader>
            <p className="-mt-3 text-sm text-muted-foreground">
              {detail.project_no ? `${detail.project_no} · ${detail.customer_name}` : (detail.wo_product_description || 'Stock')}
              {detail.wo_no ? ` · WO ${detail.wo_no}` : ''}
              {detail.workstation_name ? ` · ${detail.workstation_name}` : ''}
              {detail.bom_release_revision_at_creation != null && (
                <span className={detail.bomRevisionDrift ? 'text-warning' : ''}>
                  {' · BOM rev '}{detail.bom_release_revision_at_creation}
                  {detail.bomRevisionDrift && ` (master now on rev ${detail.masterBomRevision})`}
                </span>
              )}
            </p>
            <RelatedItemsCard type="job_card" id={detail.id} className="flex flex-col gap-1.5 -mt-2" />

            <div className="flex flex-wrap items-center gap-2">
              <Select value={detail.status} onValueChange={v => updateField('status', v)}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="progress">In progress</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                </SelectGroup></SelectContent>
              </Select>
              {detail.status === 'progress' && (
                <Button size="sm" variant="outline" disabled={busy}
                  onClick={() => updateField('is_paused', detail.is_paused ? 0 : 1)}>
                  {detail.is_paused ? 'Resume' : 'Pause'}
                </Button>
              )}
              {detail.is_outside ? (
                <Badge variant="outline">Outside{detail.outside_vendor ? `: ${detail.outside_vendor}` : ''}</Badge>
              ) : null}
              {detail.is_site ? <Badge variant="outline">Site work</Badge> : null}
              {detail.requires_qc_hold ? (
                detail.qc_released_at
                  ? <Badge variant="outline">QC released</Badge>
                  : <Badge className="bg-warning/10 text-warning ring-warning/20">Held for QC</Badge>
              ) : null}
              <span className="ml-auto flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setRaisingNcr(true)}>Raise NCR</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={createRework}>
                  Create rework card
                </Button>
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <QtyField label="Planned" value={detail.qty_planned} onSave={v => updateField('qty_planned', v)} />
              <QtyField label="Done" value={detail.qty_done} onSave={v => updateField('qty_done', v)} />
              <QtyField label="Rejected" value={detail.qty_rejected} onSave={v => updateField('qty_rejected', v)} />
            </div>

            <div className="flex flex-col gap-2 border-t pt-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Time logged</p>
                {detail.laborCost > 0 && (
                  <span className="text-xs text-muted-foreground tnum" title="Labor only — consumables below aren't priced">
                    ₹{detail.laborCost.toLocaleString('en-IN')} labor only
                  </span>
                )}
              </div>
              {detail.timeLogs.length === 0 && <p className="text-xs text-muted-foreground">No hours logged yet.</p>}
              {detail.timeLogs.map(l => (
                <div key={l.id} className="flex items-center justify-between text-xs">
                  <span>{l.employee_name}</span>
                  <span className="text-muted-foreground tnum">
                    {(l.minutes / 60).toFixed(1)}h{l.cost ? ` · ₹${l.cost.toLocaleString('en-IN')}` : ''}
                  </span>
                </div>
              ))}
              <div className="flex flex-col gap-1.5 pt-1">
                <Select value={hoursForm.employee_id} onValueChange={v => setHoursForm({ ...hoursForm, employee_id: v })}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Worker" /></SelectTrigger>
                  <SelectContent><SelectGroup>
                    {workers.map(w => <SelectItem key={w.id} value={String(w.id)}>{w.name}{w.trade ? ` · ${w.trade}` : ''}</SelectItem>)}
                  </SelectGroup></SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                  <Input type="number" min="0" step="1" placeholder="Mins" className="w-20"
                    value={hoursForm.minutes} disabled={hoursForm.fromTime && hoursForm.toTime}
                    onChange={e => setHoursForm({ ...hoursForm, minutes: e.target.value })} />
                  <span className="text-xs text-muted-foreground">or</span>
                  <Input type="time" className="w-28" value={hoursForm.fromTime}
                    onChange={e => setHoursForm({ ...hoursForm, fromTime: e.target.value })} />
                  <span className="text-xs text-muted-foreground">–</span>
                  <Input type="time" className="w-28" value={hoursForm.toTime}
                    onChange={e => setHoursForm({ ...hoursForm, toTime: e.target.value })} />
                  <Button size="sm" onClick={logHours} disabled={busy} className="ml-auto">Log</Button>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t pt-4">
              <p className="text-sm font-medium">Consumables</p>
              {detail.consumables.length === 0 && <p className="text-xs text-muted-foreground">None logged.</p>}
              {detail.consumables.map(c => (
                <div key={c.id} className="flex items-center justify-between text-xs">
                  <span>{c.item_name}</span>
                  <span className="text-muted-foreground tnum">{c.qty || ''} {c.unit || ''}</span>
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <Input placeholder="Item" className="flex-1" value={consumableForm.item_name}
                  onChange={e => setConsumableForm({ ...consumableForm, item_name: e.target.value })} />
                <Input placeholder="Qty" className="w-16" value={consumableForm.qty}
                  onChange={e => setConsumableForm({ ...consumableForm, qty: e.target.value })} />
                <Input placeholder="Unit" className="w-16" value={consumableForm.unit}
                  onChange={e => setConsumableForm({ ...consumableForm, unit: e.target.value })} />
                <Button size="sm" onClick={addConsumable} disabled={busy}>Add</Button>
              </div>
            </div>

            {detail.materialIssues.length > 0 && (
              <div className="flex flex-col gap-2 border-t pt-4">
                <p className="text-sm font-medium">Materials issued</p>
                {detail.materialIssues.map(m => (
                  <div key={m.id} className="flex items-center justify-between text-xs">
                    <EntityCode code={`BM-${m.bom_item_id}`} fallback={`BOM item #${m.bom_item_id}`} />
                    <span className="text-muted-foreground tnum">qty {m.qty}</span>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">Issue material against a BOM line from the BOM tab.</p>
              </div>
            )}
          </div>
        )}
      </SheetContent>
      {raisingNcr && detail && (
        <RaiseNcrDialog open onOpenChange={setRaisingNcr}
          projectId={detail.project_id} jobCardId={detail.id} onRaised={refresh} />
      )}
    </Sheet>
  );
}

function QtyField({ label, value, onSave }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input type="number" min="0" value={v} className="h-8"
        onChange={e => setV(e.target.value)}
        onBlur={() => Number(v) !== Number(value) && onSave(Number(v) || 0)} />
    </div>
  );
}
