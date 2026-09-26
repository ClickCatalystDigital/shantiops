'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { formatDate } from '@/lib/format';
import { todayISO } from '@/lib/date';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem,
} from '@/components/ui/select';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { PlusIcon, HouseIcon, ClipboardListIcon, UsersIcon, HardHatIcon, PackageCheckIcon, ClipboardCheckIcon } from 'lucide-react';
import WorkspaceSidebar from '@/components/WorkspaceSidebar';
import JobSheetBoard from '@/components/JobSheetBoard';
import QuickAddInline from '@/components/QuickAddInline';
import { PreDispatchApprovalsPanel } from '@/components/MaterialApprovalPanels';
import MaterialIndentWorklist from '@/components/MaterialIndentWorklist';

// Renamed from "Workers" to "Job Card" (PRODUCTION-MODULE-DESIGN.md §3.1 nav decision) — job cards
// get touched far more often per day than the roster/attendance sub-tabs, so work planning is the
// default landing view and people-admin moves underneath it, not the reverse. The workspace itself
// is renamed again, top-level only, from "Job Card" to "Production" (2026-08-19) — Work Orders/
// BOM/Forecast/Daily Sheet/Workers Roster all live here too now, so the workspace name needs to
// cover the whole thing; Job Card stays exactly as it was, just as the default sub-tab, same
// "workspace name ≠ default sub-tab" shape every other department tab already has.
const WORKSPACE_TABS = ['jobcards', 'indent', 'sheet', 'approvals'];

export default function WorkersPanel({ date, sheet, workers, projects, trades, jobCards, operations, workstations, preDispatchApprovals = [], canDecideProduction = false }) {
  // Operations' Production pipeline glance (ProductionFlow.jsx) links a stage straight into a
  // specific sub-tab (and, for Work Orders, a specific status) — read once off the URL the same way
  // DepartmentHelpWorkspace.jsx already does for its own ?dept=&page=, not a new pattern.
  const searchParams = useSearchParams();
  const urlTab = searchParams.get('tab');
  const [tab, setTab] = useState(WORKSPACE_TABS.includes(urlTab) ? urlTab : 'jobcards');
  // Sidebar order: Work Orders first (the production-order control view), Job Card second (its
  // execution sub-tab) — Forecast/Daily Sheet/Workers Roster stay separate operational tools, not
  // folded into the Work Order/Job Card workflow (2026-08-19 UX refinement).
  const navItems = [
    { key: 'jobcards', label: 'Job Card', icon: HardHatIcon },
    // Material Indent bridge — the cross-project worklist of material Stores has routed here,
    // ready to indent (plan §9). Separate from "BOM"'s own per-project single-line raise form,
    // which stays exactly as it was.
    { key: 'indent', label: 'Material Indent', icon: PackageCheckIcon },
    { key: 'sheet', label: 'Workers', icon: UsersIcon },
    // Inward + Pre-Dispatch QC/Production Approval Workflow — Production's own department-local
    // slice (the retired top-level /material-review page). Only Pre-Dispatch, never Inward — that
    // half is QC-only. No shared cross-department page, per direct instruction.
    { key: 'approvals', label: 'Approvals', icon: ClipboardCheckIcon },
  ];

  return (
    <WorkspaceSidebar title="Shop Floor" icon={HardHatIcon} items={navItems} activeKey={tab} onChange={setTab}>
      {tab === 'jobcards' && (
        <JobSheetBoard workers={workers} projects={projects} canProduction canQc={false} />
      )}
      {tab === 'indent' && <MaterialIndentWorklist />}
      {tab === 'sheet' && <DailySheetWorkspace date={date} sheet={sheet} projects={projects} workers={workers} trades={trades} />}
      {tab === 'approvals' && (
        <PreDispatchApprovalsPanel rows={preDispatchApprovals} canDecideQc={false} canDecideProduction={canDecideProduction} />
      )}
    </WorkspaceSidebar>
  );
}



