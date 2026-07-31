'use client';

// A department's ticket list — handoffs received, rework sent back, and cross-department
// requests, both directions (to_department AND from_department: the two halves of a handoff read
// as one conversation). Mounted two places: inside DepartmentPanel (scoped to one department, on
// a project) and on /tickets (department-stacked for a head, everything for a PM).
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

const KIND_LABEL = { handoff: 'Handoff', rework: 'Rework', request: 'Request' };
const KIND_TONE = {
  handoff: 'bg-accent text-accent-foreground ring-accent-foreground/15',
  rework: 'bg-danger/10 text-danger ring-danger/20',
  request: 'bg-warning/10 text-warning ring-warning/20',
};

function RaiseTicketDialog({ department, projectId, milestones, router }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ kind: 'request', to_department: '', milestone_id: '', title: '', body: '', due_date: '' });

  function set(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })); }

  // Rework targets a specific milestone in the receiving department — only offerable when we're
  // on a project (a milestone selector with no project to scope it to is meaningless), and its
  // options narrow to whichever department the ticket is currently addressed to.
  const canRework = !!projectId;
  const reworkOptions = (milestones || []).filter(m => m.department === form.to_department);

  async function submit() {
    if (!form.title.trim()) return showToast('Title is required', 'error');
    if (!form.to_department) return showToast('Pick a department', 'error');
    if (form.kind === 'rework' && !form.milestone_id) return showToast('Pick the milestone this rework is about', 'error');
    setBusy(true);
    try {
      await api('/api/tickets', {
        method: 'POST',
        body: { ...form, from_department: department || undefined, project_id: projectId || undefined },
      });
      showToast('Ticket raised');
      setForm({ kind: 'request', to_department: '', milestone_id: '', title: '', body: '', due_date: '' });
      setOpen(false);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><PlusIcon data-icon="inline-start" />Raise ticket</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Raise a ticket</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Kind</Label>
              <Select value={form.kind}
                onValueChange={v => setForm(f => ({ ...f, kind: v, milestone_id: v === 'rework' ? f.milestone_id : '' }))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="request">Request</SelectItem>
                  {canRework && <SelectItem value="rework">Rework</SelectItem>}
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
          {form.kind === 'rework' && (
            <div className="flex flex-col gap-1.5">
              <Label>Milestone</Label>
              <Select value={form.milestone_id} disabled={!form.to_department}
                onValueChange={v => setForm(f => ({ ...f, milestone_id: v }))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={form.to_department ? 'Which milestone?' : 'Pick a department first'} />
                </SelectTrigger>
                <SelectContent>
                  {reworkOptions.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.milestone_label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>Title</Label>
            <Input value={form.title} onChange={set('title')} placeholder="Short summary" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Details</Label>
            <Textarea rows={2} value={form.body} onChange={set('body')} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Due date</Label>
            <Input type="date" value={form.due_date} onChange={set('due_date')} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={busy} onClick={submit}>{busy ? 'Raising…' : 'Raise ticket'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function TicketsPanel({
  tickets = [], department = null, projectId = null, milestones = [], canRaise = false, showDepartment = false,
  title = 'Tickets',
}) {
  const router = useRouter();
  const today = todayISO();

  async function toggle(t) {
    try {
      await api(`/api/tickets/${t.id}`, { method: 'PATCH', body: { status: t.status === 'done' ? 'open' : 'done' } });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {canRaise && (
          <CardAction><RaiseTicketDialog department={department} projectId={projectId} milestones={milestones} router={router} /></CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {tickets.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing here yet.</p>
        )}
        {tickets.map(t => {
          const overdue = t.status === 'open' && t.due_date && t.due_date < today;
          const deptText = showDepartment
            ? `${t.from_department || '—'} → ${t.to_department}`
            : (t.from_department && `from ${t.from_department}`);
          // Subtitle is project (linked) + department context + milestone, joined with " · " —
          // built as an array of nodes rather than a string so the project link survives.
          const subtitle = [
            t.project_id && <Link key="p" href={`/projects/${t.project_id}`} className="text-primary hover:underline">{t.project_no}</Link>,
            deptText,
            t.milestone_label,
          ].filter(Boolean);
          return (
            <div key={t.id} className="flex items-center gap-3 py-2.5 text-sm">
              <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', KIND_TONE[t.kind])}>
                {KIND_LABEL[t.kind] || t.kind}
              </span>
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
