'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { PlusIcon, HouseIcon, ClipboardListIcon, UsersIcon, HardHatIcon, PackageIcon, ScissorsIcon, TrashIcon, ClipboardIcon, TrendingUpIcon } from 'lucide-react';
import WorkspaceSidebar from '@/components/WorkspaceSidebar';
import JobCardBoard from '@/components/JobCardBoard';
import BomTable from '@/components/BomTable';
import { BOM_FIELD_OWNERS } from '@/lib/bom-fields.mjs';
import QuickAddInline from '@/components/QuickAddInline';
import WorkOrdersPanel from '@/components/WorkOrdersPanel';
import ProductionForecastPanel from '@/components/ProductionForecastPanel';
import CutDialog from '@/components/CutDialog';
import { DIMENSIONAL_CATEGORIES as SHAPE_CATEGORIES } from '@/lib/bom-fields.mjs';

// Renamed from "Workers" to "Job Card" (PRODUCTION-MODULE-DESIGN.md §3.1 nav decision) — job cards
// get touched far more often per day than the roster/attendance sub-tabs, so work planning is the
// default landing view and people-admin moves underneath it, not the reverse. The workspace itself
// is renamed again, top-level only, from "Job Card" to "Production" (2026-08-19) — Work Orders/
// BOM/Forecast/Daily Sheet/Workers Roster all live here too now, so the workspace name needs to
// cover the whole thing; Job Card stays exactly as it was, just as the default sub-tab, same
// "workspace name ≠ default sub-tab" shape every other department tab already has.
const WORKSPACE_TABS = ['jobcards', 'workorders', 'bom', 'forecast', 'sheet', 'roster'];

export default function WorkersPanel({ date, sheet, workers, projects, trades, jobCards, operations, workstations }) {
  // Operations' Production pipeline glance (ProductionFlow.jsx) links a stage straight into a
  // specific sub-tab (and, for Work Orders, a specific status) — read once off the URL the same way
  // DepartmentHelpWorkspace.jsx already does for its own ?dept=&page=, not a new pattern.
  const searchParams = useSearchParams();
  const urlTab = searchParams.get('tab');
  const [tab, setTab] = useState(WORKSPACE_TABS.includes(urlTab) ? urlTab : 'jobcards');
  const initialWoStatus = searchParams.get('wostatus');
  // Sidebar order: Work Orders first (the production-order control view), Job Card second (its
  // execution sub-tab) — Forecast/Daily Sheet/Workers Roster stay separate operational tools, not
  // folded into the Work Order/Job Card workflow (2026-08-19 UX refinement).
  const navItems = [
    { key: 'workorders', label: 'Work Orders', icon: ClipboardIcon },
    { key: 'jobcards', label: 'Job Card', icon: HardHatIcon },
    { key: 'bom', label: 'BOM', icon: PackageIcon },
    { key: 'forecast', label: 'Forecast', icon: TrendingUpIcon },
    { key: 'sheet', label: 'Daily Sheet', icon: ClipboardListIcon },
    { key: 'roster', label: 'Workers Roster', icon: UsersIcon },
  ];

  return (
    <WorkspaceSidebar title="Shop Floor" icon={HardHatIcon} items={navItems} activeKey={tab} onChange={setTab}>
      {tab === 'jobcards' && (
        <JobCardBoard jobCards={jobCards} operations={operations} workstations={workstations} projects={projects} workers={workers} />
      )}
      {tab === 'workorders' && <WorkOrdersPanel projects={projects} operations={operations} workstations={workstations} initialStatus={initialWoStatus} />}
      {tab === 'bom' && <ProductionBomTab projects={projects} />}
      {tab === 'forecast' && <ProductionForecastPanel />}
      {tab === 'sheet' && <DailySheetWorkspace date={date} sheet={sheet} projects={projects} />}
      {tab === 'roster' && <Roster workers={workers} trades={trades} />}
    </WorkspaceSidebar>
  );
}

// Same taxonomy the PR/BOM composer's category dropdown uses (lib/bom-fields.mjs's
// DIMENSIONAL_CATEGORIES, the shared list also gating lib/remnant-match.js/lib/procurement.js).
const DIMENSIONAL_CATEGORIES = new Set(SHAPE_CATEGORIES);


