'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { formatDate } from '@/lib/format';
import { todayISO } from '@/lib/date';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem,
} from '@/components/ui/select';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { PlusIcon } from 'lucide-react';

export default function WorkersPanel({ date, sheet, workers, projects }) {
  return (
    <Tabs defaultValue="home" className="flex-col gap-4">
      {/* flex-col + the border-b wrapper: the ui component's data-horizontal variant relies on a
          shadcn CSS import this repo doesn't use (same note as ProjectDepartmentTabs). */}
      <div className="overflow-x-auto border-b">
        <TabsList variant="line" className="w-max justify-start px-0">
          <TabsTrigger value="home" className="flex-none px-3 py-2">Home</TabsTrigger>
          <TabsTrigger value="sheet" className="flex-none px-3 py-2">Daily sheet</TabsTrigger>
          <TabsTrigger value="roster" className="flex-none px-3 py-2">Workers roster</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="home">
        <WorkersHome date={date} sheet={sheet} />
      </TabsContent>
      <TabsContent value="sheet">
        <DailySheet date={date} rows={sheet} projects={projects} />
      </TabsContent>
      <TabsContent value="roster">
        <Roster workers={workers} />
      </TabsContent>
    </Tabs>
  );
}

/* ---------------- Home ---------------- */

// Headcount + today's attendance only — real numbers straight off the daily sheet, nothing
// invented. No capacity/idle-time metrics: those need instrumentation this app doesn't have yet.
function WorkersHome({ date, sheet }) {
  const headcount = sheet.length;
  const present = sheet.filter(r => r.status === 'present').length;
  const half = sheet.filter(r => r.status === 'half').length;
  const absent = sheet.filter(r => r.status === 'absent').length;
  const unmarked = sheet.filter(r => !r.status).length;
  const attendancePct = headcount ? Math.round(((present + half * 0.5) / headcount) * 100) : 0;
  const attendanceLabel = date === todayISO() ? "Today's attendance" : `Attendance · ${formatDate(date)}`;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card><CardContent className="flex flex-col gap-1 py-6">
        <span className="text-sm text-muted-foreground">Headcount</span>
        <span className="text-3xl font-bold tnum">{headcount}</span>
        <span className="text-xs text-muted-foreground">active workers</span>
      </CardContent></Card>
      <Card><CardContent className="flex flex-col gap-1 py-6">
        <span className="text-sm text-muted-foreground">{attendanceLabel}</span>
        <span className="text-3xl font-bold tnum">{headcount ? `${attendancePct}%` : '—'}</span>
        <span className="text-xs text-muted-foreground tnum">
          {present} present · {half} half day · {absent} absent · {unmarked} unmarked
        </span>
      </CardContent></Card>
    </div>
  );
}

/* ---------------- Daily sheet ---------------- */

function DailySheet({ date, rows, projects }) {
  const router = useRouter();
  const count = s => rows.filter(r => r.status === s).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input type="date" value={date} className="w-44" aria-label="Sheet date"
          onChange={e => e.target.value && router.push(`/production/workers?date=${e.target.value}`)} />
        <p className="text-sm text-muted-foreground tnum">
          {count('present')} present · {count('half')} half day · {count('absent')} absent ·{' '}
          {rows.filter(r => !r.status).length} unmarked
        </p>
      </div>
      {rows.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          No active workers — add them in the Workers roster tab.
        </CardContent></Card>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map(row => <WorkerCard key={row.id} row={row} date={date} projects={projects} />)}
        </div>
      )}
    </div>
  );
}

