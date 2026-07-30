'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { formatDate } from '@/lib/format';
import { toISODate, monthGridDays, shiftMonth } from '@/lib/date';
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
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, FolderKanbanIcon } from 'lucide-react';

// The month cursor lives in the URL (?month=), not in state — this repo reads on the server, so
// navigating re-renders with fresh data instead of us hand-rolling a fetch layer.
export default function ProductionToday({ month, today, events, openTasks, operators }) {
  const router = useRouter();
  const [dayOpen, setDayOpen] = useState(null);
  const [newTask, setNewTask] = useState({ title: '', due_date: today, assigned_to: '' });
  const [busy, setBusy] = useState(false);

  const gridDays = useMemo(() => monthGridDays(month), [month]);
  const cursorMonth = Number(month.split('-')[1]) - 1;

  const byDate = useMemo(() => {
    const map = {};
    const add = (date, item) => { if (date) (map[date] ||= []).push(item); };
    for (const t of events.tasks) add(t.date, { ...t, kind: 'task' });
    for (const m of events.milestones) add(m.date, { ...m, kind: 'milestone' });
    return map;
  }, [events]);

  async function addTask() {
    if (!newTask.title.trim()) return;
    setBusy(true);
    try {
      await api('/api/production/tasks', {
        method: 'POST',
        body: {
          title: newTask.title,
          due_date: newTask.due_date,
          assigned_to: newTask.assigned_to || undefined,
        },
      });
      setNewTask({ title: '', due_date: today, assigned_to: '' });
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

  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', {
    month: 'long', year: 'numeric',
  });

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Calendar */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>{monthLabel}</CardTitle>
          <CardAction>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" aria-label="Previous month"
                onClick={() => router.push(`/production?month=${shiftMonth(month, -1)}`)}>
                <ChevronLeftIcon />
              </Button>
              <Button variant="outline" size="sm" onClick={() => router.push('/production')}>Today</Button>
              <Button variant="ghost" size="icon-sm" aria-label="Next month"
                onClick={() => router.push(`/production?month=${shiftMonth(month, 1)}`)}>
                <ChevronRightIcon />
              </Button>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          {/* gap-px over a bg-border parent paints hairline gridlines between bg-background cells. */}
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
              <div key={d} className="bg-muted px-1 py-1.5 text-center text-xs font-medium text-muted-foreground">{d}</div>
            ))}
            {gridDays.map(d => {
              const iso = toISODate(d);
              const inMonth = d.getMonth() === cursorMonth;
              const items = byDate[iso] || [];
              return (
                <button key={iso} onClick={() => items.length && setDayOpen(iso)}
                  className={cn('flex min-h-20 flex-col items-stretch gap-0.5 bg-background p-1 text-left transition-colors',
                    !inMonth && 'opacity-40', items.length && 'cursor-pointer hover:bg-muted')}>
                  <span className={cn('self-end rounded-full px-1.5 text-xs tnum',
                    iso === today ? 'bg-primary font-semibold text-primary-foreground' : 'text-muted-foreground')}>
                    {d.getDate()}
                  </span>
                  {items.slice(0, 3).map((it, i) => (
                    <span key={i} className={cn('truncate rounded px-1 text-[10px] leading-4',
                      it.kind === 'task' && (it.status === 'done'
                        ? 'bg-muted text-muted-foreground line-through'
                        : 'bg-primary/15 text-primary'),
                      it.kind === 'milestone' && 'bg-amber-500/15 text-amber-700 dark:text-amber-400')}>
                      {it.title}
                    </span>
                  ))}
                  {items.length > 3 && (
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
        </CardContent>
      </Card>

      {/* Today & overdue */}
      <Card>
        <CardHeader>
          <CardTitle>Today &amp; overdue</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Input placeholder="New task…" value={newTask.title} className="min-w-32 flex-1"
              onChange={e => setNewTask({ ...newTask, title: e.target.value })}
              onKeyDown={e => e.key === 'Enter' && addTask()} />
            <Input type="date" value={newTask.due_date} className="w-36 shrink-0"
              onChange={e => setNewTask({ ...newTask, due_date: e.target.value })} />
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
                <div key={t.id} className="flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-muted">
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
                {it.kind === 'task' ? (
                  <>
                    <Checkbox checked={it.status === 'done'}
                      onCheckedChange={() => { toggleTask(it); setDayOpen(null); }} />
                    <span className={cn('min-w-0 flex-1 truncate', it.status === 'done' && 'text-muted-foreground line-through')}>
                      {it.title}
                    </span>
                    {it.assigned_to && <Badge variant="secondary" className="shrink-0">{it.assigned_to}</Badge>}
                  </>
                ) : (
                  <>
                    <FolderKanbanIcon className="size-4 shrink-0 text-amber-600" />
                    <span className="min-w-0 flex-1 truncate">{it.title}</span>
                    <Link href={`/projects/${it.project_id}`} className="shrink-0 text-xs text-primary hover:underline">
                      {it.project_no}
                    </Link>
                  </>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