// Every project has its own Master BOM (§5a) — what's arrived from Stores, what's still pending —
// which Production needs while deciding what a job card can actually start on. Cross-project here
// (unlike the project page's BomPanel), so a project picker comes first. Reuses the existing
// BomTable/getProjectBom exactly as the project page does; no new BOM UI, only a new place to
// reach it from. Production's field ownership (issued_ref/received_ref only) comes straight from
// BOM_FIELD_OWNERS — the same server-enforced list the PATCH route checks, so this can't drift.
function ProductionBomTab({ projects }) {
  const [projectId, setProjectId] = useState('');
  const [bom, setBom] = useState(null);
  const [progress, setProgress] = useState(null);
  const [issues, setIssues] = useState(null);
  const [loading, setLoading] = useState(false);
  const [issueForm, setIssueForm] = useState({ bom_item_id: '', qty: '', job_card_id: '' });
  const [busy, setBusy] = useState(false);
  const [cutFor, setCutFor] = useState(null);
  const [jobCards, setJobCards] = useState([]);
  const router = useRouter();

  async function loadAll() {
    // jobCards (Phase 3, §0/§7) — optional Job Card picker on Issue-material, so a material_issues
    // row CAN resolve back to a Work Order via the direct job_card_id -> work_order_id FK chain
    // instead of only the indirect bom_item_id join. Best-effort: a project with no open cards yet
    // simply shows no picker, same "don't force data that isn't there" precedent as everywhere else.
    const [{ items }, prog, iss, cards] = await Promise.all([
      api(`/api/projects/${projectId}/bom`),
      api(`/api/production/fabrication-progress?project_id=${projectId}`),
      api(`/api/material-issues?project_id=${projectId}`),
      api(`/api/job-cards?project_id=${projectId}&status=progress`).catch(() => []),
    ]);
    setBom(items); setProgress(prog); setIssues(iss); setJobCards(cards);
  }

  useEffect(() => {
    if (!projectId) { setBom(null); setProgress(null); setIssues(null); return; }
    let cancelled = false;
    setLoading(true);
    loadAll().catch(err => !cancelled && showToast(err.message, 'error'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function issueMaterial() {
    if (!issueForm.bom_item_id) return showToast('Pick a BOM item', 'error');
    const qty = Number(issueForm.qty);
    if (!qty || qty <= 0) return showToast('Enter a quantity', 'error');
    setBusy(true);
    try {
      await api('/api/material-issues', {
        method: 'POST',
        body: { bom_item_id: Number(issueForm.bom_item_id), qty, job_card_id: issueForm.job_card_id ? Number(issueForm.job_card_id) : undefined },
      });
      showToast('Material issued');
      setIssueForm({ bom_item_id: '', qty: '', job_card_id: '' });
      await loadAll();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <Select value={projectId} onValueChange={setProjectId}>
        <SelectTrigger className="w-64"><SelectValue placeholder="Select a project" /></SelectTrigger>
        <SelectContent><SelectGroup>
          {projects.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.project_no} · {p.customer_name}</SelectItem>)}
        </SelectGroup></SelectContent>
      </Select>
      {!projectId ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          Pick a project to see its Master BOM, fabrication progress, and material issues.
        </CardContent></Card>
      ) : loading || !bom ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          {progress?.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Fabrication progress</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {progress.map(p => (
                  <Card key={p.section}><CardContent className="flex flex-col gap-1 py-3">
                    <div className="flex items-center justify-between text-sm">
                      <span>{p.section}</span>
                      <span className="text-muted-foreground tnum">{p.pct}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-primary" style={{ width: `${p.pct}%` }} />
                    </div>
                  </CardContent></Card>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Issue material</p>
            <div className="flex flex-wrap gap-2">
              <Select value={issueForm.bom_item_id} onValueChange={v => setIssueForm({ ...issueForm, bom_item_id: v })}>
                <SelectTrigger className="w-72"><SelectValue placeholder="BOM item" /></SelectTrigger>
                <SelectContent><SelectGroup>
                  {bom.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.material_description} {b.size_spec ? `· ${b.size_spec}` : ''}</SelectItem>)}
                </SelectGroup></SelectContent>
              </Select>
              <Input type="number" min="0" placeholder="Qty" className="w-24" value={issueForm.qty}
                onChange={e => setIssueForm({ ...issueForm, qty: e.target.value })} />
              {jobCards.length > 0 && (
                <Select value={issueForm.job_card_id} onValueChange={v => setIssueForm({ ...issueForm, job_card_id: v })}>
                  <SelectTrigger className="w-56"><SelectValue placeholder="Job Card (optional)" /></SelectTrigger>
                  <SelectContent><SelectGroup>
                    {jobCards.map(jc => <SelectItem key={jc.id} value={String(jc.id)}>#{jc.id} {jc.section}{jc.wo_no ? ` · ${jc.wo_no}` : ''}</SelectItem>)}
                  </SelectGroup></SelectContent>
                </Select>
              )}
              <Button size="sm" onClick={issueMaterial} disabled={busy}>Issue</Button>
            </div>
            {issues?.length > 0 && (
              <div className="flex flex-col gap-1 pt-1">
                {issues.slice(0, 8).map(i => (
                  <div key={i.id} className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{i.material_description}</span>
                    <span className="tnum">qty {i.qty} · {i.issued_by}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {bom.some(b => DIMENSIONAL_CATEGORIES.has(b.category)) && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Cutting &amp; remnant</p>
              <div className="flex flex-col gap-1">
                {bom.filter(b => DIMENSIONAL_CATEGORIES.has(b.category)).map(b => (
                  <div key={b.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                    <div className="flex flex-col">
                      <span>{b.material_description} {b.size_spec ? `· ${b.size_spec}` : ''}</span>
                      <span className="text-xs text-muted-foreground">{b.catalog_item_code ? `${b.catalog_item_code} · ` : ''}{b.qty_text || '—'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {b.reserved_piece_count > 0 && <Badge className="border-info/30 bg-info-surface text-info">Reserved — ready to cut</Badge>}
                      <Button size="sm" variant="outline" onClick={() => setCutFor(b)}><ScissorsIcon />Cut</Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <BomTable projectId={Number(projectId)} bom={bom} editableFields={BOM_FIELD_OWNERS.Production} department="Production" />
        </>
      )}
      {cutFor && (
        <CutDialog bomItem={cutFor} projectId={Number(projectId)} router={router} onClose={() => setCutFor(null)} onDone={loadAll} />
      )}
    </div>
  );
}

// Overview (headcount/attendance stats) + Sheet (the marking form) as one Daily Sheet workspace
// with a nested sub-sidebar (components/WorkspaceSidebar's `nested` mode — same pattern Payroll
// uses inside HR), instead of two competing top-level tabs.
function DailySheetWorkspace({ date, sheet, projects }) {
  const [sub, setSub] = useState('overview');
  const subItems = [
    { key: 'overview', label: 'Overview', icon: HouseIcon },
    { key: 'sheet', label: 'Sheet', icon: ClipboardListIcon },
  ];
  return (
    <WorkspaceSidebar title="Daily Sheet" icon={ClipboardListIcon} items={subItems} activeKey={sub} onChange={setSub} nested>
      {sub === 'overview' && <WorkersHome date={date} sheet={sheet} />}
      {sub === 'sheet' && <DailySheet date={date} rows={sheet} projects={projects} />}
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
          employee_id: row.id,
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

function Roster({ workers, trades }) {
  const router = useRouter();

  async function toggleActive(w) {
    try {
      await api(`/api/production/workers/${w.id}`, { method: 'PATCH', body: { active: !w.active } });
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
      await api(`/api/production/workers/${w.id}`, { method: 'PATCH', body: { [field]: value } });
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
      setResults(await api(`/api/production/workers?search=${encodeURIComponent(query.trim())}`));
      setCreateMode(false);
    } catch (err) { showToast(err.message, 'error'); }
    setSearching(false);
  }

  async function activate(employeeId) {
    setBusy(true);
    try {
      await api('/api/production/workers', { method: 'POST', body: { employee_id: employeeId, trade: trade || null } });
      showToast('Worker added to Production roster');
      setOpen(false); reset(); router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  async function createNew() {
    if (!createName.trim()) return showToast('Worker name is required', 'error');
    setBusy(true);
    try {
      await api('/api/production/workers', { method: 'POST', body: { name: createName.trim(), trade: trade || null } });
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