// Overview (headcount/attendance stats) + Sheet (the marking form) as one Daily Sheet workspace
// with a nested sub-sidebar (components/WorkspaceSidebar's `nested` mode — same pattern Payroll
// uses inside HR), instead of two competing top-level tabs.
function DailySheetWorkspace({ date, sheet, projects, workers, trades }) {
  const [sub, setSub] = useState('overview');
  const subItems = [
    { key: 'overview', label: 'Overview', icon: HouseIcon },
    { key: 'sheet', label: 'Sheet', icon: ClipboardListIcon },
    { key: 'roster', label: 'Workers Roster', icon: UsersIcon },
  ];
  return (
    <WorkspaceSidebar title="Workers" icon={UsersIcon} items={subItems} activeKey={sub} onChange={setSub} nested>
      {sub === 'overview' && <WorkersHome date={date} sheet={sheet} />}
      {sub === 'sheet' && <DailySheet date={date} rows={sheet} projects={projects} />}
      {sub === 'roster' && <Roster workers={workers} trades={trades} />}
    </WorkspaceSidebar>
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
          onChange={e => e.target.value && router.push(`/production/shop?date=${e.target.value}`)} />
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
      ? { ...next, project_id: '', milestone_id: '', notes: '', work_allocated: '' }
      : next;
    setForm(cleaned);
    if (!cleaned.status) return; // nothing to record until attendance is marked
    try {
      await api('/api/production/worker-days', {
        method: 'POST',
        body: {
          employee_id: row.id,
          date,
          status: cleaned.status,
          project_id: cleaned.project_id ? Number(cleaned.project_id) : null,
          milestone_id: cleaned.milestone_id ? Number(cleaned.milestone_id) : null,
          notes: cleaned.notes || null,
          work_allocated: cleaned.work_allocated || null,
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
          </div>
        )}
        {form.status && !absent && (
          <div className="flex flex-wrap items-center gap-2">
            <Input placeholder="Work allocated (morning)" value={form.work_allocated} className="min-w-48 flex-1"
              onChange={e => setForm({ ...form, work_allocated: e.target.value })}
              onBlur={() => form.work_allocated !== (row.work_allocated || '') && save(form)} />
            <Input placeholder="Work done" value={form.notes} className="min-w-48 flex-1"
              onChange={e => setForm({ ...form, notes: e.target.value })}
              onBlur={() => form.notes !== (row.notes || '') && save(form)} />
            {!form.notes && row.suggested_work && (
              <button type="button" className="rounded-full border px-2.5 py-1 text-xs text-primary hover:bg-primary/5"
                title="From the job card — click to use as Work done"
                onClick={() => save({ ...form, notes: row.suggested_work })}>
                From job card: {row.suggested_work}
              </button>
            )}
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
    work_allocated: row.work_allocated || '',
  };
}

/* ---------------- Roster ---------------- */

function Roster({ workers, trades }) {
  const router = useRouter();

  async function toggleActive(w) {
    try {
      await api(`/api/production/shop/${w.id}`, { method: 'PATCH', body: { active: !w.active } });
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end"><AddWorkerDialog router={router} trades={trades} /></div>
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
                <RosterRow key={w.id} w={w} router={router} trades={trades} onToggle={() => toggleActive(w)} />
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}
    </div>
  );
}

// Name edits in place, saving on blur — a typo'd worker name is otherwise unfixable, since workers
// are never deleted. Trade is a Select against the Production-owned `trades` master, not free
// text (PRODUCTION-MODULE-DESIGN.md §3.2) — job cards will filter workers by this value.
function RosterRow({ w, router, trades, onToggle }) {
  const [name, setName] = useState(w.name);
  useEffect(() => { setName(w.name); }, [w.id, w.name]);

  async function saveField(field, value) {
    try {
      await api(`/api/production/shop/${w.id}`, { method: 'PATCH', body: { [field]: value } });
      router.refresh();
    } catch (err) {
      if (field === 'name') setName(w.name); // roll back to the server's value
      showToast(err.message, 'error');
    }
  }

  function saveName() {
    const value = name.trim();
    if (value === (w.name || '')) return; // untouched
    if (!value) { setName(w.name); return showToast('Name cannot be empty', 'error'); }
    saveField('name', value);
  }

  return (
    <TableRow className={cn(!w.active && 'opacity-50')}>
      <TableCell>
        <Input value={name} aria-label={`Name for ${w.name}`}
          className="h-8 border-transparent bg-transparent px-1 font-medium hover:border-input focus:border-input"
          onChange={e => setName(e.target.value)}
          onBlur={saveName} />
      </TableCell>
      <TableCell>
        <Select value={w.trade || ''} onValueChange={v => saveField('trade', v)}>
          <SelectTrigger className="h-8 w-40 border-transparent bg-transparent px-1 text-muted-foreground hover:border-input"
            aria-label={`Trade for ${w.name}`}>
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {trades.map(t => <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>)}
            </SelectGroup>
          </SelectContent>
        </Select>
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

// Search HR first, create only if nothing matches — a Production head who typed a name straight
// into a create form is exactly how the same person ends up as two rows (see
// PRODUCTION-MODULE-DESIGN.md §2.5). A 'worker'-type match can be activated onto the Production
// roster directly; a 'staff' match is shown but not selectable — reassigning a staff record into
// Production is an HR decision, not a one-click floor action (enforced again server-side).
function AddWorkerDialog({ router, trades: initialTrades }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null); // null = no search run yet
  const [trades, setTrades] = useState(initialTrades);
  const [trade, setTrade] = useState('');
  const [createMode, setCreateMode] = useState(false);
  const [createName, setCreateName] = useState('');

  function reset() {
    setQuery(''); setResults(null); setTrade(''); setCreateMode(false); setCreateName('');
  }

  async function search() {
    if (!query.trim()) return;
    setSearching(true);
    try {
      setResults(await api(`/api/production/shop?search=${encodeURIComponent(query.trim())}`));
      setCreateMode(false);
    } catch (err) { showToast(err.message, 'error'); }
    setSearching(false);
  }

  async function activate(employeeId) {
    setBusy(true);
    try {
      await api('/api/production/shop', { method: 'POST', body: { employee_id: employeeId, trade: trade || null } });
      showToast('Worker added to Production roster');
      setOpen(false); reset(); router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  async function createNew() {
    if (!createName.trim()) return showToast('Worker name is required', 'error');
    setBusy(true);
    try {
      await api('/api/production/shop', { method: 'POST', body: { name: createName.trim(), trade: trade || null } });
      showToast('Worker added');
      setOpen(false); reset(); router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm"><PlusIcon data-icon="inline-start" />Add worker</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add worker</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Search HR first — this person may already have an employee record.</p>
          <div className="flex gap-2">
            <Input placeholder="Name or employee code" value={query} aria-label="Search HR"
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search(); } }} />
            <Button type="button" variant="outline" onClick={search} disabled={searching || !query.trim()}>
              {searching ? 'Searching…' : 'Search'}
            </Button>
          </div>

          {results !== null && (
            <div className="flex flex-col gap-2">
              {results.length === 0 && <p className="text-sm text-muted-foreground">No matches.</p>}
              {results.map(r => (
                <div key={r.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                  <div className="flex flex-col">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {r.employee_code} · {r.employee_type === 'worker' ? (r.trade || 'no trade set') : 'HR staff'}
                      {r.department && r.department !== 'Production' ? ` · ${r.department}` : ''}
                    </span>
                  </div>
                  {r.employee_type === 'worker'
                    ? <Button size="sm" onClick={() => activate(r.id)} disabled={busy}>Add to roster</Button>
                    : <Badge variant="outline">Ask HR</Badge>}
                </div>
              ))}
              {!createMode && (
                <Button type="button" variant="link" className="h-auto self-start p-0" onClick={() => setCreateMode(true)}>
                  Can't find them — add as a new person
                </Button>
              )}
            </div>
          )}

          {(results !== null && (createMode || results.some(r => r.employee_type === 'worker'))) && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="w-trade">Trade</Label>
                <QuickAddInline endpoint="/api/trades" placeholder="New trade name"
                  onAdded={t => { setTrades([...trades, t]); setTrade(t.name); }} />
              </div>
              <Select value={trade} onValueChange={setTrade}>
                <SelectTrigger id="w-trade"><SelectValue placeholder="Select a trade" /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {trades.map(t => <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          )}

          {createMode && (
            <div className="flex flex-col gap-1.5 border-t pt-3">
              <Label htmlFor="w-name">Name</Label>
              <Input id="w-name" value={createName} onChange={e => setCreateName(e.target.value)} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          {createMode && <Button onClick={createNew} disabled={busy}>{busy ? 'Adding…' : 'Add as new'}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
