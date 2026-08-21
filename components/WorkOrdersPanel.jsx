'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { formatMoney } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem,
} from '@/components/ui/select';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { PlusIcon, TrashIcon, IndianRupeeIcon, DownloadIcon } from 'lucide-react';

const STATUS_VARIANT = {
  draft: 'outline', released: 'secondary', in_progress: 'default', completed: 'default', cancelled: 'destructive',
};
const NEXT_STATUS = { draft: 'released', released: 'in_progress', in_progress: 'completed' };
const NEXT_LABEL = { draft: 'Release', released: 'Start', in_progress: 'Complete' };

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'released', label: 'Released' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

// Work Orders (STERP items 21-23/27-29, SYSTEM.md §5l) — the parent production-control entity
// above Job Cards. List + create here; the rest (route card, materials, change notes, costing,
// job-card generation) lives in the detail sheet below. initialStatus (from Operations' pipeline
// glance, ProductionFlow.jsx, via WorkersPanel's own ?wostatus= read) preselects the same status
// filter GET /api/work-orders already supports server-side — a stage there is "drill into the
// Work Orders behind this count," not a separate filtered view.
export default function WorkOrdersPanel({ projects, operations, workstations, initialStatus = null }) {
  const router = useRouter();
  const [workOrders, setWorkOrders] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [status, setStatus] = useState(STATUS_OPTIONS.some(o => o.value === initialStatus) ? initialStatus : 'all');
  const [projectFilter, setProjectFilter] = useState('all');

  async function load(statusFilter = status, projectIdFilter = projectFilter) {
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (projectIdFilter !== 'all') params.set('project_id', projectIdFilter);
    const qs = params.toString();
    setWorkOrders(await api(`/api/work-orders${qs ? `?${qs}` : ''}`));
  }
  useEffect(() => { load().catch(err => showToast(err.message, 'error')); }, []);

  function changeStatus(next) {
    setStatus(next);
    setWorkOrders(null);
    load(next, projectFilter).catch(err => showToast(err.message, 'error'));
  }

  function changeProject(next) {
    setProjectFilter(next);
    setWorkOrders(null);
    load(status, next).catch(err => showToast(err.message, 'error'));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={projectFilter} onValueChange={changeProject}>
            <SelectTrigger className="w-52"><SelectValue placeholder="All Projects" /></SelectTrigger>
            <SelectContent><SelectGroup>
              <SelectItem value="all">All Projects</SelectItem>
              {projects.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.project_no} · {p.customer_name}</SelectItem>)}
            </SelectGroup></SelectContent>
          </Select>
          <Select value={status} onValueChange={changeStatus}>
            <SelectTrigger className="w-44"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent><SelectGroup>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectGroup></SelectContent>
          </Select>
        </div>
        <NewWorkOrderDialog projects={projects} onCreated={id => { load(); setOpenId(id); }} />
      </div>
      {!workOrders ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : workOrders.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          {status === 'all' && projectFilter === 'all' ? 'No Work Orders yet — create the first one.' : 'No Work Orders match this filter.'}
        </CardContent></Card>
      ) : (
        <Card><CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>WO No.</TableHead><TableHead>Mode</TableHead><TableHead>Project / Product</TableHead>
              <TableHead>Qty</TableHead><TableHead>Progress</TableHead><TableHead>Status</TableHead><TableHead>Planned</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {workOrders.map(wo => (
                <TableRow key={wo.id} className="cursor-pointer" onClick={() => setOpenId(wo.id)}>
                  <TableCell className="font-medium">{wo.wo_no}</TableCell>
                  <TableCell>{wo.mode === 'against_stock' ? 'Stock' : 'Order'}</TableCell>
                  <TableCell>{wo.project_no ? `${wo.project_no} · ${wo.customer_name}` : (wo.product_description || '—')}</TableCell>
                  <TableCell className="tnum">{wo.qty_done}/{wo.qty_planned}</TableCell>
                  <TableCell className="tnum">{wo.qty_planned ? Math.round((wo.qty_done / wo.qty_planned) * 100) : 0}%</TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[wo.status]}>{wo.status.replace('_', ' ')}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{wo.planned_start || '—'} → {wo.planned_end || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}
      {openId && (
        <WorkOrderDetail id={openId} projects={projects} operations={operations} workstations={workstations}
          onClose={() => setOpenId(null)} onChanged={() => { load(); router.refresh(); }} />
      )}
    </div>
  );
}

function NewWorkOrderDialog({ projects, onCreated }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    mode: 'against_order', project_id: '', product_description: '', qty_planned: '',
    planned_start: '', planned_end: '', notes: '',
  });

  async function save() {
    if (form.mode === 'against_order' && !form.project_id) return showToast('Project is required', 'error');
    if (form.mode === 'against_stock' && !form.product_description.trim()) return showToast('Product description is required', 'error');
    if (!(Number(form.qty_planned) > 0)) return showToast('Planned quantity must be greater than 0', 'error');
    setSaving(true);
    try {
      const { id } = await api('/api/work-orders', {
        method: 'POST',
        body: { ...form, project_id: form.project_id ? Number(form.project_id) : null, qty_planned: Number(form.qty_planned) },
      });
      showToast('Work Order created');
      setOpen(false);
      setForm({ mode: 'against_order', project_id: '', product_description: '', qty_planned: '', planned_start: '', planned_end: '', notes: '' });
      onCreated(id);
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><PlusIcon />New Work Order</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New Work Order</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label>Mode</Label>
            <Select value={form.mode} onValueChange={v => setForm({ ...form, mode: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="against_order">Against a customer order</SelectItem>
                <SelectItem value="against_stock">Against stock (replenishment)</SelectItem>
              </SelectGroup></SelectContent>
            </Select>
          </div>
          {form.mode === 'against_order' ? (
            <div className="grid gap-1.5">
              <Label>Project *</Label>
              <Select value={form.project_id} onValueChange={v => setForm({ ...form, project_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select a project" /></SelectTrigger>
                <SelectContent><SelectGroup>
                  {projects.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.project_no} · {p.customer_name}</SelectItem>)}
                </SelectGroup></SelectContent>
              </Select>
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label>Product description *</Label>
              <Input value={form.product_description} onChange={e => setForm({ ...form, product_description: e.target.value })} />
            </div>
          )}
          <div className="grid gap-1.5"><Label>Planned quantity *</Label>
            <Input type="number" min="0" value={form.qty_planned} onChange={e => setForm({ ...form, qty_planned: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5"><Label>Planned start</Label>
              <Input type="date" value={form.planned_start} onChange={e => setForm({ ...form, planned_start: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Planned end</Label>
              <Input type="date" value={form.planned_end} onChange={e => setForm({ ...form, planned_end: e.target.value })} /></div>
          </div>
          <div className="grid gap-1.5"><Label>Notes</Label>
            <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <DialogFooter><Button onClick={save} disabled={saving}>{saving ? 'Creating…' : 'Create'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WorkOrderDetail({ id, projects, operations, workstations, onClose, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [bomItems, setBomItems] = useState(null);
  const [costing, setCosting] = useState(null);
  const [opForm, setOpForm] = useState({ operation_id: '', workstation_id: '', milestone_id: '', department: '', planned_minutes: '', quality_checkpoint: '' });
  const [matForm, setMatForm] = useState({ bom_item_id: '', description: '', qty_required: '', unit_cost: '' });
  const [noteForm, setNoteForm] = useState({ field: 'qty_planned', new_value: '', reason: '' });

  async function refresh() {
    setDetail(await api(`/api/work-orders/${id}`));
  }
  useEffect(() => { refresh().catch(err => showToast(err.message, 'error')); }, [id]);
  useEffect(() => {
    if (detail?.project_id) api(`/api/projects/${detail.project_id}/bom`).then(r => setBomItems(r.items)).catch(() => setBomItems([]));
  }, [detail?.project_id]);

  const milestoneOptions = projects.find(p => String(p.id) === String(detail?.project_id))?.milestones || [];

  async function transition(status) {
    setBusy(true);
    try {
      await api(`/api/work-orders/${id}`, { method: 'PATCH', body: { status } });
      showToast(`Work Order ${status.replace('_', ' ')}`);
      await refresh(); onChanged();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  }

  async function addOperation() {
    setBusy(true);
    try {
      await api(`/api/work-orders/${id}/operations`, {
        method: 'POST',
        body: {
          ...opForm,
          operation_id: opForm.operation_id || null, workstation_id: opForm.workstation_id || null,
          milestone_id: opForm.milestone_id || null, planned_minutes: Number(opForm.planned_minutes) || 0,
        },
      });
      setOpForm({ operation_id: '', workstation_id: '', milestone_id: '', department: '', planned_minutes: '', quality_checkpoint: '' });
      await refresh(); onChanged();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  }

  async function removeOperation(opId) {
    setBusy(true);
    try { await api(`/api/work-orders/${id}/operations/${opId}`, { method: 'DELETE' }); await refresh(); onChanged(); }
    catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  }

  async function addMaterial() {
    if (!(Number(matForm.qty_required) > 0)) return showToast('Quantity required must be greater than 0', 'error');
    setBusy(true);
    try {
      await api(`/api/work-orders/${id}/materials`, {
        method: 'POST',
        body: {
          bom_item_id: matForm.bom_item_id || null, description: matForm.description || null,
          qty_required: Number(matForm.qty_required), unit_cost: matForm.unit_cost ? Number(matForm.unit_cost) : null,
        },
      });
      setMatForm({ bom_item_id: '', description: '', qty_required: '', unit_cost: '' });
      await refresh(); onChanged();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  }

  async function removeMaterial(matId) {
    setBusy(true);
    try { await api(`/api/work-orders/${id}/materials/${matId}`, { method: 'DELETE' }); await refresh(); onChanged(); }
    catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  }

  async function logIssue(matId, current) {
    const qty = prompt('Quantity issued so far', current ?? 0);
    if (qty == null) return;
    setBusy(true);
    try { await api(`/api/work-orders/${id}/materials/${matId}`, { method: 'PATCH', body: { qty_issued: Number(qty) } }); await refresh(); }
    catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  }

  async function generateJobCards() {
    setBusy(true);
    try {
      const { created } = await api(`/api/work-orders/${id}/generate-job-cards`, { method: 'POST' });
      showToast(created ? `${created} Job Card(s) created` : 'No new route steps to generate from');
      await refresh(); onChanged();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  }

  async function submitChangeNote() {
    if (!noteForm.reason.trim()) return showToast('Reason is required', 'error');
    setBusy(true);
    try {
      const updated = await api(`/api/work-orders/${id}/change-notes`, { method: 'POST', body: noteForm });
      setDetail(updated);
      setNoteForm({ field: 'qty_planned', new_value: '', reason: '' });
      showToast('Change Note applied'); onChanged();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  }

  async function loadCosting() {
    setCosting(await api(`/api/work-orders/${id}/costing`));
  }

  return (
    <Sheet open onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {!detail ? <p className="p-4 text-sm text-muted-foreground">Loading…</p> : (
          <div className="flex flex-col gap-5 p-4">
            <SheetHeader className="p-0">
              <SheetTitle>{detail.wo_no}</SheetTitle>
            </SheetHeader>
            <p className="-mt-3 text-sm text-muted-foreground">
              {detail.project_no ? `${detail.project_no} · ${detail.customer_name}` : detail.product_description}
              {detail.bom_release_revision ? ` · BOM rev ${detail.bom_release_revision}` : ''}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_VARIANT[detail.status]}>{detail.status.replace('_', ' ')}</Badge>
              {detail.progress.delayed && <Badge variant="destructive">Delayed</Badge>}
              {detail.progress.reworkCount > 0 && <Badge variant="outline">{detail.progress.reworkCount} rework</Badge>}
              {NEXT_STATUS[detail.status] && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => transition(NEXT_STATUS[detail.status])}>
                  {NEXT_LABEL[detail.status]}
                </Button>
              )}
              {['draft', 'released', 'in_progress'].includes(detail.status) && (
                <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => transition('cancelled')}>Cancel</Button>
              )}
              <span className="ml-auto text-sm tnum text-muted-foreground">
                {detail.progress.qtyDone}/{detail.progress.qtyPlanned} done ({detail.progress.pct}%)
                {detail.progress.qtyRejected > 0 ? ` · ${detail.progress.qtyRejected} rejected` : ''}
              </span>
            </div>

            {/* Process Route Card */}
            <div className="flex flex-col gap-2 border-t pt-4">
              <p className="text-sm font-medium">Process Route Card</p>
              {detail.operations.length === 0 && <p className="text-xs text-muted-foreground">No route steps yet.</p>}
              {detail.operations.map(op => (
                <div key={op.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                  <div className="flex flex-col">
                    <span>#{op.seq} {op.operation_name || op.department || 'Step'}{op.workstation_name ? ` · ${op.workstation_name}` : ''}</span>
                    <span className="text-xs text-muted-foreground">
                      {op.planned_minutes ? `${op.planned_minutes} min planned` : 'No planned time'}
                      {op.milestone_label ? ` · ${op.milestone_label}` : ''}
                      {op.quality_checkpoint ? ` · QC: ${op.quality_checkpoint}` : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs tnum text-muted-foreground">{op.job_cards_done}/{op.job_card_count} cards</span>
                    {detail.status === 'draft' && (
                      <Button size="icon" variant="ghost" disabled={busy} onClick={() => removeOperation(op.id)}><TrashIcon className="size-4" /></Button>
                    )}
                  </div>
                </div>
              ))}
              {detail.status === 'draft' && (
                <div className="flex flex-wrap items-end gap-2 pt-1">
                  <Select value={opForm.operation_id} onValueChange={v => setOpForm({ ...opForm, operation_id: v })}>
                    <SelectTrigger className="w-40"><SelectValue placeholder="Operation" /></SelectTrigger>
                    <SelectContent><SelectGroup>{operations.map(o => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}</SelectGroup></SelectContent>
                  </Select>
                  <Select value={opForm.workstation_id} onValueChange={v => setOpForm({ ...opForm, workstation_id: v })}>
                    <SelectTrigger className="w-40"><SelectValue placeholder="Workstation" /></SelectTrigger>
                    <SelectContent><SelectGroup>{workstations.map(w => <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>)}</SelectGroup></SelectContent>
                  </Select>
                  {detail.project_id && (
                    <Select value={opForm.milestone_id} onValueChange={v => setOpForm({ ...opForm, milestone_id: v })}>
                      <SelectTrigger className="w-40"><SelectValue placeholder="Milestone" /></SelectTrigger>
                      <SelectContent><SelectGroup>{milestoneOptions.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.label}</SelectItem>)}</SelectGroup></SelectContent>
                    </Select>
                  )}
                  <Input placeholder="Department" className="w-32" value={opForm.department} onChange={e => setOpForm({ ...opForm, department: e.target.value })} />
                  <Input type="number" placeholder="Mins" className="w-20" value={opForm.planned_minutes} onChange={e => setOpForm({ ...opForm, planned_minutes: e.target.value })} />
                  <Input placeholder="QC checkpoint" className="w-32" value={opForm.quality_checkpoint} onChange={e => setOpForm({ ...opForm, quality_checkpoint: e.target.value })} />
                  <Button size="sm" onClick={addOperation} disabled={busy}>Add step</Button>
                </div>
              )}
              {['released', 'in_progress'].includes(detail.status) && (
                <Button size="sm" variant="outline" className="w-fit" disabled={busy} onClick={generateJobCards}>Generate Job Cards</Button>
              )}
            </div>

            {/* Material requirements */}
            <div className="flex flex-col gap-2 border-t pt-4">
              <p className="text-sm font-medium">Material requirements</p>
              {detail.materials.length === 0 && <p className="text-xs text-muted-foreground">None added yet.</p>}
              {detail.materials.map(m => (
                <div key={m.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                  <span>{m.bom_description || m.item_name || m.description || '—'}</span>
                  <div className="flex items-center gap-2 text-xs tnum text-muted-foreground">
                    <span>{m.qty_issued || 0}/{m.qty_required} issued</span>
                    {!m.bom_item_id && (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => logIssue(m.id, m.qty_issued)}>Log issue</Button>
                    )}
                    <Button size="icon" variant="ghost" disabled={busy} onClick={() => removeMaterial(m.id)}><TrashIcon className="size-4" /></Button>
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap items-end gap-2 pt-1">
                {detail.project_id && bomItems?.length > 0 && (
                  <Select value={matForm.bom_item_id} onValueChange={v => setMatForm({ ...matForm, bom_item_id: v, description: '' })}>
                    <SelectTrigger className="w-56"><SelectValue placeholder="Pull from BOM" /></SelectTrigger>
                    <SelectContent><SelectGroup>
                      {bomItems.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.material_description}</SelectItem>)}
                    </SelectGroup></SelectContent>
                  </Select>
                )}
                {!matForm.bom_item_id && (
                  <Input placeholder="Description" className="w-40" value={matForm.description} onChange={e => setMatForm({ ...matForm, description: e.target.value })} />
                )}
                <Input type="number" placeholder="Qty required" className="w-28" value={matForm.qty_required} onChange={e => setMatForm({ ...matForm, qty_required: e.target.value })} />
                <Input type="number" placeholder="Unit cost" className="w-24" value={matForm.unit_cost} onChange={e => setMatForm({ ...matForm, unit_cost: e.target.value })} />
                <Button size="sm" onClick={addMaterial} disabled={busy}>Add line</Button>
              </div>
            </div>

            {/* Linked job cards */}
            <div className="flex flex-col gap-2 border-t pt-4">
              <p className="text-sm font-medium">Job Cards ({detail.progress.jobCardsDone}/{detail.progress.jobCardsTotal})</p>
              {detail.jobCards.length === 0 && <p className="text-xs text-muted-foreground">None generated yet.</p>}
              {detail.jobCards.map(jc => (
                <div key={jc.id} className="flex items-center justify-between text-xs">
                  <span>#{jc.id} {jc.section}{jc.workstation_name ? ` · ${jc.workstation_name}` : ''}</span>
                  <span className="text-muted-foreground tnum">{jc.status} · {jc.qty_done}/{jc.qty_planned}</span>
                </div>
              ))}
            </div>

            {/* Change notes */}
            {detail.status !== 'draft' && (
              <div className="flex flex-col gap-2 border-t pt-4">
                <p className="text-sm font-medium">Change Notes</p>
                {detail.changeNotes.length === 0 && <p className="text-xs text-muted-foreground">No changes logged.</p>}
                {detail.changeNotes.map(n => (
                  <div key={n.id} className="text-xs">
                    <span className="font-medium">{n.field_changed}</span>: {n.old_value ?? '—'} → {n.new_value ?? '—'}
                    <span className="text-muted-foreground"> — {n.reason} ({n.created_by})</span>
                  </div>
                ))}
                <div className="flex flex-wrap items-end gap-2 pt-1">
                  <Select value={noteForm.field} onValueChange={v => setNoteForm({ ...noteForm, field: v })}>
                    <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectGroup>
                      <SelectItem value="qty_planned">Quantity</SelectItem>
                      <SelectItem value="planned_start">Planned start</SelectItem>
                      <SelectItem value="planned_end">Planned end</SelectItem>
                      <SelectItem value="product_description">Product description</SelectItem>
                    </SelectGroup></SelectContent>
                  </Select>
                  <Input placeholder="New value" className="w-40" value={noteForm.new_value} onChange={e => setNoteForm({ ...noteForm, new_value: e.target.value })} />
                  <Input placeholder="Reason" className="w-48" value={noteForm.reason} onChange={e => setNoteForm({ ...noteForm, reason: e.target.value })} />
                  <Button size="sm" onClick={submitChangeNote} disabled={busy}>Log change</Button>
                </div>
              </div>
            )}

            {/* Costing */}
            <div className="flex flex-col gap-2 border-t pt-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Costing</p>
                {!costing && <Button size="sm" variant="outline" onClick={loadCosting}><IndianRupeeIcon />Load</Button>}
                {costing && (
                  <Button asChild size="sm" variant="outline">
                    <a href={`/api/work-orders/${id}/costing-pdf`} target="_blank" rel="noreferrer">
                      <DownloadIcon data-icon="inline-start" />PDF
                    </a>
                  </Button>
                )}
              </div>
              {costing && (
                <div className="flex flex-col gap-1 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Material — planned</span><span className="tnum">{formatMoney(costing.plannedMaterialCost)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Material — actual ({costing.materialScope})</span><span className="tnum">{formatMoney(costing.actualMaterialCost)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Labor — planned</span><span className="tnum">{formatMoney(costing.plannedLaborCost)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Labor — actual</span><span className="tnum">{formatMoney(costing.actualLaborCost)}</span></div>
                  <div className="flex justify-between border-t pt-1 font-medium"><span>Total planned / actual</span><span className="tnum">{formatMoney(costing.plannedTotal)} / {formatMoney(costing.actualTotal)}</span></div>
                  {costing.outsideJobCards.length > 0 && (
                    <p className="text-xs text-muted-foreground">{costing.outsideJobCards.length} outside/subcontracted job card(s) — no vendor cost field tracked, see the card for the vendor name.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
