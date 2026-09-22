'use client';

import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { formatDate } from '@/lib/format';
import {
  toISODate, monthGridDays, shiftMonth, weekDays, shiftWeek, yearMonths,
} from '@/lib/date';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardHeader, CardTitle, CardAction, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem,
} from '@/components/ui/select';
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, FolderKanbanIcon, UsersRoundIcon } from 'lucide-react';
import { Label } from '@/components/ui/label';

// The view + its cursor live in the URL (?view=&month=/date=/year=), not in state — this repo
// reads on the server, so navigating re-renders with fresh data instead of us hand-rolling a
// fetch layer. Each view keeps its own cursor param so switching views and back doesn't lose it.
export default function ProductionToday({
  view, month, date, year, today, deptFilter, deptsToShow, events, openTasks, operators,
}) {
  const router = useRouter();
  const [dayOpen, setDayOpen] = useState(null);
  const [newTask, setNewTask] = useState({ title: '', due_date: today, assigned_to: '', department: deptsToShow[0] || '' });
  const [busy, setBusy] = useState(false);
  const [expenseDate, setExpenseDate] = useState(null); // Sales CRM expansion Phase 4 — "Add Expenses"
  const combined = deptsToShow.length > 1;

  // Month/Week share one grid renderer (7 columns); Year gets its own 12-mini-month block below.
  const gridDays = useMemo(() => (view === 'week' ? weekDays(date) : monthGridDays(month)), [view, date, month]);
  const cursorMonth = Number(month.split('-')[1]) - 1;

  // Sales CRM expansion Phase 4 — Diary follow-ups due on a day join the same merged map, tagged
  // kind:'followup'. deptsToShow.includes('Sales'|'Marketing') is what actually gates whether
  // events.followups has any rows at all (getDepartmentCalendar), so this stays a no-op for every
  // other department's calendar.
  const byDate = useMemo(() => {
    const map = {};
    const add = (date, item) => { if (date) (map[date] ||= []).push(item); };
    for (const t of events.tasks) add(t.date, { ...t, kind: 'task' });
    for (const m of events.milestones) add(m.date, { ...m, kind: 'milestone' });
    for (const f of events.followups || []) add(f.date, { ...f, kind: 'followup' });
    return map;
  }, [events]);
  const showsCrm = deptsToShow.includes('Sales') || deptsToShow.includes('Marketing');

  // A combined multi-department view needs each pill to say which department it's from.
  function pillText(it) {
    const prefix = combined && it.department ? `[${it.department}] ` : '';
    if (it.kind === 'milestone') return `${prefix}${it.project_no} · ${it.title}`;
    if (it.kind === 'followup') return `${prefix}${it.company_name || it.lead_name}${it.plan_time ? ` · ${it.plan_time}` : ''}`;
    return `${prefix}${it.title}`;
  }

  // Jump to "today" — in whichever view is passed, defaulting to the currently active one. Used
  // both by the Today control (current view) and the Month/Week/Year switcher (target view).
  // deptFilter carries through every navigation so switching Month/Week/Year doesn't drop it.
  const deptQS = deptFilter ? `&dept=${deptFilter}` : '';
  function hrefForToday(v = view) {
    if (v === 'week') return `/production?view=week&date=${today}${deptQS}`;
    if (v === 'year') return `/production?view=year&year=${today.slice(0, 4)}${deptQS}`;
    return `/production?view=month&month=${today.slice(0, 7)}${deptQS}`;
  }
  function hrefForPrev() {
    if (view === 'week') return `/production?view=week&date=${shiftWeek(date, -1)}${deptQS}`;
    if (view === 'year') return `/production?view=year&year=${year - 1}${deptQS}`;
    return `/production?view=month&month=${shiftMonth(month, -1)}${deptQS}`;
  }
  function hrefForNext() {
    if (view === 'week') return `/production?view=week&date=${shiftWeek(date, 1)}${deptQS}`;
    if (view === 'year') return `/production?view=year&year=${year + 1}${deptQS}`;
    return `/production?view=month&month=${shiftMonth(month, 1)}${deptQS}`;
  }

  const cursorLabel = useMemo(() => {
    if (view === 'week') {
      const days = weekDays(date);
      const start = days[0].toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
      const end = days[6].toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });
      return `${start} – ${end}`;
    }
    if (view === 'year') return String(year);
    return new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  }, [view, date, month, year]);

  async function addTask() {
    // Single-dept view hides the picker, so newTask.department can be stale from a previous
    // combined view (component stays mounted across a client-side dept-tab switch — its useState
    // default only ran once, on first mount). Not combined -> always the one dept being shown.
    const department = combined ? newTask.department : deptsToShow[0];
    if (!newTask.title.trim() || !department) return;
    setBusy(true);
    try {
      await api('/api/production/tasks', {
        method: 'POST',
        body: {
          title: newTask.title,
          due_date: newTask.due_date,
          department,
          assigned_to: newTask.assigned_to || undefined,
        },
      });
      setNewTask({ title: '', due_date: today, assigned_to: '', department: deptsToShow[0] || '' });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  async function toggleTask(t) {
    try {
      await api(`/api/production/tasks/${t.id}`, {
        method: 'PATCH',
        body: { status: t.status === 'done' ? 'open' : 'done' },
      });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Calendar */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>{cursorLabel}</CardTitle>
          <CardAction>
            <div className="flex flex-wrap items-center gap-1">
              <Button variant="ghost" size="icon-sm" aria-label="Previous" onClick={() => router.push(hrefForPrev())}>
                <ChevronLeftIcon />
              </Button>
              <Button variant="outline" size="sm" onClick={() => router.push(hrefForToday())}>Today</Button>
              <Button variant="ghost" size="icon-sm" aria-label="Next" onClick={() => router.push(hrefForNext())}>
                <ChevronRightIcon />
              </Button>
              <div className="ml-1 flex items-center rounded-md border p-0.5">
                {['month', 'week', 'year'].map(v => (
                  <Button key={v} variant={v === view ? 'secondary' : 'ghost'} size="sm"
                    className="h-7 px-2 capitalize" onClick={() => router.push(hrefForToday(v))}>
                    {v}
                  </Button>
                ))}
              </div>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          {view === 'year' ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {yearMonths(year).map(m => {
                const mDays = monthGridDays(m);
                const mNum = Number(m.split('-')[1]) - 1;
                const mLabel = new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short' });
                return (
                  <button key={m} onClick={() => router.push(`/production?view=month&month=${m}${deptQS}`)}
                    className="flex flex-col gap-1.5 rounded-lg border p-2 text-left hover:bg-muted">
                    <span className="text-xs font-medium">{mLabel}</span>
                    <div className="grid grid-cols-7 gap-0.5">
                      {mDays.map(d => {
                        const iso = toISODate(d);
                        const inMonth = d.getMonth() === mNum;
                        const count = (byDate[iso] || []).length;
                        return (
                          <span key={iso}
                            className={cn('aspect-square rounded-[2px]',
                              !inMonth && 'opacity-0',
                              iso === today && 'ring-1 ring-primary',
                              count === 0 ? 'bg-muted' : count === 1 ? 'bg-primary/30' : count === 2 ? 'bg-primary/55' : 'bg-primary/80')} />
                        );
                      })}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
          <>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
              <div key={d} className="bg-muted px-1 py-1.5 text-center text-xs font-medium text-muted-foreground">{d}</div>
            ))}
            {gridDays.map(d => {
              const iso = toISODate(d);
              const inMonth = view !== 'month' || d.getMonth() === cursorMonth;
              const items = byDate[iso] || [];
              const isWeek = view === 'week';
              const shown = isWeek ? items : items.slice(0, 3);
              return (
                <button key={iso} onClick={() => items.length && setDayOpen(iso)}
                  className={cn('flex flex-col items-stretch gap-1.5 bg-background p-2 text-left transition-colors',
                    isWeek ? 'min-h-[26rem]' : 'min-h-20 gap-0.5 p-1',
                    isWeek && iso === today && 'ring-2 ring-inset ring-primary',
                    !inMonth && 'opacity-40', items.length && 'cursor-pointer hover:bg-muted')}>
                  <span className={cn(isWeek
                    ? 'self-start text-base font-bold tnum'
                    : 'self-end rounded-full px-1.5 text-xs tnum',
                    !isWeek && iso === today && 'bg-primary font-semibold text-primary-foreground',
                    !isWeek && iso !== today && 'text-muted-foreground')}>
                    {d.getDate()}
                  </span>
                  {shown.map((it, i) => (
                    <span key={i} className={cn(
                      isWeek ? 'truncate border-l-2 py-1 pl-2 text-xs leading-tight' : 'truncate rounded px-1 text-[10px] leading-4',
                      it.kind === 'task' && (it.status === 'done'
                        ? (isWeek ? 'border-muted-foreground/40 text-muted-foreground line-through' : 'bg-muted text-muted-foreground line-through')
                        : (isWeek ? 'border-primary text-foreground' : 'bg-primary/15 text-primary')),
                      it.kind === 'milestone' && (isWeek ? 'border-amber-500 text-foreground' : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'),
                      it.kind === 'followup' && (isWeek ? 'border-sky-500 text-foreground' : 'bg-sky-500/15 text-sky-700 dark:text-sky-400'))}>
                      {pillText(it)}
                    </span>
                  ))}
                  {!isWeek && items.length > 3 && (
                    <span className="px-1 text-[10px] text-muted-foreground">+{items.length - 3} more</span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-primary" />Tasks</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-amber-500" />Milestones</span>
          </div>
          </>
          )}
        </CardContent>
      </Card>

      {/* To dos */}
      <Card>
        <CardHeader>
          <CardTitle>Tasks</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Input placeholder="New task…" value={newTask.title} className="min-w-32 flex-1"
              onChange={e => setNewTask({ ...newTask, title: e.target.value })}
              onKeyDown={e => e.key === 'Enter' && addTask()} />
            <Input type="date" value={newTask.due_date} className="w-36 shrink-0"
              onChange={e => setNewTask({ ...newTask, due_date: e.target.value })} />
            {combined && (
              <Select value={newTask.department} onValueChange={v => setNewTask({ ...newTask, department: v })}>
                <SelectTrigger className="w-32 shrink-0" aria-label="Task department">
                  <SelectValue placeholder="Department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {deptsToShow.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
            )}
            <Select value={newTask.assigned_to} onValueChange={v => setNewTask({ ...newTask, assigned_to: v })}>
              <SelectTrigger className="w-36 shrink-0" aria-label="Assign new task to">
                <SelectValue placeholder="Assign to…" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {operators.map(o => (
                    <SelectItem key={o.id} value={o.username}>{o.display_name || o.username}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button size="icon" onClick={addTask} disabled={busy || !newTask.title.trim()} aria-label="Add task">
              <PlusIcon />
            </Button>
          </div>
          <div className="flex flex-col gap-1">
            {openTasks.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">All clear — nothing due.</p>
            )}
            {openTasks.map(t => {
              const overdue = t.due_date < today;
              return (
                <div key={`task-${t.id}`} className="flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-muted">
                  <Checkbox checked={t.status === 'done'} onCheckedChange={() => toggleTask(t)} />
                  <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                  {t.assigned_to && <Badge variant="secondary" className="shrink-0">{t.assigned_to}</Badge>}
                  <span className={cn('shrink-0 text-xs tnum',
                    overdue ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                    {overdue ? formatDate(t.due_date) : 'today'}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Day details */}
      <Dialog open={!!dayOpen} onOpenChange={o => !o && setDayOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{dayOpen ? formatDate(dayOpen) : ''}</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-2">
            {(byDate[dayOpen] || []).map((it, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                {it.kind === 'task' && (
                  <>
                    <Checkbox checked={it.status === 'done'}
                      onCheckedChange={() => { toggleTask(it); setDayOpen(null); }} />
                    <span className={cn('min-w-0 flex-1 truncate', it.status === 'done' && 'text-muted-foreground line-through')}>
                      {it.title}
                    </span>
                    {it.assigned_to && <Badge variant="secondary" className="shrink-0">{it.assigned_to}</Badge>}
                  </>
                )}
                {it.kind === 'milestone' && (
                  <>
                    <FolderKanbanIcon className="size-4 shrink-0 text-amber-600" />
                    <span className="min-w-0 flex-1 truncate">{it.title}</span>
                    <Link href={`/projects/${it.project_id}`} className="shrink-0 text-xs text-primary hover:underline">
                      {it.project_no}
                    </Link>
                  </>
                )}
                {it.kind === 'followup' && (
                  <div className="flex w-full flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <UsersRoundIcon className="size-4 shrink-0 text-sky-600" />
                      <span className="min-w-0 flex-1 truncate font-medium">{it.company_name || it.lead_name}</span>
                      {it.plan_time && <span className="shrink-0 text-xs tnum text-muted-foreground">{it.plan_time}</span>}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 pl-6 text-xs text-muted-foreground">
                      {(it.in_time || it.out_time) && <span>{[it.in_time, it.out_time].filter(Boolean).join(' – ')}</span>}
                      {it.location && <span>{it.location}</span>}
                      {it.plan_for && <span>For: {it.plan_for}</span>}
                      {it.note_type && <span>{it.note_type}</span>}
                    </div>
                    {(it.content || it.plan_of_action) && (
                      <p className="pl-6 text-xs text-muted-foreground">
                        {it.content ? `Objective: ${it.content}` : ''}{it.plan_of_action ? ` · Action: ${it.plan_of_action}` : ''}
                      </p>
                    )}
                    <div className="flex gap-1.5 pl-6 pt-1">
                      <Link href={`/sales?tab=enquiry&highlight=LD-${it.lead_id}&diary=now`}>
                        <Button size="sm" variant="outline">Update Now</Button>
                      </Link>
                      <Link href={`/sales?tab=enquiry&highlight=LD-${it.lead_id}&diary=advanced`}>
                        <Button size="sm" variant="outline">Advanced Update</Button>
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {(byDate[dayOpen] || []).length === 0 && <p className="py-2 text-center text-sm text-muted-foreground">Nothing scheduled.</p>}
          </div>
          {showsCrm && dayOpen && (
            <div className="flex flex-wrap gap-2 border-t pt-3">
              <Link href={`/sales?tab=enquiry`}><Button size="sm" variant="outline"><PlusIcon />New Enquiry</Button></Link>
              <Button size="sm" variant="outline" onClick={() => setExpenseDate(dayOpen)}>Add Expenses</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {expenseDate && <AddExpenseDialog date={expenseDate} onClose={() => setExpenseDate(null)} />}
    </div>
  );
}

// Home calendar's "Add Expenses" (Phase 4, Gap #9) — a real, scoped self-submission against the
// existing HR expense-claims module (app/api/expense-claims/route.js's own POST now resolves the
// caller's employee_id server-side for a non-HR user, never trusts one from the client). One line
// item is enough for a quick entry from the calendar; HR's own fuller multi-line claim UI is
// untouched and still the place for anything more involved.
function AddExpenseDialog({ date, onClose }) {
  const [types, setTypes] = useState([]);
  const [typeId, setTypeId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { api('/api/expense-claim-types').then(setTypes).catch(() => {}); }, []);

  async function save() {
    if (!(Number(amount) > 0)) return showToast('Amount must be a positive number', 'error');
    setSaving(true);
    try {
      await api('/api/expense-claims', { method: 'POST', body: {
        claim_date: date,
        items: [{ expense_claim_type_id: typeId || null, expense_date: date, amount: Number(amount), description: description.trim() || null }],
      } });
      showToast('Expense submitted');
      onClose();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Expenses — {formatDate(date)}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          {types.length > 0 && (
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <Select value={typeId} onValueChange={setTypeId}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>{types.map(t => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-1.5"><Label>Amount</Label><Input type="number" value={amount} onChange={e => setAmount(e.target.value)} autoFocus /></div>
          <div className="grid gap-1.5"><Label>Description</Label><Input value={description} onChange={e => setDescription(e.target.value)} /></div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Submitting…' : 'Submit'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
