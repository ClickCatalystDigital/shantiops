'use client';

// A department's cross-department surface: tasks raised for it (inbox) and tasks it raised
// elsewhere (outbox), plus the composer for both directions — send a closed milestone back for
// rework, or raise a plain ask. Mounted two places: inside DepartmentPanel (scoped to one
// department, on a project) and on Operations (department-stacked for a head, every department for
// a PM). Formerly backed by a standalone `tickets` entity — collapsed into milestones + tasks, see
// lib/notify.js's header comment. The component keeps its old name/shape deliberately (small diff);
// rename once the shape settles.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, showToast, formatDate } from '@/lib/client';
import { todayISO } from '@/lib/date';
import { DEPARTMENTS } from '@/lib/milestones';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import { PlusIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

function RaiseDialog({ department, projectId, milestones, bom = [], tasks = [], router }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    kind: 'request', to_department: '', milestone_id: '', bom_item_id: '', title: '', body: '', due_date: '',
    moc: '', size_spec: '', qty_text: '', pr_ref: '',
  });

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })); }

  // Reopen targets a specific already-closed milestone in the receiving department — only
  // offerable when we're on a project (a milestone selector with no project to scope it to is
  // meaningless), and its options narrow to whichever department this is addressed to AND are
  // actually done (nothing else can be sent back).
  const canReopen = !!projectId;
  const reopenOptions = (milestones || []).filter(m =>
    m.department === form.to_department && (m.actual_end || m.status === 'done'));

  // Cancel-request targets a Procurement BOM item — only offerable once "Procurement" is picked
  // as the target. Excludes items already resolved and items with an existing open cancel-request
  // (deduped against this department's own outgoing tasks, already in the `tasks` prop).
  const openCancelBomIds = new Set(tasks.filter(t => t.bom_item_id && t.status === 'open').map(t => t.bom_item_id));
  const eligibleBom = form.to_department === 'Procurement'
    ? bom.filter(b => !['CANCELLED', 'CLOSED', 'RECEIVED'].includes(b.purchase_status) && !openCancelBomIds.has(b.id))
    : [];

  // New-item request (§4.0) — same project-context requirement as Reopen: a request needs a
  // project to attach to, and Operations' Raise dialog has no project picker of its own.
  const canRequestItem = form.to_department === 'Procurement' && !!projectId;

  async function submit() {
    if (!['cancel_item', 'request_item'].includes(form.kind) && !form.title.trim()) return showToast('Title is required', 'error');
    if (form.kind === 'request_item' && !form.title.trim()) return showToast('Item description is required', 'error');
    if (!form.to_department) return showToast('Pick a department', 'error');
    if (form.kind === 'reopen' && !form.milestone_id) return showToast('Pick the milestone to send back', 'error');
    if (form.kind === 'cancel_item' && !form.bom_item_id) return showToast('Pick an item to cancel', 'error');
    setBusy(true);
    try {
      if (form.kind === 'request_item') {
        await api('/api/procurement-requests', {
          method: 'POST',
          body: {
            project_id: projectId || undefined, from_department: department || undefined,
            material_description: form.title, moc: form.moc || undefined, size_spec: form.size_spec || undefined,
            qty_text: form.qty_text || undefined, pr_ref: form.pr_ref || undefined, notes: form.body || undefined,
          },
        });
        showToast('Request sent to Procurement');
      } else if (form.kind === 'reopen') {
        const reason = form.body.trim() ? `${form.title.trim()} — ${form.body.trim()}` : form.title.trim();
        await api(`/api/milestones/${form.milestone_id}/reopen`, { method: 'POST', body: { reason } });
        showToast('Sent back for rework');
      } else if (form.kind === 'cancel_item') {
        const item = eligibleBom.find(b => String(b.id) === form.bom_item_id);
        const title = `Cancel: ${item.material_description}` + (form.body.trim() ? ` — ${form.body.trim()}` : '');
        await api('/api/production/tasks', {
          method: 'POST',
          body: {
            title, due_date: todayISO(), department: form.to_department,
            from_department: department || undefined, project_id: item.project_id || projectId || undefined,
            bom_item_id: item.id,
          },
        });
        showToast('Cancel request sent');
      } else {
        await api('/api/production/tasks', {
          method: 'POST',
          body: {
            title: form.title, due_date: form.due_date || todayISO(), department: form.to_department,
            from_department: department || undefined, project_id: projectId || undefined,
          },
        });
        showToast('Task raised');
      }
      setForm({
        kind: 'request', to_department: '', milestone_id: '', bom_item_id: '', title: '', body: '', due_date: '',
        moc: '', size_spec: '', qty_text: '', pr_ref: '',
      });
      setOpen(false);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><PlusIcon data-icon="inline-start" />Raise</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Raise for another department</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Kind</Label>
              <Select value={form.kind}
                onValueChange={v => setForm(f => ({
                  ...f, kind: v,
                  milestone_id: v === 'reopen' ? f.milestone_id : '',
                  bom_item_id: v === 'cancel_item' ? f.bom_item_id : '',
                }))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="request">Task</SelectItem>
                  {canReopen && <SelectItem value="reopen">Send back (rework)</SelectItem>}
                  {form.to_department === 'Procurement' && <SelectItem value="cancel_item">Cancel BOM item</SelectItem>}
                  {canRequestItem && <SelectItem value="request_item">Request procurement</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>To department</Label>
              <Select value={form.to_department}
                onValueChange={v => setForm(f => ({
                  ...f, to_department: v, milestone_id: '', bom_item_id: '',
                  kind: v !== 'Procurement' && ['cancel_item', 'request_item'].includes(f.kind) ? 'request' : f.kind,
                }))}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose…" /></SelectTrigger>
                <SelectContent>
                  {DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {form.kind === 'reopen' && (
            <div className="flex flex-col gap-1.5">
              <Label>Milestone</Label>
              <Select value={form.milestone_id} disabled={!form.to_department}
                onValueChange={v => setForm(f => ({ ...f, milestone_id: v }))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={form.to_department ? 'Which milestone?' : 'Pick a department first'} />
                </SelectTrigger>
                <SelectContent>
                  {reopenOptions.length === 0 && form.to_department && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">No closed milestones there yet</div>
                  )}
                  {reopenOptions.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.milestone_label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {form.kind === 'cancel_item' && (
            <div className="flex flex-col gap-1.5">
              <Label>Item</Label>
              <Select value={form.bom_item_id} onValueChange={v => setForm(f => ({ ...f, bom_item_id: v }))}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Which item?" /></SelectTrigger>
                <SelectContent>
                  {eligibleBom.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">No items eligible right now</div>
                  )}
                  {eligibleBom.map(b => (
                    <SelectItem key={b.id} value={String(b.id)}>
                      {b.project_no ? `${b.project_no} · ${b.material_description}` : b.material_description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {form.kind === 'request_item' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label>Item description</Label>
                <Input value={form.title} onChange={set('title')} placeholder="e.g. MS ANGLE" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>MOC / spec (optional)</Label>
                <Input value={form.moc} onChange={set('moc')} placeholder="e.g. MS" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Size (optional)</Label>
                <Input value={form.size_spec} onChange={set('size_spec')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Qty (optional)</Label>
                <Input value={form.qty_text} onChange={set('qty_text')} placeholder="e.g. 4 Nos" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>PR No. & date (optional)</Label>
                <Input value={form.pr_ref} onChange={set('pr_ref')} />
              </div>
            </div>
          )}
          {!['cancel_item', 'request_item'].includes(form.kind) && (
            <div className="flex flex-col gap-1.5">
              <Label>{form.kind === 'reopen' ? 'Reason' : 'Title'}</Label>
              <Input value={form.title} onChange={set('title')}
                placeholder={form.kind === 'reopen' ? 'Why is this being sent back?' : 'Short summary'} />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>{form.kind === 'cancel_item' ? 'Reason (optional)' : form.kind === 'request_item' ? 'Notes (optional)' : 'Details'}</Label>
            <Textarea rows={2} value={form.body} onChange={set('body')}
              placeholder={form.kind === 'cancel_item' ? 'Why is this being cancelled?' : undefined} />
          </div>
          {form.kind === 'request' && (
            <div className="flex flex-col gap-1.5">
              <Label>Due date</Label>
              <Input type="date" value={form.due_date} onChange={set('due_date')} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button disabled={busy} onClick={submit}>
            {busy ? 'Sending…'
              : form.kind === 'reopen' ? 'Send back'
              : form.kind === 'cancel_item' ? 'Send cancel request'
              : form.kind === 'request_item' ? 'Send request'
              : 'Raise task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function TicketsPanel({
  tasks = [], department = null, projectId = null, milestones = [], bom = [], canRaise = false, showDepartment = false,
  title = 'Tickets',
}) {
  const router = useRouter();
  const today = todayISO();

  async function toggle(t) {
    try {
      await api(`/api/production/tasks/${t.id}`, { method: 'PATCH', body: { status: t.status === 'done' ? 'open' : 'done' } });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {canRaise && (
          <CardAction><RaiseDialog department={department} projectId={projectId} milestones={milestones} bom={bom} tasks={tasks} router={router} /></CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {tasks.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing here yet.</p>
        )}
        {tasks.map(t => {
          const overdue = t.status === 'open' && t.due_date && t.due_date < today;
          const deptText = showDepartment
            ? `${t.from_department || '—'} → ${t.department}`
            : (t.from_department && `from ${t.from_department}`);
          const subtitle = [
            t.project_id && <Link key="p" href={`/projects/${t.project_id}`} className="text-primary hover:underline">Project</Link>,
            deptText,
          ].filter(Boolean);
          return (
            <div key={t.id} className="flex items-center gap-3 py-2.5 text-sm">
              {t.from_department && (
                <span className="shrink-0 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning ring-1 ring-inset ring-warning/20">
                  Raised
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className={cn('truncate font-medium', t.status === 'done' && 'text-muted-foreground line-through')}>{t.title}</p>
                {subtitle.length > 0 && (
                  <p className="truncate text-xs text-muted-foreground">
                    {subtitle.map((node, i) => <span key={i}>{i > 0 && ' · '}{node}</span>)}
                  </p>
                )}
              </div>
              {t.due_date && (
                <span className={cn('shrink-0 text-xs tnum', overdue ? 'font-medium text-danger' : 'text-muted-foreground')}>
                  {formatDate(t.due_date)}
                </span>
              )}
              <Checkbox checked={t.status === 'done'} onCheckedChange={() => toggle(t)} aria-label="Mark closed" />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
