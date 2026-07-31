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

function RaiseDialog({ department, projectId, milestones, router }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ kind: 'request', to_department: '', milestone_id: '', title: '', body: '', due_date: '' });

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })); }

  // Reopen targets a specific already-closed milestone in the receiving department — only
  // offerable when we're on a project (a milestone selector with no project to scope it to is
  // meaningless), and its options narrow to whichever department this is addressed to AND are
  // actually done (nothing else can be sent back).
  const canReopen = !!projectId;
  const reopenOptions = (milestones || []).filter(m =>
    m.department === form.to_department && (m.actual_end || m.status === 'done'));

  async function submit() {
    if (!form.title.trim()) return showToast('Title is required', 'error');
    if (!form.to_department) return showToast('Pick a department', 'error');
    if (form.kind === 'reopen' && !form.milestone_id) return showToast('Pick the milestone to send back', 'error');
    setBusy(true);
    try {
      if (form.kind === 'reopen') {
        const reason = form.body.trim() ? `${form.title.trim()} — ${form.body.trim()}` : form.title.trim();
        await api(`/api/milestones/${form.milestone_id}/reopen`, { method: 'POST', body: { reason } });
        showToast('Sent back for rework');
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
      setForm({ kind: 'request', to_department: '', milestone_id: '', title: '', body: '', due_date: '' });
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
                onValueChange={v => setForm(f => ({ ...f, kind: v, milestone_id: v === 'reopen' ? f.milestone_id : '' }))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="request">Task</SelectItem>
                  {canReopen && <SelectItem value="reopen">Send back (rework)</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>To department</Label>
              <Select value={form.to_department}
                onValueChange={v => setForm(f => ({ ...f, to_department: v, milestone_id: '' }))}>
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
          <div className="flex flex-col gap-1.5">
            <Label>{form.kind === 'reopen' ? 'Reason' : 'Title'}</Label>
            <Input value={form.title} onChange={set('title')}
              placeholder={form.kind === 'reopen' ? 'Why is this being sent back?' : 'Short summary'} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Details</Label>
            <Textarea rows={2} value={form.body} onChange={set('body')} />
          </div>
          {form.kind === 'request' && (
            <div className="flex flex-col gap-1.5">
              <Label>Due date</Label>
              <Input type="date" value={form.due_date} onChange={set('due_date')} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button disabled={busy} onClick={submit}>{busy ? 'Sending…' : (form.kind === 'reopen' ? 'Send back' : 'Raise task')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function TicketsPanel({
  tasks = [], department = null, projectId = null, milestones = [], canRaise = false, showDepartment = false,
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
          <CardAction><RaiseDialog department={department} projectId={projectId} milestones={milestones} router={router} /></CardAction>
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