function WorkerCard({ row, date, projects }) {
  const router = useRouter();
  const [form, setForm] = useState(stateOf(row));

  // Re-sync only when the worker or the day changes — otherwise yesterday's answers linger in
  // today's inputs. Deliberately NOT keyed on the individual fields: every select fires a save +
  // router.refresh(), and re-seeding from the server on each one would clobber whatever the user
  // is typing in the notes box at that moment. save() keeps local state correct in the meantime.
  useEffect(() => { setForm(stateOf(row)); }, [row.id, date]);

  // Always POST the whole row: the upsert overwrites every column, so a partial body would wipe
  // whatever it omitted (see app/api/production/worker-days).
  async function save(next) {
    // Absent means no work to record, and the server nulls those columns — mirror that locally so
    // the form can't show values the DB doesn't have (we no longer re-seed from the server).
    const cleaned = next.status === 'absent'
      ? { ...next, project_id: '', milestone_id: '', notes: '' }
      : next;
    setForm(cleaned);
    if (!cleaned.status) return; // nothing to record until attendance is marked
    try {
      await api('/api/production/worker-days', {
        method: 'POST',
        body: {
          worker_id: row.id,
          date,
          status: cleaned.status,
          project_id: cleaned.project_id ? Number(cleaned.project_id) : null,
          milestone_id: cleaned.milestone_id ? Number(cleaned.milestone_id) : null,
          notes: cleaned.notes || null,
        },
      });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  const absent = form.status === 'absent';
  const project = projects.find(p => String(p.id) === String(form.project_id));

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="min-w-32 font-medium">{row.name}</span>
          <span className="text-xs text-muted-foreground">{row.trade || '—'}</span>
          <div className="ml-auto">
            <Select value={form.status} onValueChange={v => save({ ...form, status: v })}>
              <SelectTrigger className="w-32" aria-label={`Attendance for ${row.name}`}>
                <SelectValue placeholder="Mark…" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="present">Present</SelectItem>
                  <SelectItem value="half">Half day</SelectItem>
                  <SelectItem value="absent">Absent</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>

        {form.status && !absent && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <Select value={form.project_id}
              onValueChange={v => save({ ...form, project_id: v, milestone_id: '' })}>
              <SelectTrigger className="w-44" aria-label="Project"><SelectValue placeholder="Project" /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {projects.map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.project_no} · {p.customer_name}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select value={form.milestone_id} disabled={!project}
              onValueChange={v => save({ ...form, milestone_id: v })}>
              <SelectTrigger className="w-48" aria-label="Milestone">
                <SelectValue placeholder={project ? 'Milestone' : 'Pick a project first'} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {(project?.milestones || []).map(m => (
                    <SelectItem key={m.id} value={String(m.id)}>{m.label}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Input placeholder="What they worked on today" value={form.notes} className="min-w-48 flex-1"
              onChange={e => setForm({ ...form, notes: e.target.value })}
              onBlur={() => form.notes !== (row.notes || '') && save(form)} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function stateOf(row) {
  return {
    status: row.status || '',
    project_id: row.project_id ? String(row.project_id) : '',
    milestone_id: row.milestone_id ? String(row.milestone_id) : '',
    notes: row.notes || '',
  };
}

/* ---------------- Roster ---------------- */

function Roster({ workers }) {
  const router = useRouter();

  async function toggleActive(w) {
    try {
      await api(`/api/production/workers/${w.id}`, { method: 'PATCH', body: { active: !w.active } });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end"><AddWorkerDialog router={router} /></div>
      {workers.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          No workers yet — add the first one.
        </CardContent></Card>
      ) : (
        <Card><CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Trade</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workers.map(w => (
                <RosterRow key={w.id} w={w} router={router} onToggle={() => toggleActive(w)} />
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}
    </div>
  );
}

// Name and trade edit in place, saving on blur — a typo'd worker name is otherwise unfixable,
// since workers are never deleted.
function RosterRow({ w, router, onToggle }) {
  const [edit, setEdit] = useState({ name: w.name, trade: w.trade || '' });
  useEffect(() => { setEdit({ name: w.name, trade: w.trade || '' }); }, [w.id, w.name, w.trade]);

  async function saveField(field) {
    const value = edit[field].trim();
    if (value === (w[field] || '')) return;              // untouched
    if (field === 'name' && !value) {                     // don't let a name be blanked
      setEdit(e => ({ ...e, name: w.name }));
      return showToast('Name cannot be empty', 'error');
    }
    try {
      await api(`/api/production/workers/${w.id}`, { method: 'PATCH', body: { [field]: value } });
      router.refresh();
    } catch (err) {
      setEdit(e => ({ ...e, [field]: w[field] || '' }));  // roll back to the server's value
      showToast(err.message, 'error');
    }
  }

  return (
    <TableRow className={cn(!w.active && 'opacity-50')}>
      <TableCell>
        <Input value={edit.name} aria-label={`Name for ${w.name}`}
          className="h-8 border-transparent bg-transparent px-1 font-medium hover:border-input focus:border-input"
          onChange={e => setEdit({ ...edit, name: e.target.value })}
          onBlur={() => saveField('name')} />
      </TableCell>
      <TableCell>
        <Input value={edit.trade} placeholder="—" aria-label={`Trade for ${w.name}`}
          className="h-8 border-transparent bg-transparent px-1 text-muted-foreground hover:border-input focus:border-input"
          onChange={e => setEdit({ ...edit, trade: e.target.value })}
          onBlur={() => saveField('trade')} />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          {!w.active && <Badge variant="outline">Inactive</Badge>}
          <Button variant="ghost" size="sm" onClick={onToggle}>
            {w.active ? 'Deactivate' : 'Reactivate'}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function AddWorkerDialog({ router }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', trade: '' });

  async function submit() {
    if (!form.name.trim()) return showToast('Worker name is required', 'error');
    setBusy(true);
    try {
      await api('/api/production/workers', { method: 'POST', body: form });
      showToast('Worker added');
      setForm({ name: '', trade: '' });
      setOpen(false);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><PlusIcon data-icon="inline-start" />Add worker</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add worker</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="w-name">Name</Label>
            <Input id="w-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="w-trade">Trade</Label>
            <Input id="w-trade" placeholder="Welder, Fitter, Helper…" value={form.trade}
              onChange={e => setForm({ ...form, trade: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? 'Adding…' : 'Add worker'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
