'use client';

// components/CalcWorkspace.jsx — Calc module shell (Design + Engineering). Ported from an isolated
// prototype into a persistent, shadcn-sidebar-driven workspace. Client-side compute uses the same
// pure computeAll/runValidations as the server's snapshot save (lib/calc-engine.js) — that
// equivalence is what makes "Reproduce" in the Audit panel trustworthy. See SYSTEM.md §5f for the
// module overview and what's deliberately deferred (real material data, project hierarchy, drawings).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Database, FunctionSquare, History, Plus, Trash2,
  ArrowRight, CheckCircle2, AlertTriangle, XCircle, GitBranch, Save, RotateCcw,
  BookOpen, ShieldCheck, ExternalLink, Calculator, RefreshCw, ChevronDown, ChevronRight,
  Table as TableIcon, FileText as FileTextIcon, FileSpreadsheet, Upload, MessageSquare, LayoutTemplate,
  LayoutDashboard, ChartSpline,
} from 'lucide-react';
import { computeAll, runValidations, runFormulaTests, extractDeps, round, LIBRARY, goalSeek, sensitivityAnalysis, changeImpact } from '@/lib/calc-engine';
import { api, showToast, formatDate } from '@/lib/client';
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter, SidebarGroup,
  SidebarGroupLabel, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarTrigger, SidebarInset, SidebarRail,
} from '@/components/ui/sidebar';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import WorkspaceSidebar from '@/components/WorkspaceSidebar';
import { TONE_CLASS } from '@/lib/status-styles';
import LinkifiedText from '@/components/LinkifiedText';
import { EntityCode } from '@/components/EntityRefLink';
import { findEntityRefTokens } from '@/lib/entity-ref-tokens';

const TYPE_STYLE = {
  input: { label: 'Input', cls: TONE_CLASS.info },
  constant: { label: 'Constant', cls: TONE_CLASS.neutral },
  computed: { label: 'Computed', cls: TONE_CLASS.success },
  array: { label: 'Array', cls: TONE_CLASS.warning },
};
// Phase 3 dropdown UX pass — common mathjs unit strings already used across the seeded methodology,
// offered as a Select instead of free-text typing. "Custom…" drops back to a text input for anything
// not on the list (mathjs accepts far more units than this module happens to use).
const COMMON_UNITS = ['bar', 'MPa', 'mm', 'm', 'm/s', 'degC', 'kg', 'kgf/cm2', 'kgf/mm2', 'mm2', '-'];
const STATUS_STYLE = {
  draft: { label: 'Draft', cls: TONE_CLASS.warning },
  pending: { label: 'Pending approval', cls: TONE_CLASS.info },
  approved: { label: 'Approved', cls: TONE_CLASS.success },
  deprecated: { label: 'Deprecated', cls: TONE_CLASS.neutral },
};

// CALC-CHANGES2.md §A sidebar relabel/regroup — same panels/components, just labels + a `group`
// for which SidebarGroup heading each renders under. "Calculation" (was "Project") + Registry stay
// ungrouped/top-level since both are the per-sheet data (Registry moved onto calc_sheet_id along
// with everything else in this group); Methodology/Library/Tables group visually under
// "Engineering" even though they stay fully global — the heading is tidiness, not a scope claim
// (see the brief's explicit correction on this). "Governance" holds Audit. Drawings (§B) is its own
// standalone entry, added when that panel lands.
const PANELS = [
  {
    key: 'project', label: 'Calculation', icon: Calculator, description: 'Daily work — edit inputs, review results',
    help: 'Edit inputs on the left — results and validations recompute live. Save a snapshot to freeze this exact run.',
    group: null,
  },
  {
    key: 'registry', label: 'Registry', icon: Database, description: 'Variables — inputs, constants, computed',
    help: 'Add the inputs and constants a formula needs. Computed variables show here read-only — they come from Methodology.',
    group: null,
  },
  {
    key: 'methodology', label: 'Methodology', icon: FunctionSquare, description: 'Formulas, versions, approvals, validations',
    help: 'Edit a formula to save a new version (resets it to Draft). Submit for review, then approve, before Project trusts it.',
    group: 'Engineering',
  },
  {
    key: 'library', label: 'Library', icon: BookOpen, description: 'Import formulas cited to published codes',
    help: 'Import a formula cited to a published code. It lands in Methodology as Pending approval, same as any new formula.',
    group: 'Engineering',
  },
  {
    key: 'tables', label: 'Tables', icon: TableIcon, description: 'Material/lookup tables, referenced from formulas',
    help: 'Reference a table from a formula with LOOKUP("name", x, "column") — values between rows interpolate automatically.',
    group: 'Engineering',
  },
  {
    key: 'audit', label: 'Audit', icon: History, description: 'Version history, snapshots, reproduce',
    help: 'Browse every formula version ever saved, or replay a snapshot to confirm it still reproduces exactly.',
    group: 'Governance',
  },
  {
    key: 'calc-drawing-links', label: 'Calc Links', icon: Calculator, description: 'Which calc sheet substantiates which drawing',
    help: 'A calc sheet substantiates a drawing, not a BOM structural node. Link one or more calc sheets to each drawing here.',
    group: 'Drawings',
  },
  {
    key: 'portfolio', label: 'Portfolio', icon: LayoutDashboard, description: 'Every project’s calc/drawing status at a glance',
    help: 'Cross-project glance, not scoped to this sheet — every project with a calc sheet or drawing, same data the Operations Design master table uses.',
    group: 'Portfolio',
  },
];
// Preserves PANELS order (Workspace/null group first) while grouping for the sidebar's separate
// SidebarGroup sections.
const PANEL_GROUPS = [...new Set(PANELS.map((p) => p.group))].map((group) => ({
  group, items: PANELS.filter((p) => p.group === group),
}));

export default function CalcWorkspace({ initialState, sheetId, sheetChain, user, designTeam = [] }) {
  const router = useRouter();
  const [panel, setPanel] = useState('project');
  const [calcView, setCalcView] = useState('worksheet');
  const [variables, setVariables] = useState(initialState.variables);
  const [formulas, setFormulas] = useState(initialState.formulas);
  const [validations, setValidations] = useState(initialState.validations);
  const [snapshots, setSnapshots] = useState(initialState.snapshots);
  const [tables, setTables] = useState(initialState.tables || []);
  const [formulaTests, setFormulaTests] = useState(initialState.formulaTests || []);
  const [notes, setNotes] = useState(initialState.notes || []);
  const [templates, setTemplates] = useState(initialState.templates || []);

  // Server truth lands here after every mutation's router.refresh() — re-sync local editable state.
  useEffect(() => {
    setVariables(initialState.variables);
    setFormulas(initialState.formulas);
    setValidations(initialState.validations);
    setSnapshots(initialState.snapshots);
    setTables(initialState.tables || []);
    setFormulaTests(initialState.formulaTests || []);
    setNotes(initialState.notes || []);
    setTemplates(initialState.templates || []);
  }, [initialState]);

  const nameList = variables.map((v) => v.name);
  const { values: liveValues, trace, convergence } = useMemo(() => computeAll(variables, formulas, { tables }), [variables, formulas, tables]);
  const checks = useMemo(() => runValidations(validations, liveValues), [validations, liveValues]);

  function updateLocalValue(id, value) {
    setVariables((prev) => prev.map((v) => (v.id === id ? { ...v, value } : v)));
  }

  async function persistValue(id, value) {
    try {
      await api(`/api/calc-variables/${id}`, { method: 'PATCH', body: { value } });
      router.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  const computedVars = variables.filter((v) => v.type === 'computed');
  // Array variables get their own row-editor card (Registry panel) instead of a single number
  // field — excluded from the Design inputs list, same reasoning computed variables are excluded.
  const otherVars = variables.filter((v) => v.type !== 'computed' && v.type !== 'array');
  const unapproved = trace.filter((t) => t.status !== 'approved');
  const failCount = checks.filter((c) => c.severity === 'fail' && !c.pass).length;
  const warnCount = checks.filter((c) => c.severity === 'warning' && !c.pass).length;
  const passCount = checks.length - failCount - warnCount;
  const activePanel = PANELS.find((p) => p.key === panel);
  const approvedFormulas = formulas.filter((f) => f.status === 'approved').length;
  async function deleteCurrentSheet() {
    if (!sheetChain || !window.confirm(`Delete calculation sheet “${sheetChain.sheetName}”?`)) return;
    try {
      await api(`/api/calc-sheets/${sheetChain.sheetId}`, { method: 'DELETE' });
      showToast('Calculation sheet deleted');
      router.push(`/calc/project/${sheetChain.projectId}`);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="gap-2 px-3 py-3.5 group-data-[collapsible=icon]:px-2">
          <div className="flex items-center gap-2.5 group-data-[collapsible=icon]:hidden">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <Calculator className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              {sheetChain ? (
                <>
                  <InlineSwitcher
                    trigger={
                      <span className="flex min-w-0 items-center gap-1">
                        <span className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">{sheetChain.projectNo}</span>
                        <ChevronDown className="size-3 shrink-0 text-sidebar-foreground/40" />
                      </span>
                    }
                    triggerClassName="-mx-1 flex min-w-0 rounded-md px-1 py-0.5 hover:bg-sidebar-accent"
                    placeholder="Search projects…"
                    loadItems={async () => (await api('/api/projects')).projects}
                    getKey={(p) => p.id} getLabel={(p) => p.project_no} getSub={(p) => p.customer_name}
                    onPick={(p) => router.push(`/calc/project/${p.id}`)}
                  />
                  <div className="truncate text-[11px] text-sidebar-foreground/50">{sheetChain.customerName}</div>
                  <div className="mt-1 flex min-w-0 flex-1 items-center gap-1">
                    <ChevronRight className="size-3 shrink-0 text-sidebar-foreground/30" />
                    <InlineSwitcher
                      trigger={
                        <span className="flex min-w-0 items-center gap-1">
                          <span className="truncate text-xs font-medium text-sidebar-foreground/80">{sheetChain.csNo && `${sheetChain.csNo} · `}{sheetChain.sheetName}</span>
                          <ChevronDown className="size-3 shrink-0 text-sidebar-foreground/40" />
                        </span>
                      }
                      triggerClassName="-mx-1 flex w-full min-w-0 max-w-full rounded-md px-1 py-0.5 hover:bg-sidebar-accent"
                      placeholder="Search sheets…"
                      loadItems={async () => (await api(`/api/calc-sheets?project_id=${sheetChain.projectId}`)).sheets}
                      getKey={(s) => s.id} getLabel={(s) => s.cs_no ? `${s.cs_no} · ${s.name}` : s.name} getSub={() => null}
                      onPick={(s) => router.push(`/calc/project/${sheetChain.projectId}/${s.id}`)}
                    />
                  </div>
                </>
              ) : (
                <div className="truncate text-sm font-semibold tracking-tight">Calc Sheets</div>
              )}
            </div>
            {sheetChain && <Button variant="ghost" size="icon-sm" className="ml-auto text-muted-foreground hover:text-destructive group-data-[collapsible=icon]:hidden" title="Delete calculation sheet" onClick={deleteCurrentSheet}><Trash2 className="size-3.5" /></Button>}
            <SidebarTrigger className={sheetChain ? '' : 'ml-auto'} />
          </div>
          <div className="hidden justify-center group-data-[collapsible=icon]:flex">
            <SidebarTrigger aria-label="Expand Calc Sheets sidebar" />
          </div>
        </SidebarHeader>
        <SidebarContent>
          {PANEL_GROUPS.map(({ group, items }) => (
            <SidebarGroup key={group || 'workspace'}>
              {group && <SidebarGroupLabel>{group}</SidebarGroupLabel>}
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((p) => (
                    <SidebarMenuItem key={p.key}>
                      <SidebarMenuButton isActive={panel === p.key} tooltip={p.label} onClick={() => setPanel(p.key)}>
                        <p.icon />
                        <span>{p.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter className="gap-2 group-data-[collapsible=icon]:hidden">
          <div className="rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-sidebar-foreground">
              <activePanel.icon className="size-3.5 shrink-0" />
              On this screen
            </div>
            <p className="mt-1 text-xs leading-snug text-sidebar-foreground/70">{activePanel.help}</p>
          </div>
          <div className="flex items-center gap-2 px-1 text-xs text-sidebar-foreground/60">
            <ShieldCheck className="size-3.5 shrink-0 text-success" />
            <span><span className="font-medium text-sidebar-foreground">{approvedFormulas}/{formulas.length}</span> formulas approved</span>
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <div className="flex items-center gap-3 border-b bg-muted/20 px-4 py-3.5">
          <SidebarTrigger className="md:hidden" />
          <Separator orientation="vertical" className="h-5 md:hidden" />
          <activePanel.icon className="size-4 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold leading-tight">{activePanel.label}</h1>
            <p className="text-xs text-muted-foreground">{activePanel.description}</p>
          </div>
          {/* Persistent status strip — visible from every panel, not just Calculation, so a
              failing validation is visible while browsing Registry/Methodology/etc too. */}
          <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
            {failCount > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-1 text-xs font-medium tnum text-destructive">
                <XCircle className="size-3" />{failCount}
              </span>
            )}
            {warnCount > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-warning/10 px-2 py-1 text-xs font-medium tnum text-warning">
                <AlertTriangle className="size-3" />{warnCount}
              </span>
            )}
            <span className="flex items-center gap-1 rounded-full bg-success/10 px-2 py-1 text-xs font-medium tnum text-success">
              <CheckCircle2 className="size-3" />{passCount}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {panel === 'project' && (
            <ProjectPanel
              otherVars={otherVars} computedVars={computedVars} liveValues={liveValues} trace={trace} checks={checks}
              convergence={convergence} passCount={passCount} warnCount={warnCount} failCount={failCount} unapproved={unapproved}
              onLocalChange={updateLocalValue} onPersist={persistValue} router={router}
              variables={variables} formulas={formulas} tables={tables} templates={templates} sheetId={sheetId} snapshots={snapshots}
              calcView={calcView} setCalcView={setCalcView}
            />
          )}
          {panel === 'methodology' && (
            <MethodologyPanel
              formulas={formulas} validations={validations} nameList={nameList} router={router}
              variables={variables} tables={tables} formulaTests={formulaTests} snapshots={snapshots} notes={notes} sheetId={sheetId}
            />
          )}
          {panel === 'registry' && <RegistryPanel variables={variables} liveValues={liveValues} router={router} notes={notes} sheetId={sheetId} />}
          {panel === 'library' && <LibraryPanel formulas={formulas} router={router} sheetId={sheetId} />}
          {panel === 'tables' && <TablesPanel tables={tables} router={router} nameList={nameList} variables={variables} />}
          {panel === 'audit' && <AuditPanel variables={variables} formulas={formulas} tables={tables} snapshots={snapshots} router={router} />}
          {panel === 'calc-drawing-links' && <CalcDrawingLinksPanel projectId={sheetChain?.projectId} />}
          {panel === 'portfolio' && <PortfolioPanel />}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

// ---- Project ------------------------------------------------------------------------------------

// Phase 3, item 16 (calculation templates) — pick a named preset from a dropdown and apply it to
// reset the registry's inputs/constants, or save the current run as a new one.
function TemplatesCard({ templates, router, sheetId }) {
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showSave, setShowSave] = useState(false);

  async function apply() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await api(`/api/calc-templates/${selected}`, { method: 'PATCH', body: { sheetId } });
      showToast(`Applied template — ${res.applied} value(s) updated`);
      router.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveAsTemplate() {
    if (!saveName.trim()) return;
    setBusy(true);
    try {
      await api('/api/calc-templates', { method: 'POST', body: { name: saveName.trim(), sheetId } });
      showToast('Template saved');
      setSaveName('');
      setShowSave(false);
      router.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  // A quick-start affordance, not a primary object — dashed border + no CardHeader weight keeps it
  // visually secondary to the Design inputs card it sits above (premium-repositioning pass).
  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <LayoutTemplate className="size-3.5" /> Templates
      </div>
      <div className="flex gap-2">
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger className="flex-1"><SelectValue placeholder="Start from a scenario…" /></SelectTrigger>
          <SelectContent>
            {templates.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" disabled={!selected || busy} onClick={apply}>Apply</Button>
      </div>
      {selected && templates.find((t) => String(t.id) === selected)?.description && (
        <p className="text-xs text-muted-foreground">{templates.find((t) => String(t.id) === selected).description}</p>
      )}
      {showSave ? (
        <div className="flex gap-2">
          <Input placeholder="Template name" value={saveName} onChange={(e) => setSaveName(e.target.value)} className="flex-1" />
          <Button size="sm" disabled={busy} onClick={saveAsTemplate}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setShowSave(false)}>Cancel</Button>
        </div>
      ) : (
        <button onClick={() => setShowSave(true)} className="self-start text-xs text-muted-foreground hover:text-foreground">Save current inputs as a new template</button>
      )}
    </div>
  );
}

function ProjectPanel({ otherVars, computedVars, liveValues, trace, checks, convergence, passCount, warnCount, failCount, unapproved, onLocalChange, onPersist, router, variables, formulas, tables, templates, sheetId, snapshots, calcView, setCalcView }) {
  const [saving, setSaving] = useState(false);
  const [showIterations, setShowIterations] = useState(false);
  const [showTrace, setShowTrace] = useState(false);

  async function saveSnapshot() {
    setSaving(true);
    try {
      await api('/api/calc-snapshots', { method: 'POST', body: { sheetId } });
      showToast('Snapshot saved');
      router.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const inputVars = otherVars.filter((v) => v.type === 'input');
  const hasSizingMargin = typeof liveValues.RequiredThickness === 'number'
    && typeof liveValues.SelectedThickness === 'number'
    && variables.some((v) => v.name === 'DesignMarginPct')
    && liveValues.RequiredThickness !== 0;
  const hasInputHistory = inputVars.length >= 3 && (snapshots?.length || 0) >= 5;
  const insightCount = 1 + (hasSizingMargin ? 1 : 0) + (hasInputHistory ? 1 : 0);
  const insightGridClass = insightCount === 3 ? 'md:grid-cols-3' : insightCount === 2 ? 'md:grid-cols-2' : 'md:grid-cols-1';

  // Premium-repositioning pass: Calculation used to be one long scroll doing two jobs — the daily
  // worksheet (inputs/results/validations, opened every day) and an engineering deep-dive
  // (execution trace, the analytics visuals, goal-seek/sensitivity, occasional/investigative use).
  // Worksheet and Analysis are two views of the same calculation sheet. Keep them close to the
  // sheet in a compact nested sidebar so the daily worksheet and investigative analysis do not
  // compete for one long scroll.
  return (
    <WorkspaceSidebar
      nested
      hideHeader
      title="Calculation view"
      icon={Calculator}
      items={[{ key: 'worksheet', label: 'Worksheet', icon: FileSpreadsheet }, { key: 'analysis', label: 'Analysis', icon: ChartSpline }]}
      activeKey={calcView}
      onChange={setCalcView}
    >

      {calcView === 'worksheet' && <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-3">
            <TemplatesCard templates={templates} router={router} sheetId={sheetId} />
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Design inputs</CardTitle></CardHeader>
              <CardContent className="flex flex-col divide-y p-0">
                {otherVars.map((v) => (
                  <div key={v.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{v.name}</div>
                      <div className="text-xs text-muted-foreground">{TYPE_STYLE[v.type].label}{v.unit ? ` · ${v.unit}` : ''}</div>
                    </div>
                    <Input
                      type="number" defaultValue={v.value} className="w-28 shrink-0 text-right font-mono"
                      onChange={(e) => onLocalChange(v.id, Number(e.target.value))}
                      onBlur={(e) => onPersist(v.id, Number(e.target.value))}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>

            <Button onClick={saveSnapshot} disabled={saving} className="self-start">
              <Save data-icon="inline-start" />{saving ? 'Saving…' : 'Save snapshot of this run'}
            </Button>

            {unapproved.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-warning/20 bg-warning/10 px-3 py-2 text-xs text-warning">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>{unapproved.length} formula(s) in this run aren't Approved yet: {unapproved.map((t) => t.formulaName).join(', ')}. Results are provisional.</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            {convergence.map((c) => (
              <div key={c.outputVars.join(',')} className={`rounded-md border px-3 py-2 text-xs ${
                c.converged ? 'border-success/20 bg-success/5 text-success' : 'border-destructive/20 bg-destructive/10 text-destructive'
              }`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-medium">
                    <RefreshCw className="size-3.5 shrink-0" />
                    {c.converged
                      ? `Converged in ${c.iterations} iteration${c.iterations === 1 ? '' : 's'}`
                      : `Did not converge after ${c.maxIterations} iterations`}
                    <span className="font-normal text-muted-foreground">— {c.outputVars.join(', ')}</span>
                  </span>
                  <button onClick={() => setShowIterations((s) => !s)} className="flex shrink-0 items-center gap-1 text-muted-foreground hover:text-foreground">
                    Iteration history <ChevronDown className={`size-3.5 transition-transform ${showIterations ? 'rotate-180' : ''}`} />
                  </button>
                </div>
                {showIterations && (
                  <div className="mt-2 max-h-48 overflow-auto rounded border border-border/50 bg-background/50">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="h-7 text-xs">Iter</TableHead>
                          <TableHead className="h-7 text-xs">Variable</TableHead>
                          <TableHead className="h-7 text-xs">Value</TableHead>
                          <TableHead className="h-7 text-xs">Δ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {c.history.map((h, i) => (
                          <TableRow key={i}>
                            <TableCell className="py-1 font-mono text-xs">{h.iteration}</TableCell>
                            <TableCell className="py-1 font-mono text-xs">{h.variable}</TableCell>
                            <TableCell className="py-1 font-mono text-xs">{h.error ? 'error' : round(h.value)}</TableCell>
                            <TableCell className="py-1 font-mono text-xs">{h.error ? '—' : `${round(h.delta * 100)}%`}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            ))}

            <Card className="has-data-[slot=card-footer]:pb-0">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Results</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col divide-y p-0">
                {computedVars.map((v) => {
                  const value = liveValues[v.name];
                  return (
                    <div key={v.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="text-sm font-medium">{v.name}</div>
                      <div className="font-mono text-sm font-medium text-success">
                        {value === null || value === undefined || Number.isNaN(value) ? '—' : `${round(value)}${v.unit ? ' ' + v.unit : ''}`}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
              <CardFooter className="flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1.5 text-success"><CheckCircle2 className="size-3.5" />{passCount} passed</span>
                <span className="flex items-center gap-1.5 text-warning"><AlertTriangle className="size-3.5" />{warnCount} warnings</span>
                <span className="flex items-center gap-1.5 text-destructive"><XCircle className="size-3.5" />{failCount} failures</span>
              </CardFooter>
            </Card>

            {checks.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {checks.map((c) => (
                  <div key={c.id} className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs ${
                    c.pass ? 'border-success/20 bg-success/5 text-success'
                      : c.severity === 'fail' ? 'border-destructive/20 bg-destructive/10 text-destructive' : 'border-warning/20 bg-warning/10 text-warning'
                  }`}>
                    {c.pass ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /> : c.severity === 'fail' ? <XCircle className="mt-0.5 size-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
                    <span>{c.name}{!c.pass ? ` — ${c.message}` : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>}

      {calcView === 'analysis' && <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-2">
          <div>
            <h2 className="text-sm font-semibold">Visual diagnostics</h2>
            <p className="text-xs text-muted-foreground">Quick signals about validation health, sizing margin, and how today compares with saved runs.</p>
          </div>
          <div className={`grid grid-cols-1 gap-4 ${insightGridClass}`}>
            <ValidationDonut passCount={passCount} warnCount={warnCount} failCount={failCount} />
            {hasSizingMargin && <MarginGauge variables={variables} liveValues={liveValues} />}
            {hasInputHistory && <InputRadar otherVars={otherVars} liveValues={liveValues} snapshots={snapshots} />}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <div>
            <h2 className="text-sm font-semibold">What-if analysis</h2>
            <p className="text-xs text-muted-foreground">Explore a target or test how an output responds before changing the worksheet.</p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <GoalSeekCard inputVars={inputVars} computedVars={computedVars} variables={variables} formulas={formulas} tables={tables} onPersist={onPersist} onLocalChange={onLocalChange} />
            <SensitivityCard inputVars={inputVars} computedVars={computedVars} variables={variables} formulas={formulas} tables={tables} />
          </div>
        </section>

        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-2.5">
            <button type="button" className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setShowTrace((open) => !open)}>
              <div>
                <CardTitle className="text-sm">Execution trace</CardTitle>
                <p className="mt-0.5 text-xs font-normal text-muted-foreground">Formula-by-formula audit of how this result was produced.</p>
              </div>
              <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${showTrace ? 'rotate-180' : ''}`} />
            </button>
          </CardHeader>
          {showTrace && <CardContent className="flex flex-col divide-y p-0">
            {trace.map((t, i) => (
              <div key={t.formulaId} className="px-4 py-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">{i + 1}.</span>
                  <span className="font-medium">{t.formulaName}</span>
                  <Badge variant="outline">v{t.version}</Badge>
                  <Badge className={STATUS_STYLE[t.status].cls} variant="outline">{STATUS_STYLE[t.status].label}</Badge>
                  {t.iterations != null && <Badge variant="outline" className={t.converged ? 'text-success' : 'text-destructive'}><RefreshCw className="size-3" data-icon="inline-start" />{t.iterations} iter</Badge>}
                  {t.warnings?.length > 0 && <Badge variant="outline" className="text-warning" title={t.warnings.join('; ')}><AlertTriangle className="size-3" data-icon="inline-start" />{t.warnings.length === 1 ? 'extrapolated' : `${t.warnings.length} warnings`}</Badge>}
                  {t.guardExpr && <Badge variant="outline" className={t.skipped ? 'text-muted-foreground' : 'text-info'} title={`Guard: ${t.guardExpr}`}>{t.skipped ? 'skipped (guard false)' : 'guard passed'}</Badge>}
                  <ArrowRight className="size-3 text-muted-foreground" />
                  <span className="font-mono">{t.error ? 'error' : t.skipped ? 'n/a' : round(t.output)}</span>
                </div>
                <div className="mt-0.5 pl-4 text-muted-foreground">using {Object.entries(t.inputsUsed).map(([k, val]) => `${k}=${round(val)}`).join(', ')}</div>
                {t.guardExpr && <div className="mt-0.5 pl-4 text-muted-foreground">guard: {t.guardExpr}</div>}
                {t.warnings?.length > 0 && <div className="mt-0.5 pl-4 text-warning">{t.warnings.join(' ')}</div>}
              </div>
            ))}
          </CardContent>}
        </Card>
      </div>}
    </WorkspaceSidebar>
  );
}

// ---- Portfolio-glance visuals (reversal of the earlier CALC-CHANGES2.md §C scope cut, at the
// user's explicit request) — inline SVG, no chart dependency, same idiom SensitivityCard's sweep
// chart already uses. Each hides itself rather than erroring when its inputs aren't present, since
// none of these are guaranteed to apply to every methodology (a sheet with no RequiredThickness/
// SelectedThickness pair, or fewer than 2 snapshots, still has to render a normal Project panel). --

// Validation Donut — pass/warn/fail as a 3-segment ring, same color vocabulary as the Results
// card's pass/warn/fail chips just above it.
function ValidationDonut({ passCount, warnCount, failCount }) {
  const total = passCount + warnCount + failCount;
  const r = 32, cx = 40, cy = 40, circumference = 2 * Math.PI * r;
  const segs = total > 0
    ? [
        { count: passCount, cls: 'stroke-success' },
        { count: warnCount, cls: 'stroke-warning' },
        { count: failCount, cls: 'stroke-destructive' },
      ]
    : [{ count: 1, cls: 'stroke-muted' }];
  let offset = 0;
  const arcs = segs.filter((s) => s.count > 0).map((s) => {
    const frac = s.count / (total || 1);
    const dash = frac * circumference;
    const arc = { ...s, dasharray: `${dash} ${circumference - dash}`, dashoffset: -offset };
    offset += dash;
    return arc;
  });
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Validation mix</CardTitle></CardHeader>
      <CardContent className="flex items-center gap-4">
        <svg viewBox="0 0 80 80" className="size-20 shrink-0 -rotate-90">
          <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth="10" className="stroke-muted" />
          {arcs.map((a, i) => (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none" strokeWidth="10" strokeDasharray={a.dasharray}
              strokeDashoffset={a.dashoffset} className={a.cls} />
          ))}
        </svg>
        <div className="flex flex-col gap-1 text-xs">
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-success" />{passCount} passed</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-warning" />{warnCount} warnings</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-destructive" />{failCount} failures</span>
        </div>
      </CardContent>
    </Card>
  );
}

// Margin Gauge — the seeded methodology's own margin story: how far SelectedThickness sits above
// RequiredThickness, against the DesignMarginPct constant's threshold. Hides entirely on a
// methodology that doesn't define this specific pair — a generic "margin" isn't a property every
// formula set has, only reads meaningfully for this shell-thickness pattern.
function MarginGauge({ variables, liveValues }) {
  const required = liveValues.RequiredThickness;
  const selected = liveValues.SelectedThickness;
  const marginPctVar = variables.find((v) => v.name === 'DesignMarginPct');
  if (typeof required !== 'number' || typeof selected !== 'number' || !marginPctVar || Number.isNaN(required) || required === 0) return null;
  const margin = (selected - required) / required;
  const threshold = marginPctVar.value ?? 0.15;
  const tone = margin < 0 ? 'text-destructive' : margin < threshold ? 'text-warning' : 'text-success';
  const strokeTone = margin < 0 ? 'stroke-destructive' : margin < threshold ? 'stroke-warning' : 'stroke-success';
  // Semicircle gauge, -100%..+100% mapped to 180°..0°, clamped so an extreme margin doesn't run
  // the needle off the arc.
  const clamped = Math.max(-1, Math.min(1, margin));
  const angle = 180 - (clamped + 1) / 2 * 180;
  const rad = (angle * Math.PI) / 180;
  const r = 34, cx = 40, cy = 40;
  const needleX = cx + r * Math.cos(rad), needleY = cy - r * Math.sin(rad);
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Sizing margin</CardTitle></CardHeader>
      <CardContent className="flex items-center gap-4">
        <svg viewBox="0 0 80 46" className="h-[46px] w-20 shrink-0">
          <path d="M 6 40 A 34 34 0 0 1 74 40" fill="none" strokeWidth="8" className="stroke-muted" strokeLinecap="round" />
          <line x1={cx} y1={cy} x2={needleX} y2={needleY} strokeWidth="2.5" className={strokeTone} strokeLinecap="round" />
          <circle cx={cx} cy={cy} r="2.5" className={strokeTone.replace('stroke-', 'fill-')} />
        </svg>
        <div className="flex flex-col gap-0.5">
          <span className={`text-lg font-semibold tnum ${tone}`}>{round(margin * 100)}%</span>
          <span className="text-xs text-muted-foreground">vs {round(threshold * 100)}% design margin</span>
        </div>
      </CardContent>
    </Card>
  );
}

// Input Radar — this sheet's current inputs plotted against the range each one has actually held
// across its own saved snapshots (min..max seen), so the shape answers "is today's run typical or
// an outlier compared to what's been calculated before" — not against an arbitrary external scale
// no seed data defines. Needs real history to mean anything: at 2 snapshots the "range" is just
// those two points, so the polygon reads as permanently maxed-out on one vertex — not a signal,
// noise. 5 is a defensible floor for "typical range" to say something; hides below that or below
// 3 input vars (a radar needs at least a triangle).
function InputRadar({ otherVars, liveValues, snapshots }) {
  const inputs = otherVars.filter((v) => v.type === 'input');
  if (inputs.length < 3 || !snapshots || snapshots.length < 5) return null;

  const ranges = inputs.map((v) => {
    const seen = snapshots.map((s) => s.inputOverride?.[v.name]).filter((n) => typeof n === 'number');
    seen.push(liveValues[v.name]);
    const min = Math.min(...seen), max = Math.max(...seen);
    return { name: v.name, min, max, value: liveValues[v.name] };
  });

  const n = ranges.length, cx = 60, cy = 60, R = 48;
  const pointAt = (i, frac) => {
    const angle = -Math.PI / 2 + (i / n) * 2 * Math.PI;
    const rr = R * Math.max(0, Math.min(1, frac));
    return [cx + rr * Math.cos(angle), cy + rr * Math.sin(angle)];
  };
  const poly = ranges.map((r, i) => {
    const frac = r.max === r.min ? 0.5 : (r.value - r.min) / (r.max - r.min);
    return pointAt(i, frac).join(',');
  }).join(' ');
  const rim = ranges.map((_, i) => pointAt(i, 1).join(',')).join(' ');

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Inputs vs. history</CardTitle></CardHeader>
      <CardContent>
        <svg viewBox="0 0 120 120" className="mx-auto h-32 w-32">
          <polygon points={rim} fill="none" className="stroke-border" strokeWidth="1" />
          {ranges.map((_, i) => {
            const [x, y] = pointAt(i, 1);
            return <line key={i} x1={cx} y1={cy} x2={x} y2={y} className="stroke-border" strokeWidth="1" />;
          })}
          <polygon points={poly} fill="currentColor" fillOpacity="0.15" className="stroke-info text-info" strokeWidth="1.5" />
        </svg>
        <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
          {ranges.map((r) => <span key={r.name} className="truncate">{r.name}</span>)}
        </div>
      </CardContent>
    </Card>
  );
}

// ---- What-if: goal-seek (2.2) + sensitivity analysis (2.3) ----------------------------------------

function GoalSeekCard({ inputVars, computedVars, variables, formulas, tables, onPersist, onLocalChange }) {
  const [inputVar, setInputVar] = useState(inputVars[0]?.name || '');
  const [outputVar, setOutputVar] = useState(computedVars[0]?.name || '');
  const [target, setTarget] = useState('');
  const [lo, setLo] = useState('');
  const [hi, setHi] = useState('');
  const [result, setResult] = useState(null);

  function run() {
    const base = variables.find((v) => v.name === inputVar)?.value || 1;
    const loVal = lo !== '' ? Number(lo) : base * 0.2;
    const hiVal = hi !== '' ? Number(hi) : base * 3;
    setResult(goalSeek(variables, formulas, {
      inputVar, outputVar, target: Number(target), tables, lo: loVal, hi: hiVal,
    }));
  }

  function apply() {
    const v = variables.find((vv) => vv.name === inputVar);
    if (!v || result?.value == null) return;
    onLocalChange(v.id, result.value);
    onPersist(v.id, result.value);
    showToast(`${inputVar} set to ${round(result.value)}`);
  }

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Goal seek</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        <p className="text-xs text-muted-foreground">Find the input value that drives an output to a target — bisection over the current methodology.</p>
        <div className="grid grid-cols-2 gap-2">
          <Select value={inputVar} onValueChange={setInputVar}>
            <SelectTrigger><SelectValue placeholder="Adjust…" /></SelectTrigger>
            <SelectContent>{inputVars.map((v) => <SelectItem key={v.name} value={v.name}>{v.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={outputVar} onValueChange={setOutputVar}>
            <SelectTrigger><SelectValue placeholder="To hit…" /></SelectTrigger>
            <SelectContent>{computedVars.map((v) => <SelectItem key={v.name} value={v.name}>{v.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Input type="number" placeholder="Target value" value={target} onChange={(e) => setTarget(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <Input type="number" placeholder={`Bracket lo (auto)`} value={lo} onChange={(e) => setLo(e.target.value)} />
          <Input type="number" placeholder={`Bracket hi (auto)`} value={hi} onChange={(e) => setHi(e.target.value)} />
        </div>
        <Button size="sm" onClick={run} disabled={!inputVar || !outputVar || target === ''} className="self-start">Run goal seek</Button>
        {result && (
          result.converged ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-success/20 bg-success/5 px-3 py-2 text-xs text-success">
              <span>Set <span className="font-mono">{inputVar} = {round(result.value)}</span> to reach {outputVar} ≈ {target} (converged in {result.iterations} iterations).</span>
              <Button size="sm" variant="outline" onClick={apply}>Apply</Button>
            </div>
          ) : (
            <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {result.error || 'Did not converge.'}
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}

function SensitivityCard({ inputVars, computedVars, variables, formulas, tables }) {
  const [inputVar, setInputVar] = useState(inputVars[0]?.name || '');
  const [outputVar, setOutputVar] = useState(computedVars[0]?.name || '');
  const [range, setRange] = useState(20);
  const [result, setResult] = useState(null);

  function run() {
    setResult(sensitivityAnalysis(variables, formulas, { inputVar, outputVar, range: Number(range) / 100, steps: 11, tables }));
  }

  const points = result?.points?.filter((p) => typeof p.output === 'number' && !Number.isNaN(p.output)) || [];
  const chart = points.length > 1 && (() => {
    const w = 260, h = 90, pad = 4;
    const xs = points.map((p) => p.input), ys = points.map((p) => p.output);
    const [xMin, xMax] = [Math.min(...xs), Math.max(...xs)];
    const [yMin, yMax] = [Math.min(...ys), Math.max(...ys)];
    const sx = (x) => pad + (xMax === xMin ? w / 2 : ((x - xMin) / (xMax - xMin)) * (w - 2 * pad));
    const sy = (y) => h - pad - (yMax === yMin ? h / 2 : ((y - yMin) / (yMax - yMin)) * (h - 2 * pad));
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.input).toFixed(1)} ${sy(p.output).toFixed(1)}`).join(' ');
    return { w, h, path };
  })();

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Sensitivity analysis</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        <p className="text-xs text-muted-foreground">Sweep an input across a +/- range around its current value and chart the output response.</p>
        <div className="grid grid-cols-2 gap-2">
          <Select value={inputVar} onValueChange={setInputVar}>
            <SelectTrigger><SelectValue placeholder="Vary…" /></SelectTrigger>
            <SelectContent>{inputVars.map((v) => <SelectItem key={v.name} value={v.name}>{v.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={outputVar} onValueChange={setOutputVar}>
            <SelectTrigger><SelectValue placeholder="Watch…" /></SelectTrigger>
            <SelectContent>{computedVars.map((v) => <SelectItem key={v.name} value={v.name}>{v.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Input type="number" className="w-20" value={range} onChange={(e) => setRange(e.target.value)} />
          <span className="text-xs text-muted-foreground">% range, 11 points</span>
          <Button size="sm" onClick={run} disabled={!inputVar || !outputVar} className="ml-auto">Run sweep</Button>
        </div>
        {result?.error && <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">{result.error}</div>}
        {chart && (
          <div className="rounded-md border bg-muted/20 p-2">
            <svg viewBox={`0 0 ${chart.w} ${chart.h}`} className="w-full text-info">
              <path d={chart.path} fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
              <span>{inputVar}={round(points[0].input)} → {outputVar}={round(points[0].output)}</span>
              <span>{inputVar}={round(points[points.length - 1].input)} → {outputVar}={round(points[points.length - 1].output)}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Engineering notes (Phase 3, item 13) — shared between Registry (variables) and Methodology
// (formulas), append-only (no edit) same as the rest of this module's audit trail. ----------------

function NotesSection({ entityType, entityId, notes, router, sheetId }) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const mine = notes.filter((n) => n.entityType === entityType && n.entityId === entityId);

  async function add() {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await api('/api/calc-notes', { method: 'POST', body: { entityType, entityId, note: draft.trim(), sheetId } });
      setDraft('');
      router.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    try {
      await api(`/api/calc-notes/${id}`, { method: 'DELETE' });
      router.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  return (
    <div className="mt-1.5">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <MessageSquare className="size-3" />{mine.length > 0 ? `${mine.length} note${mine.length === 1 ? '' : 's'}` : 'Add note'}
        <ChevronDown className={`size-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-1.5 flex flex-col gap-1.5 rounded-md border bg-muted/20 p-2">
          {mine.map((n) => (
            <div key={n.id} className="flex items-start justify-between gap-2 text-xs">
              <div>
                <span className="text-muted-foreground">{n.author || 'unknown'} · {n.ts}</span>
                <div>{n.note}</div>
              </div>
              <button onClick={() => remove(n.id)} className="shrink-0 text-muted-foreground hover:text-destructive">×</button>
            </div>
          ))}
          <div className="flex gap-1.5">
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add an engineering note…" className="h-7 text-xs" />
            <Button size="sm" className="h-7" disabled={busy} onClick={add}>Add</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Registry -------------------------------------------------------------------------------

// Dropdown for the common case (a unit already used elsewhere in this methodology), text input for
// anything else — avoids forcing every possible mathjs unit string into a fixed list.
function UnitSelect({ value, onChange, knownUnits }) {
  const options = [...new Set([...COMMON_UNITS, ...knownUnits])].filter(Boolean);
  const isCustom = value !== '' && !options.includes(value);
  const [custom, setCustom] = useState(isCustom);
  if (custom) {
    return (
      <div className="flex gap-1">
        <Input placeholder="Unit, e.g. mm" value={value} onChange={(e) => onChange(e.target.value)} className="flex-1" />
        <Button type="button" variant="ghost" size="sm" onClick={() => { setCustom(false); onChange(''); }}>List</Button>
      </div>
    );
  }
  return (
    <Select value={value || '-'} onValueChange={(v) => (v === '__custom__' ? setCustom(true) : onChange(v))}>
      <SelectTrigger><SelectValue placeholder="Unit" /></SelectTrigger>
      <SelectContent>
        {options.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
        <SelectItem value="__custom__">Custom…</SelectItem>
      </SelectContent>
    </Select>
  );
}

function RegistryPanel({ variables, liveValues, router, notes, sheetId }) {
  const [form, setForm] = useState({ name: '', type: 'input', unit: '', value: '', columns: '' });
  const [saving, setSaving] = useState(false);
  const knownUnits = useMemo(() => variables.map((v) => v.unit).filter(Boolean), [variables]);

  async function add() {
    if (!form.name.trim()) return;
    if (form.type === 'array' && !form.columns.trim()) return;
    setSaving(true);
    try {
      const columns = form.type === 'array' ? form.columns.split(',').map((c) => c.trim()).filter(Boolean) : undefined;
      await api('/api/calc-variables', { method: 'POST', body: { ...form, columns, sheetId } });
      showToast('Variable added');
      setForm({ name: '', type: 'input', unit: '', value: '', columns: '' });
      router.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    try {
      await api(`/api/calc-variables/${id}`, { method: 'DELETE' });
      router.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  const arrayVars = variables.filter((v) => v.type === 'array');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" asChild>
          <a href={`/api/calc-export?sheetId=${sheetId}`}><FileSpreadsheet className="size-3.5" data-icon="inline-start" />Export to Excel</a>
        </Button>
        <CalcValueImport router={router} sheetId={sheetId} />
      </div>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Card className="md:col-span-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Value</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {variables.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-mono">
                  {v.name}
                  <NotesSection entityType="variable" entityId={v.id} notes={notes} router={router} sheetId={sheetId} />
                </TableCell>
                <TableCell><Badge className={TYPE_STYLE[v.type].cls} variant="outline">{TYPE_STYLE[v.type].label}</Badge></TableCell>
                <TableCell className="text-muted-foreground">{v.unit || '—'}</TableCell>
                <TableCell className="font-mono">
                  {v.type === 'computed'
                    ? <span className="text-success">{liveValues[v.name] === null || liveValues[v.name] === undefined ? '—' : round(liveValues[v.name])}</span>
                    : v.type === 'array'
                      ? <span className="text-muted-foreground">{v.arrayRows?.length ?? 0} rows</span>
                      : v.value}
                </TableCell>
                <TableCell className="text-right">
                  {v.type !== 'computed' && (
                    <Button variant="ghost" size="icon-sm" onClick={() => remove(v.id)}><Trash2 className="size-3.5" /></Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="px-4 pb-3 text-xs text-muted-foreground">Computed variables are read-only here — they're written by a formula in Methodology.</p>
      </Card>

      <Card className="h-fit">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Plus className="size-3.5" /> Add variable</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Input placeholder="Name, e.g. CorrosionAllowance" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Select value={form.type} onValueChange={(type) => setForm({ ...form, type })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="input">Input</SelectItem>
              <SelectItem value="constant">Constant</SelectItem>
              <SelectItem value="array">Array (list)</SelectItem>
            </SelectContent>
          </Select>
          {form.type === 'array' ? (
            <Input placeholder="Columns, e.g. Label, Diameter, Area" value={form.columns} onChange={(e) => setForm({ ...form, columns: e.target.value })} />
          ) : (
            <>
              <UnitSelect value={form.unit} onChange={(unit) => setForm({ ...form, unit })} knownUnits={knownUnits} />
              <Input placeholder="Value" type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
            </>
          )}
          <Button onClick={add} disabled={saving}>{saving ? 'Adding…' : 'Add to registry'}</Button>
        </CardContent>
      </Card>
    </div>

    {arrayVars.length > 0 && (
      <div className="flex flex-col gap-3">
        <div className="text-xs font-semibold uppercase text-muted-foreground">Array variables</div>
        {arrayVars.map((v) => <ArrayVariableCard key={v.id} variable={v} router={router} />)}
      </div>
    )}
    </div>
  );
}

// Row editor for an array/list variable (Phase 3, item 14) — one input per declared column, same
// add/delete-row shape as TableCard's lookup-table rows below.
function ArrayVariableCard({ variable, router }) {
  const [newRow, setNewRow] = useState({});
  const [busy, setBusy] = useState(false);
  const columns = variable.arrayColumns || [];
  const rows = variable.arrayRows || [];

  async function saveRows(nextRows) {
    setBusy(true);
    try {
      await api(`/api/calc-variables/${variable.id}`, { method: 'PATCH', body: { rows: nextRows } });
      router.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function addRow() {
    if (columns.some((c) => !newRow[c])) return;
    const row = {};
    columns.forEach((c) => { const n = Number(newRow[c]); row[c] = Number.isNaN(n) ? newRow[c] : n; });
    await saveRows([...rows, row]);
    setNewRow({});
  }

  async function deleteRow(i) {
    await saveRows(rows.filter((_, idx) => idx !== i));
  }

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm font-mono">{variable.name}</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => <TableHead key={c}>{c}</TableHead>)}
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                {columns.map((c) => <TableCell key={c} className="font-mono">{r[c]}</TableCell>)}
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon-sm" disabled={busy} onClick={() => deleteRow(i)}><Trash2 className="size-3.5" /></Button>
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              {columns.map((c) => (
                <TableCell key={c}>
                  <Input placeholder={c} className="h-7 w-24 font-mono text-xs" value={newRow[c] ?? ''} onChange={(e) => setNewRow({ ...newRow, [c]: e.target.value })} />
                </TableCell>
              ))}
              <TableCell className="text-right">
                <Button size="icon-sm" variant="outline" disabled={busy} onClick={addRow}><Plus className="size-3.5" /></Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---- Excel import (Phase 3.3) — round-trips the "Variables" sheet the Export button produces:
// Name/Value columns, matched by exact name against existing registry variables. Never creates a
// variable and never touches a computed one — see lib/calc-import.mjs for why.
function CalcValueImport({ router, sheetId }) {
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  async function pick(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('sheetId', sheetId);
      const { preview } = await api('/api/calc-import', { method: 'POST', body: fd });
      setPreview(preview);
    } catch (err) {
      showToast(err.message, 'error');
      setFile(null);
    }
    setBusy(false);
    e.target.value = '';
  }

  async function confirm() {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('confirm', '1');
      fd.append('sheetId', sheetId);
      const res = await api('/api/calc-import', { method: 'POST', body: fd });
      showToast(`Updated ${res.updated} variable value(s)`);
      setPreview(null);
      setFile(null);
      router.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
    setBusy(false);
  }

  return (
    <>
      <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={pick} />
      <Button variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
        <Upload className="size-3.5" data-icon="inline-start" />{busy && !preview ? 'Reading…' : 'Import values (.xlsx)'}
      </Button>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader><DialogTitle>Import preview — {preview?.filename}</DialogTitle></DialogHeader>
          {preview && (
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-muted-foreground">
                {preview.totalRows} row(s) read from sheet "{preview.sheetName}"
                {preview.totalSkipped > 0 && <> · {preview.totalSkipped} row(s) skipped (missing name/value)</>}
              </p>
              <div>
                <div className="mb-1 text-xs font-semibold text-success">{preview.matched.length} will update</div>
                <div className="max-h-32 overflow-auto rounded border text-xs">
                  {preview.matched.map((m) => (
                    <div key={m.id} className="flex justify-between border-b px-2 py-1 last:border-b-0">
                      <span className="font-mono">{m.name}</span><span>{m.oldValue} → <span className="font-medium">{m.newValue}</span> {m.unit}</span>
                    </div>
                  ))}
                  {preview.matched.length === 0 && <div className="px-2 py-1 text-muted-foreground">None</div>}
                </div>
              </div>
              {preview.skippedComputed.length > 0 && (
                <p className="text-xs text-warning">Skipped (computed, can't be overwritten by import): {preview.skippedComputed.join(', ')}</p>
              )}
              {preview.unmatched.length > 0 && (
                <p className="text-xs text-muted-foreground">No matching registry variable (not created): {preview.unmatched.join(', ')}</p>
              )}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
                <Button disabled={busy || preview.matched.length === 0} onClick={confirm}>
                  {busy ? 'Importing…' : `Update ${preview.matched.length} value(s)`}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---- Library --------------------------------------------------------------------------------

function LibraryPanel({ formulas, router, sheetId }) {
  async function importItem(item) {
    try {
      await api('/api/calc-formulas', { method: 'POST', body: { libraryId: item.id, sheetId } });
      showToast(`${item.name} imported — pending approval`);
      router.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  return (
    <div>
      <p className="mb-3 text-xs text-muted-foreground">
        Pre-cited formulas from published codes. Importing creates a formula in Methodology tagged
        <span className="font-medium text-foreground"> Pending approval</span> — a code authority still has to approve it before
        it's trusted in a project, same as any company-authored formula.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {LIBRARY.map((item) => {
          const alreadyImported = formulas.some((f) => f.outputVar === item.outputVar && f.source);
          return (
            <Card key={item.id}>
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-medium">{item.name}</div>
                  {item.url && (
                    <a href={item.url} target="_blank" rel="noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground">
                      <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{item.standard} · {item.clause}{item.edition ? ` · ${item.edition}` : ''}</div>
                <div className="mt-2 rounded bg-muted px-2 py-1.5 font-mono text-xs">{item.expr}</div>
                <div className="mt-1.5 text-xs text-muted-foreground">{item.note}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {item.requiredVars.map((rv) => <Badge key={rv.name} variant="secondary">{rv.name}</Badge>)}
                </div>
                <Button
                  disabled={alreadyImported} onClick={() => importItem(item)}
                  className="mt-3 w-full" size="sm" variant={alreadyImported ? 'secondary' : 'default'}
                >
                  {alreadyImported ? 'Already in methodology' : 'Add to methodology'}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ---- Methodology ----------------------------------------------------------------------------

function MethodologyPanel({ formulas, validations, nameList, router, variables, tables, formulaTests, snapshots, notes, sheetId }) {
  const [editingId, setEditingId] = useState(null);
  const [draftExpr, setDraftExpr] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [draftGuard, setDraftGuard] = useState('');
  const [newF, setNewF] = useState({ name: '', outputVar: '', expr: '', unit: '', standard: '', clause: '', edition: '' });
  const knownUnits = useMemo(() => variables.map((v) => v.unit).filter(Boolean), [variables]);
  const [newVal, setNewVal] = useState({ name: '', expr: '', severity: 'warning', message: '' });
  const [busy, setBusy] = useState(false);
  const [impactFor, setImpactFor] = useState(null);
  const [impact, setImpact] = useState(null);

  function runImpact(f) {
    setImpactFor(f.id);
    setImpact(changeImpact(variables, formulas, snapshots, validations, { formulaId: f.id, newVersion: f.curV, tables }));
  }

  function startEdit(f) {
    setEditingId(f.id);
    const curVer = f.versions.find((v) => v.v === f.curV);
    setDraftExpr(curVer.expr);
    setDraftNote('');
    setDraftGuard(curVer.guardExpr || '');
  }

  async function saveVersion(f) {
    setBusy(true);
    try {
      await api(`/api/calc-formulas/${f.id}`, { method: 'PATCH', body: { expr: draftExpr, note: draftNote, guardExpr: draftGuard } });
      showToast('Saved as new version — status reset to draft');
      setEditingId(null);
      router.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id, status) {
    try {
      await api(`/api/calc-formulas/${id}`, { method: 'PATCH', body: { status, sheetId } });
      router.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function addFormula() {
    if (!newF.name.trim() || !newF.outputVar.trim() || !newF.expr.trim()) return;
    setBusy(true);
    try {
      await api('/api/calc-formulas', { method: 'POST', body: newF });
      showToast('Formula added as Draft');
      setNewF({ name: '', outputVar: '', expr: '', unit: '', standard: '', clause: '', edition: '' });
      router.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function addValidation() {
    if (!newVal.name.trim() || !newVal.expr.trim()) return;
    setBusy(true);
    try {
      await api('/api/calc-validations', { method: 'POST', body: newVal });
      setNewVal({ name: '', expr: '', severity: 'warning', message: '' });
      router.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeValidation(id) {
    try {
      await api(`/api/calc-validations/${id}`, { method: 'DELETE' });
      router.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {formulas.map((f) => {
        const ver = f.versions.find((v) => v.v === f.curV);
        const deps = extractDeps(ver.expr, nameList).filter((n) => n !== f.outputVar);
        const isEditing = editingId === f.id;
        return (
          <Card key={f.id}>
            <CardContent className="p-3">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{f.name}</span>
                  <Badge variant="outline">v{f.curV}</Badge>
                  <Badge className={STATUS_STYLE[f.status].cls} variant="outline">{STATUS_STYLE[f.status].label}</Badge>
                  <span className="font-mono text-xs text-muted-foreground">→ {f.outputVar}</span>
                </div>
                <div className="flex items-center gap-3">
                  {f.status === 'draft' && (
                    <button onClick={() => setStatus(f.id, 'pending')} className="text-xs text-info hover:underline">Submit for review</button>
                  )}
                  {f.status === 'pending' && (
                    <button onClick={() => setStatus(f.id, 'approved')} className="flex items-center gap-1 text-xs text-success hover:underline">
                      <ShieldCheck className="size-3" /> Approve
                    </button>
                  )}
                  {!isEditing && snapshots.length > 0 && f.versions.length > 1 && (
                    <button onClick={() => runImpact(f)} className="text-xs text-muted-foreground hover:text-foreground">Impact analysis</button>
                  )}
                  {!isEditing && <button onClick={() => startEdit(f)} className="text-xs text-muted-foreground hover:text-foreground">Edit</button>}
                </div>
              </div>

              {f.source && <div className="mb-1.5 text-xs text-muted-foreground">Source: {f.source.standard} · {f.source.clause}{f.source.edition ? ` · ${f.source.edition}` : ''}</div>}
              <NotesSection entityType="formula" entityId={f.id} notes={notes} router={router} />

              {impactFor === f.id && impact && (
                <div className="mb-2 rounded-md border p-2 text-xs">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-medium">Impact of v{f.curV} on {impact.length} snapshot{impact.length === 1 ? '' : 's'} that used an earlier version</span>
                    <button onClick={() => setImpactFor(null)} className="text-muted-foreground hover:text-foreground">×</button>
                  </div>
                  {impact.length === 0 && <div className="text-muted-foreground">No past snapshot pinned this formula.</div>}
                  {impact.map((r) => (
                    <div key={r.snapshotId} className={`mt-1 rounded px-2 py-1 ${r.unchanged ? 'bg-success/5 text-success' : 'bg-warning/10 text-warning'}`}>
                      <span className="font-medium">{r.label}</span>{' — '}
                      {r.unchanged ? 'unchanged' : (
                        <>
                          {r.changedOutputs.map((c) => `${c.variable}: ${round(c.before)} → ${round(c.after)}`).join(', ')}
                          {r.flippedChecks.length > 0 && ` · flips: ${r.flippedChecks.map((c) => `${c.name} (${c.before ? 'pass' : 'fail'}→${c.after ? 'pass' : 'fail'})`).join(', ')}`}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {isEditing ? (
                <div className="mt-2 flex flex-col gap-2">
                  <Input value={draftExpr} onChange={(e) => setDraftExpr(e.target.value)} className="font-mono text-sm" />
                  <Input placeholder="Change note, e.g. tightened weld-efficiency margin" value={draftNote} onChange={(e) => setDraftNote(e.target.value)} />
                  <Input placeholder="Guard (optional), e.g. Temperature < 100 — skips this formula when false" value={draftGuard} onChange={(e) => setDraftGuard(e.target.value)} className="font-mono text-sm" />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => saveVersion(f)} disabled={busy}>Save as v{f.curV + 1} (resets to draft)</Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="rounded bg-muted px-2 py-1.5 font-mono text-sm">{ver.expr}</div>
                  {ver.guardExpr && <div className="mt-1 text-xs text-muted-foreground">Guard: <span className="font-mono">{ver.guardExpr}</span> — skipped when false</div>}
                </>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-1">
                <span className="flex items-center gap-1 text-xs text-muted-foreground"><GitBranch className="size-3" /> depends on:</span>
                {deps.length === 0 && <span className="text-xs text-muted-foreground">none</span>}
                {deps.map((d) => <Badge key={d} className="text-info bg-info/10 ring-1 ring-inset ring-info/20" variant="outline">{d}</Badge>)}
              </div>

              <FormulaTests
                formula={f} variables={variables} formulas={formulas} tables={tables}
                tests={formulaTests.filter((t) => t.formulaId === f.id)} router={router}
              />
            </CardContent>
          </Card>
        );
      })}

      <Card className="border-dashed">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Plus className="size-3.5" /> Add formula</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <Input placeholder="Formula name" value={newF.name} onChange={(e) => setNewF({ ...newF, name: e.target.value })} />
            <Input placeholder="Output variable name" value={newF.outputVar} onChange={(e) => setNewF({ ...newF, outputVar: e.target.value })} className="font-mono" />
            <Input placeholder="Expression" value={newF.expr} onChange={(e) => setNewF({ ...newF, expr: e.target.value })} className="font-mono" />
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
            <UnitSelect value={newF.unit} onChange={(unit) => setNewF({ ...newF, unit })} knownUnits={knownUnits} />
            <div />
            <div />
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
            <Input placeholder="Standard, e.g. ASME BPVC Section VIII, Division 1 (optional)" value={newF.standard} onChange={(e) => setNewF({ ...newF, standard: e.target.value })} />
            <Input placeholder="Clause, e.g. UG-27(c)(1) (optional)" value={newF.clause} onChange={(e) => setNewF({ ...newF, clause: e.target.value })} />
            <Input placeholder="Edition, e.g. 2023 Edition (optional)" value={newF.edition} onChange={(e) => setNewF({ ...newF, edition: e.target.value })} />
          </div>
          <Button onClick={addFormula} disabled={busy} size="sm" className="mt-2">Add formula</Button>
          <p className="mt-2 text-xs text-muted-foreground">New formulas start as Draft and must be submitted, then approved, before Project trusts them.</p>
        </CardContent>
      </Card>

      <div className="pt-2">
        <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Validation rules</div>
        <div className="flex flex-col gap-2">
          {validations.map((v) => (
            <Card key={v.id}>
              <CardContent className="flex items-start justify-between gap-2 p-2.5">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{v.name}</span>
                    <Badge className={v.severity === 'fail' ? 'text-destructive bg-destructive/10 ring-1 ring-inset ring-destructive/20' : 'text-warning bg-warning/10 ring-1 ring-inset ring-warning/20'} variant="outline">
                      {v.severity === 'fail' ? 'Fail if false' : 'Warn if false'}
                    </Badge>
                  </div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">{v.expr}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{v.message}</div>
                </div>
                <Button variant="ghost" size="icon-sm" onClick={() => removeValidation(v.id)} className="shrink-0"><Trash2 className="size-3.5" /></Button>
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="mt-2 border-dashed">
          <CardContent className="p-3">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <Input placeholder="Rule name" value={newVal.name} onChange={(e) => setNewVal({ ...newVal, name: e.target.value })} />
              <Input placeholder="Boolean expression, e.g. SelectedThickness >= RequiredThickness" value={newVal.expr} onChange={(e) => setNewVal({ ...newVal, expr: e.target.value })} className="font-mono" />
              <Select value={newVal.severity} onValueChange={(severity) => setNewVal({ ...newVal, severity })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="fail">Fail</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="Message shown when it triggers" value={newVal.message} onChange={(e) => setNewVal({ ...newVal, message: e.target.value })} />
            </div>
            <Button onClick={addValidation} disabled={busy} size="sm" className="mt-2">Add validation rule</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Phase 1.4 — live pass/fail preview against the CURRENT methodology (runFormulaTests, same
// function the save-time gate uses), plus add/remove test cases. "Submit for review" is blocked
// server-side when any test fails — this panel is what makes that failure legible before it happens.
function FormulaTests({ formula, variables, formulas, tables, tests, router }) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newTest, setNewTest] = useState({ name: '', inputs: {}, expectedOutput: '', tolerance: '' });

  const results = useMemo(
    () => runFormulaTests(variables, formulas, formula.id, tests, tables),
    [variables, formulas, formula.id, tests, tables]
  );

  // Phase 3 dropdown UX pass — one input per variable the formula's current expression actually
  // depends on (closes V1.4's "guided add-test form" open item), instead of a raw `key=value,
  // key=value` text field. Array variables are excluded — they're not overridable via a single
  // number and a test pins them via the live registry's rows instead.
  const nameList = variables.map((v) => v.name);
  const varByName = Object.fromEntries(variables.map((v) => [v.name, v]));
  const curExpr = formula.versions.find((v) => v.v === formula.curV)?.expr || '';
  const depVars = extractDeps(curExpr, nameList).filter((n) => n !== formula.outputVar && varByName[n]?.type !== 'array');

  function startAdding() {
    const inputs = {};
    depVars.forEach((n) => { inputs[n] = varByName[n]?.value ?? ''; });
    setNewTest({ name: '', inputs, expectedOutput: '', tolerance: '' });
    setAdding(true);
  }

  async function addTest() {
    if (!newTest.name.trim() || newTest.expectedOutput === '') return;
    setBusy(true);
    try {
      const inputs = {};
      depVars.forEach((n) => { if (newTest.inputs[n] !== '' && newTest.inputs[n] !== undefined) inputs[n] = Number(newTest.inputs[n]); });
      await api('/api/calc-formula-tests', {
        method: 'POST',
        body: {
          formulaId: formula.id, name: newTest.name.trim(), inputs,
          expectedOutput: Number(newTest.expectedOutput), tolerance: newTest.tolerance === '' ? undefined : Number(newTest.tolerance),
        },
      });
      showToast('Test case added');
      setNewTest({ name: '', inputs: {}, expectedOutput: '', tolerance: '' });
      setAdding(false);
      router.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeTest(id) {
    try {
      await api(`/api/calc-formula-tests/${id}`, { method: 'DELETE' });
      router.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  return (
    <div className="mt-3 border-t pt-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase text-muted-foreground">
          Tests {results.length > 0 && `(${results.filter((r) => r.pass).length}/${results.length} passing)`}
        </span>
        <button onClick={() => (adding ? setAdding(false) : startAdding())} className="text-xs text-info hover:underline">{adding ? 'Cancel' : '+ Add test'}</button>
      </div>
      {results.length === 0 && !adding && <p className="text-xs text-muted-foreground">No test cases yet — submitting for review won't be blocked, but nothing's verifying this formula either.</p>}
      <div className="flex flex-col gap-1">
        {results.map((r) => (
          <div key={r.id} className={`flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs ${r.pass ? 'border-success/20 bg-success/5 text-success' : 'border-destructive/20 bg-destructive/10 text-destructive'}`}>
            <span className="flex items-center gap-1.5">
              {r.pass ? <CheckCircle2 className="size-3 shrink-0" /> : <XCircle className="size-3 shrink-0" />}
              {r.name}
              <span className="text-muted-foreground">expected {r.expectedOutput}, got {Number.isNaN(r.actual) ? 'error' : round(r.actual)}</span>
            </span>
            <button onClick={() => removeTest(r.id)} className="shrink-0 text-muted-foreground hover:text-foreground"><Trash2 className="size-3" /></button>
          </div>
        ))}
      </div>
      {adding && (
        <div className="mt-2 flex flex-col gap-1.5 rounded border border-dashed p-2">
          <Input placeholder="Test name, e.g. Design case: 42 bar @ 250°C" value={newTest.name} onChange={(e) => setNewTest({ ...newTest, name: e.target.value })} className="h-7 text-xs" />
          {depVars.length > 0 ? (
            <div className="grid grid-cols-2 gap-1.5">
              {depVars.map((n) => (
                <div key={n} className="flex items-center gap-1">
                  <span className="w-24 shrink-0 truncate font-mono text-xs text-muted-foreground" title={n}>{n}</span>
                  <Input
                    type="number" className="h-7 text-xs" value={newTest.inputs[n] ?? ''}
                    onChange={(e) => setNewTest({ ...newTest, inputs: { ...newTest.inputs, [n]: e.target.value } })}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">This formula has no overridable inputs (only array-variable dependencies).</p>
          )}
          <div className="grid grid-cols-2 gap-1.5">
            <Input placeholder={`Expected ${formula.outputVar}`} type="number" value={newTest.expectedOutput} onChange={(e) => setNewTest({ ...newTest, expectedOutput: e.target.value })} className="h-7 text-xs" />
            <Input placeholder="Tolerance (default 0.01)" type="number" value={newTest.tolerance} onChange={(e) => setNewTest({ ...newTest, tolerance: e.target.value })} className="h-7 text-xs" />
          </div>
          <Button size="sm" onClick={addTest} disabled={busy} className="self-start">Add test case</Button>
        </div>
      )}
    </div>
  );
}

// ---- Audit ------------------------------------------------------------------------------------

function AuditPanel({ variables, formulas, tables, snapshots, router }) {
  const [reproView, setReproView] = useState(null);

  function reproduce(snap) {
    const { values } = computeAll(variables, formulas, {
      formulaVersionOverride: snap.formulaVersionOverride, inputOverride: snap.inputOverride, tables,
    });
    const matches = Object.keys(snap.results).every((k) => round(values[k]) === round(snap.results[k]));
    setReproView({ snap, values, matches });
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div>
        <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Formula version history</div>
        <div className="flex flex-col gap-3">
          {formulas.map((f) => (
            <Card key={f.id}>
              <CardContent className="p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-sm font-medium">{f.name}</span>
                  <Badge className={STATUS_STYLE[f.status].cls} variant="outline">{STATUS_STYLE[f.status].label}</Badge>
                </div>
                <div className="flex flex-col gap-2">
                  {[...f.versions].reverse().map((ver) => (
                    <div key={ver.v} className="border-l-2 pl-2 text-xs">
                      <div className="flex items-center gap-2">
                        <Badge className={ver.v === f.curV ? 'text-success bg-success/10 ring-1 ring-inset ring-success/20' : ''} variant="outline">
                          v{ver.v}{ver.v === f.curV ? ' · current' : ''}
                        </Badge>
                        <span className="text-muted-foreground">{ver.ts}</span>
                      </div>
                      <div className="mt-1 font-mono text-muted-foreground">{ver.expr}</div>
                      <div className="mt-0.5 text-muted-foreground">{ver.note}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Project snapshots</div>
        {snapshots.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="p-3 text-xs text-muted-foreground">
              No snapshots yet — save one from the Project panel to freeze inputs + formula versions + results.
            </CardContent>
          </Card>
        )}
        <div className="flex flex-col gap-2">
          {snapshots.map((s) => (
            <Card key={s.id}>
              <CardContent className="p-3 text-xs">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-medium">{s.label}</span>
                  <span className="text-muted-foreground">{s.ts}</span>
                </div>
                <div className="mb-2 text-muted-foreground">{Object.entries(s.results).map(([k, v]) => `${k}=${round(v)}`).join('  ·  ')}</div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => reproduce(s)}>
                    <RotateCcw className="size-3" data-icon="inline-start" /> Reproduce with current engine
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <a href={`/api/calc-snapshots/${s.id}/pdf`} target="_blank" rel="noreferrer">
                      <FileTextIcon className="size-3" data-icon="inline-start" /> Download PDF
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {reproView && (
          <Card className={`mt-3 ${reproView.matches ? 'border-success/20 bg-success/5' : 'border-destructive/20 bg-destructive/10'}`}>
            <CardContent className="p-3 text-xs">
              <div className="mb-1 flex items-center justify-between">
                <div className={`flex items-center gap-1.5 font-medium ${reproView.matches ? 'text-success' : 'text-destructive'}`}>
                  {reproView.matches ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
                  {reproView.matches ? 'Reproduced exactly' : 'Result differs from snapshot'}
                </div>
                <button onClick={() => setReproView(null)} className="text-muted-foreground hover:text-foreground">×</button>
              </div>
              <div className="text-muted-foreground">
                Replayed {reproView.snap.label} using its pinned formula versions and locked inputs, regardless of
                what the methodology looks like right now.
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ---- Tables (Phase 1.3) ---------------------------------------------------------------------

// In-place searchable project/sheet switcher (sidebar header breadcrumb) — same open/type/filter/pick
// shape as PrWorkspace's ItemSearchField, generalized over item shape so both switchers share one
// component instead of two near-duplicates. Items load lazily on first open, not on every workspace
// mount. `trigger` is a node (not just text) so the breadcrumb segment itself — project no., sheet
// name — doubles as the dropdown's button, chevron included, instead of a separate "Switch X" link.
function InlineSwitcher({ trigger, triggerClassName, placeholder, loadItems, getKey, getLabel, getSub, onPick }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (!open && items === null) {
      setLoading(true);
      try { setItems(await loadItems()); } catch { setItems([]); } finally { setLoading(false); }
    }
    setOpen((o) => !o);
  }

  const t = q.trim().toLowerCase();
  const filtered = (items || []).filter((it) => !t
    || getLabel(it).toLowerCase().includes(t) || (getSub(it) || '').toLowerCase().includes(t));

  return (
    <div className="relative min-w-0">
      <button type="button" onClick={toggle} className={triggerClassName}>
        {trigger}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-md border bg-popover text-popover-foreground shadow-md">
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder={placeholder} className="m-1 h-7 w-[calc(100%-0.5rem)] text-xs" />
          <div className="max-h-56 overflow-auto py-1">
            {loading && <div className="px-3 py-1.5 text-xs text-muted-foreground">Loading…</div>}
            {!loading && filtered.map((it) => (
              <button key={getKey(it)} type="button"
                className="flex w-full flex-col items-start gap-0 px-3 py-1.5 text-left text-xs hover:bg-muted/40"
                onMouseDown={() => { onPick(it); setOpen(false); setQ(''); }}>
                <span className="font-medium text-foreground">{getLabel(it)}</span>
                {getSub(it) && <span className="text-[11px] text-muted-foreground">{getSub(it)}</span>}
              </button>
            ))}
            {!loading && filtered.length === 0 && <div className="px-3 py-1.5 text-xs text-muted-foreground">No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// Dropdown of existing registry variable names, custom fallback — used for the "X column" field
// below, which is almost always meant to line up with the variable LOOKUP()'s x-argument actually
// passes at call time.
function NameSelect({ value, onChange, names, placeholder }) {
  const isCustom = value !== '' && !names.includes(value);
  const [custom, setCustom] = useState(isCustom);
  if (custom) {
    return (
      <div className="flex gap-1">
        <Input placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="flex-1" />
        <Button type="button" variant="ghost" size="sm" onClick={() => { setCustom(false); onChange(''); }}>List</Button>
      </div>
    );
  }
  return (
    <Select value={value || undefined} onValueChange={(v) => (v === '__custom__' ? setCustom(true) : onChange(v))}>
      <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {names.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
        <SelectItem value="__custom__">Custom…</SelectItem>
      </SelectContent>
    </Select>
  );
}

function TablesPanel({ tables, router, nameList, variables }) {
  const [newTable, setNewTable] = useState({ name: '', standard: '', xColumn: '', xUnit: '', colName: '', colUnit: '' });
  const [busy, setBusy] = useState(false);
  const knownUnits = useMemo(() => variables.map((v) => v.unit).filter(Boolean), [variables]);

  async function addTable() {
    if (!newTable.name.trim() || !newTable.xColumn.trim() || !newTable.colName.trim()) return;
    setBusy(true);
    try {
      await api('/api/calc-tables', {
        method: 'POST',
        body: {
          name: newTable.name.trim(), standard: newTable.standard.trim() || null,
          xColumn: newTable.xColumn.trim(), xUnit: newTable.xUnit.trim() || null,
          columns: [{ name: newTable.colName.trim(), unit: newTable.colUnit.trim() || null }],
        },
      });
      showToast('Table added');
      setNewTable({ name: '', standard: '', xColumn: '', xUnit: '', colName: '', colUnit: '' });
      router.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function deleteTable(id) {
    try {
      await api(`/api/calc-tables/${id}`, { method: 'DELETE' });
      router.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Reference a table from a formula with <span className="font-mono text-foreground">LOOKUP("name", x, "column")</span> —
        values between rows interpolate linearly; outside the table's range they extrapolate with a warning.
      </p>
      {tables.map((t) => (
        <TableCard key={t.id} table={t} onDeleteTable={deleteTable} router={router} />
      ))}

      <Card className="border-dashed">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Plus className="size-3.5" /> Add table</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <Input placeholder="Table name, e.g. SA516_70" value={newTable.name} onChange={(e) => setNewTable({ ...newTable, name: e.target.value })} className="font-mono" />
            <Input placeholder="Standard reference (optional)" value={newTable.standard} onChange={(e) => setNewTable({ ...newTable, standard: e.target.value })} />
            <div />
            <NameSelect placeholder="X column, e.g. Temperature" value={newTable.xColumn} onChange={(xColumn) => setNewTable({ ...newTable, xColumn })} names={nameList} />
            <UnitSelect value={newTable.xUnit} onChange={(xUnit) => setNewTable({ ...newTable, xUnit })} knownUnits={knownUnits} />
            <div />
            <Input placeholder="Value column name, e.g. AllowableStress" value={newTable.colName} onChange={(e) => setNewTable({ ...newTable, colName: e.target.value })} />
            <UnitSelect value={newTable.colUnit} onChange={(colUnit) => setNewTable({ ...newTable, colUnit })} knownUnits={knownUnits} />
          </div>
          <Button onClick={addTable} disabled={busy} size="sm" className="mt-2">Add table</Button>
          <p className="mt-2 text-xs text-muted-foreground">One value column for now — add rows once the table exists.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function TableCard({ table, onDeleteTable, router }) {
  const [newRow, setNewRow] = useState({ x: '', values: {} });
  const [busy, setBusy] = useState(false);

  async function addRow() {
    if (newRow.x === '') return;
    setBusy(true);
    try {
      const values = {};
      table.columns.forEach((c) => { values[c.name] = Number(newRow.values[c.name]) || 0; });
      await api(`/api/calc-tables/${table.id}/rows`, { method: 'POST', body: { x: Number(newRow.x), values } });
      setNewRow({ x: '', values: {} });
      router.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function deleteRow(id) {
    try {
      await api(`/api/calc-tables/${table.id}/rows/${id}`, { method: 'DELETE' });
      router.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-mono">{table.name}</CardTitle>
            {table.standard && <div className="mt-0.5 text-xs text-muted-foreground">{table.standard}</div>}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={() => onDeleteTable(table.id)}><Trash2 className="size-3.5" /></Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{table.xColumn}{table.xUnit ? ` (${table.xUnit})` : ''}</TableHead>
              {table.columns.map((c) => <TableHead key={c.name}>{c.name}{c.unit ? ` (${c.unit})` : ''}</TableHead>)}
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono">{r.x}</TableCell>
                {table.columns.map((c) => <TableCell key={c.name} className="font-mono">{r.values[c.name]}</TableCell>)}
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon-sm" onClick={() => deleteRow(r.id)}><Trash2 className="size-3.5" /></Button>
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell>
                <Input type="number" placeholder={table.xColumn} value={newRow.x} onChange={(e) => setNewRow({ ...newRow, x: e.target.value })} className="h-7 w-24 font-mono text-xs" />
              </TableCell>
              {table.columns.map((c) => (
                <TableCell key={c.name}>
                  <Input
                    type="number" placeholder={c.name} className="h-7 w-24 font-mono text-xs"
                    value={newRow.values[c.name] ?? ''}
                    onChange={(e) => setNewRow({ ...newRow, values: { ...newRow.values, [c.name]: e.target.value } })}
                  />
                </TableCell>
              ))}
              <TableCell className="text-right">
                <Button size="icon-sm" variant="outline" disabled={busy} onClick={addRow}><Plus className="size-3.5" /></Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---- Drawings (CALC-CHANGES2.md §B/§C) ---------------------------------------------------------

const DRAWING_STATUSES = ['not_started', 'in_progress', 'under_review', 'approved', 'as_built'];
const DRAWING_STATUS_STYLE = {
  not_started: { label: 'Not started', cls: 'text-muted-foreground bg-muted ring-1 ring-inset ring-border' },
  in_progress: { label: 'In progress', cls: 'text-warning bg-warning/10 ring-1 ring-inset ring-warning/20' },
  under_review: { label: 'Under review', cls: 'text-info bg-info/10 ring-1 ring-inset ring-info/20' },
  approved: { label: 'Approved', cls: 'text-success bg-success/10 ring-1 ring-inset ring-success/20' },
  as_built: { label: 'As built', cls: 'text-success bg-success/10 ring-1 ring-inset ring-success/20' },
};
function formatFileSize(bytes) {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
// §C — the one drawing-progress visual this round builds (everything else from the visualization
// discussion — validation donut, margin gauge, portfolio dashboard — was explicitly rejected).
// green = approved/as_built, yellow = in_progress/under_review, gray = not_started.
function drawingBarColor(status) {
  if (status === 'approved' || status === 'as_built') return 'var(--success)';
  if (status === 'in_progress' || status === 'under_review') return 'var(--warning)';
  return 'var(--muted-foreground)';
}
function DrawingProgressBar({ drawings }) {
  const complete = drawings.filter((d) => d.status === 'approved' || d.status === 'as_built').length;
  const segW = 100 / Math.max(drawings.length, 1);
  const totalBytes = drawings.reduce(
    (sum, d) => sum + (d.files || []).reduce((s, f) => s + (f.fileSize || 0), 0),
    0
  );
  return (
    <div className="flex items-center gap-3">
      <svg viewBox={`0 0 100 10`} className="h-2.5 flex-1" preserveAspectRatio="none">
        {drawings.map((d, i) => (
          <rect key={d.id} x={i * segW} y={0} width={segW - 1} height={10} rx={1} fill={drawingBarColor(d.status)} opacity={0.85} />
        ))}
      </svg>
      <span className="shrink-0 text-xs text-muted-foreground">
        {complete} of {drawings.length} complete{totalBytes > 0 && ` · ${formatFileSize(totalBytes)} total`}
      </span>
    </div>
  );
}

function DrawingFileUpload({ drawingId, router }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);

  async function pick(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      await api(`/api/calc-drawings/${drawingId}/upload`, { method: 'POST', body: fd });
      showToast('File uploaded');
      router.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
    setBusy(false);
    e.target.value = '';
  }

  return (
    <>
      <input ref={fileRef} type="file" accept=".pdf,.dwg,.dxf,.png,.jpg,.jpeg" className="hidden" onChange={pick} />
      <Button variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
        <Upload className="size-3.5" data-icon="inline-start" />{busy ? 'Uploading…' : 'Upload file'}
      </Button>
    </>
  );
}

// function LegacyDrawingCard({ drawing, router }) {
//   const [open, setOpen] = useState(false);
//   const [busy, setBusy] = useState(false);
//   const [form, setForm] = useState({ status: drawing.status, assignedTo: drawing.assignedTo || '', dueDate: drawing.dueDate || '', notes: drawing.notes || '' });

//   async function save(patch) {
//     setBusy(true);
//     try {
//       await api(`/api/calc-drawings/${drawing.id}`, { method: 'PATCH', body: patch });
//       router.refresh();
//     } catch (err) {
//       showToast(err.message, 'error');
//     } finally {
//       setBusy(false);
//     }
//   }

//   async function remove() {
//     setBusy(true);
//     try {
//       await api(`/api/calc-drawings/${drawing.id}`, { method: 'DELETE' });
//       showToast('Drawing deleted');
//       router.refresh();
//     } catch (err) {
//       showToast(err.message, 'error');
//       setBusy(false);
//     }
//   }

//   async function removeFile(fileId) {
//     try {
//       await api(`/api/calc-drawings/${drawing.id}/files/${fileId}`, { method: 'DELETE' });
//       router.refresh();
//     } catch (err) {
//       showToast(err.message, 'error');
//     }
//   }

//   return (
//     <Card>
//       <button className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" onClick={() => setOpen((o) => !o)}>
//         <div className="min-w-0">
//           <div className="text-sm font-medium">{drawing.name}</div>
//           {drawing.drawingType && <div className="text-xs text-muted-foreground">{drawing.drawingType}</div>}
//         </div>
//         <div className="flex shrink-0 items-center gap-2">
//           <Badge className={DRAWING_STATUS_STYLE[drawing.status].cls} variant="outline">{DRAWING_STATUS_STYLE[drawing.status].label}</Badge>
//           <ChevronDown className={`size-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
//         </div>
//       </button>
//       {open && (
//         <CardContent className="flex flex-col gap-3 border-t pt-3">
//           <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
//             <div className="flex flex-col gap-1">
//               <Label className="text-xs">Status</Label>
//               <Select value={form.status} onValueChange={(status) => { setForm({ ...form, status }); save({ status }); }}>
//                 <SelectTrigger><SelectValue /></SelectTrigger>
//                 <SelectContent>
//                   {DRAWING_STATUSES.map((s) => <SelectItem key={s} value={s}>{DRAWING_STATUS_STYLE[s].label}</SelectItem>)}
//                 </SelectContent>
//               </Select>
//             </div>
//             <div className="flex flex-col gap-1">
//               <Label className="text-xs">Assigned to</Label>
//               <Input value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })} onBlur={() => save({ assignedTo: form.assignedTo })} />
//             </div>
//             <div className="flex flex-col gap-1">
//               <Label className="text-xs">Due date</Label>
//               <Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} onBlur={() => save({ dueDate: form.dueDate })} />
//             </div>
//           </div>
//           <div className="flex flex-col gap-1">
//             <Label className="text-xs">Notes</Label>
//             <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} onBlur={() => save({ notes: form.notes })} />
//           </div>

//           <Separator />

//           <div className="flex flex-col gap-1.5">
//             <div className="flex items-center justify-between">
//               <Label className="text-xs">Files</Label>
//               <DrawingFileUpload drawingId={drawing.id} router={router} />
//             </div>
//             {drawing.files.length === 0 && <p className="text-xs text-muted-foreground">No files yet.</p>}
//             {drawing.files.map((f) => (
//               <div key={f.id} className="flex items-center justify-between gap-2 rounded border px-2.5 py-1.5 text-xs">
//                 <a href={`/api/calc-drawings/${drawing.id}/files/${f.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-2 truncate text-primary hover:underline">
//                   <span className="truncate">{f.fileName}</span>
//                   {formatFileSize(f.fileSize) && <span className="shrink-0 text-muted-foreground">{formatFileSize(f.fileSize)}</span>}
//                 </a>
//                 <button onClick={() => removeFile(f.id)} className="shrink-0 text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button>
//               </div>
//             ))}
//           </div>

//           <Button variant="ghost" size="sm" disabled={busy} onClick={remove} className="self-start text-destructive hover:text-destructive">
//             <Trash2 className="size-3.5" data-icon="inline-start" />Delete drawing
//           </Button>
//         </CardContent>
//       )}
//     </Card>
//   );
// }

function DrawingCard({ drawing, router, canApprove, designTeam }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fileBusy, setFileBusy] = useState(null);
  const [comments, setComments] = useState(null); // null = not yet loaded
  const [commentDraft, setCommentDraft] = useState('');
  // Entity-reference tagging (lib/entity-refs.js) — same batched-resolve pattern TicketsPanel.jsx
  // uses: one resolve call per comment thread, not one per comment.
  const [refs, setRefs] = useState({});
  useEffect(() => {
    if (!comments) return;
    const codes = [...new Set(comments.flatMap((c) => findEntityRefTokens(c.body)))];
    if (codes.length === 0) { setRefs({}); return; }
    api(`/api/entity-refs/resolve?codes=${encodeURIComponent(codes.join(','))}`)
      .then((d) => setRefs(d.refs || {}))
      .catch(() => setRefs({}));
  }, [comments]);
  const [form, setForm] = useState({ status: drawing.status, assignedTo: drawing.assignedTo || '', dueDate: drawing.dueDate || '', notes: drawing.notes || '' });
  const loadComments = async () => { if (comments) return; try { setComments(await api(`/api/calc-drawings/${drawing.id}/comments`)); } catch (err) { showToast(err.message, 'error'); } };
  const postComment = async () => {
    if (!commentDraft.trim()) return;
    setBusy(true);
    try {
      await api(`/api/calc-drawings/${drawing.id}/comments`, { method: 'POST', body: { body: commentDraft.trim() } });
      setCommentDraft('');
      setComments(await api(`/api/calc-drawings/${drawing.id}/comments`));
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  };
  const save = async (patch) => { setBusy(true); try { await api(`/api/calc-drawings/${drawing.id}`, { method: 'PATCH', body: patch }); router.refresh(); } catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); } };
  const remove = async () => { setBusy(true); try { await api(`/api/calc-drawings/${drawing.id}`, { method: 'DELETE' }); router.refresh(); } catch (err) { showToast(err.message, 'error'); setBusy(false); } };
  const removeFile = async (fileId) => {
    setFileBusy(fileId);
    try {
      await api(`/api/calc-drawings/${drawing.id}/files/${fileId}`, { method: 'DELETE' });
      router.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setFileBusy(null);
    }
  };
  return <Card>
    <button className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" onClick={() => setOpen((v) => !v)}>
      <div className="min-w-0"><div className="text-sm font-medium">{drawing.dgNo && <span className="text-muted-foreground">{drawing.dgNo} · </span>}{drawing.name}</div>{drawing.drawingType && <div className="text-xs text-muted-foreground">{drawing.drawingType}</div>}</div>
      <div className="flex shrink-0 items-center gap-2">{drawing.customerApprovedAt && <Badge variant="outline" className="border-success text-success">Customer approved {formatDate(drawing.customerApprovedAt)}</Badge>}<Badge className={DRAWING_STATUS_STYLE[drawing.status].cls} variant="outline">{DRAWING_STATUS_STYLE[drawing.status].label}</Badge><ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} /></div>
    </button>
    {open && <CardContent className="flex flex-col gap-3 border-t pt-3">
      <div className="flex justify-end gap-2"><DrawingFileUpload drawingId={drawing.id} router={router} />{canApprove && <Button variant="ghost" size="sm" disabled={busy} onClick={remove} className="text-destructive hover:text-destructive"><Trash2 className="size-3.5" data-icon="inline-start" />Delete drawing</Button>}</div>
      <div className="flex flex-col gap-1.5"><div className="flex items-center justify-between"><Label className="text-xs">Files</Label><span className="text-xs text-muted-foreground">{drawing.files.length} file{drawing.files.length === 1 ? '' : 's'}</span></div>{drawing.files.length === 0 && <p className="text-sm text-muted-foreground">No files yet.</p>}{drawing.files.map((f) => (
  <div key={f.id} className="flex items-center justify-between gap-2 rounded border px-2.5 py-1.5 text-xs">
    <a href={`/api/calc-drawings/${drawing.id}/files/${f.id}`} className="min-w-0 flex-1 truncate text-primary hover:underline">{f.fileName}</a>
    {formatFileSize(f.fileSize) && <span className="shrink-0 text-muted-foreground">{formatFileSize(f.fileSize)}</span>}
    {canApprove && (
      <button onClick={() => removeFile(f.id)} disabled={fileBusy === f.id} className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-50">
        <Trash2 className="size-3.5" />
      </button>
    )}
  </div>
))}</div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Status</Label>
          <Select value={form.status} onValueChange={(status) => { setForm({ ...form, status }); save({ status }); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{DRAWING_STATUSES.filter((s) => canApprove || !['approved', 'as_built'].includes(s)).map((s) => <SelectItem key={s} value={s}>{DRAWING_STATUS_STYLE[s].label}</SelectItem>)}</SelectContent></Select>
          {!canApprove && ['not_started', 'in_progress'].includes(form.status) && (
            <Button size="sm" variant="outline" className="mt-1 w-fit" disabled={busy}
              onClick={() => { setForm({ ...form, status: 'under_review' }); save({ status: 'under_review' }); }}>
              Submit for review
            </Button>
          )}
        </div>
        <div className="flex flex-col gap-1"><Label className="text-xs">Assigned to</Label><Select disabled={!canApprove} value={form.assignedTo || undefined} onValueChange={(assignedTo) => { setForm({ ...form, assignedTo }); save({ assignedTo }); }}><SelectTrigger><SelectValue placeholder="Select a Design teammate" /></SelectTrigger><SelectContent>{designTeam.map((m) => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="flex flex-col gap-1"><Label className="text-xs">Due date</Label><Input type="date" disabled={!canApprove} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} onBlur={() => save({ dueDate: form.dueDate })} /></div>
      </div>
      <div className="flex flex-col gap-1"><Label className="text-xs">Notes</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} onBlur={() => save({ notes: form.notes })} /></div>
      {canApprove && (
        <div className="flex items-center gap-1.5">
          <button type="button" role="switch" aria-checked={!!drawing.customerVisible}
            aria-label="Share with customer" disabled={busy}
            onClick={() => save({ customerVisible: !drawing.customerVisible })}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${drawing.customerVisible ? 'bg-primary' : 'bg-muted-foreground/25'}`}>
            <span className={`inline-block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform ${drawing.customerVisible ? 'translate-x-4' : ''}`} />
          </button>
          <span className="text-xs text-muted-foreground">
            Share with customer{drawing.customerVisible ? ' — visible once status reaches Under review' : ' (not shown in the portal)'}
          </span>
        </div>
      )}
      <div className="flex flex-col gap-1.5 border-t pt-2.5">
        <Label className="text-xs">Comments{drawing.status === 'not_started' || drawing.status === 'in_progress' ? ' (internal only — not visible to the customer yet)' : ''}</Label>
        {drawing.customerVisible && !canApprove ? (
          <p className="text-xs text-muted-foreground">Only the Design Head can view this customer-visible thread.</p>
        ) : comments === null ? (
          <button type="button" className="w-fit text-xs text-primary hover:underline" onClick={loadComments}>Show comments</button>
        ) : (
          <>
            {comments.length === 0 && <p className="text-xs text-muted-foreground">No comments yet.</p>}
            {comments.map((c) => (
              <div key={c.id} className="text-xs">
                <span className="font-medium">{c.author_name}</span>{c.author_type === 'customer' && <Badge variant="outline" className="ml-1.5 text-[10px]">Customer</Badge>}{' '}
                <span className="text-muted-foreground">{formatDate(c.created_at)}</span>
                <LinkifiedText text={c.body} refs={refs} className="mt-0.5 block" />
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <Textarea rows={2} value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} placeholder="Reply…" />
            </div>
            <Button size="sm" variant="outline" className="w-fit" disabled={busy || !commentDraft.trim()} onClick={postComment}>Comment</Button>
          </>
        )}
      </div>
    </CardContent>}
  </Card>;
}

function AddDrawingDialog({ projectId, router }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', drawingType: '', description: '' });
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      await api('/api/calc-drawings', { method: 'POST', body: { projectId, ...form } });
      showToast('Drawing added');
      setForm({ name: '', drawingType: '', description: '' });
      setOpen(false);
      router.refresh();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}><Plus className="size-3.5" data-icon="inline-start" />Add Drawing</Button>
      <DialogContent>
        <DialogHeader><DialogTitle>Add drawing</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-2.5">
          <Input placeholder="Name, e.g. GA Drawing" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input placeholder="Type, e.g. General Arrangement" value={form.drawingType} onChange={(e) => setForm({ ...form, drawingType: e.target.value })} />
          <Textarea rows={2} placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <DialogFooter>
          <Button disabled={busy || !form.name.trim()} onClick={submit}>{busy ? 'Adding…' : 'Add'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Exported for app/calc-drawings/page.js — Drawings' own top-level nav tab reuses this component
// directly rather than duplicating it; Calc Sheets itself no longer renders it (its own `drawings`
// PANELS entry was removed once the standalone tab existed — one door, not two).
export function DrawingsPanel({ drawings, projectId, router, user, designTeam }) {
  const canApprove = ['admin', 'manager', 'executive'].includes(user?.role) || user?.department_roles?.Design === 'head';
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardContent className="py-3">
          <DrawingProgressBar drawings={drawings} />
        </CardContent>
      </Card>
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Design deliverable checklist for this project — not a CAD studio.</p>
        <AddDrawingDialog projectId={projectId} router={router} />
      </div>
      <div className="flex flex-col gap-2">
        {drawings.map((d) => <DrawingCard key={d.id} drawing={d} router={router} canApprove={canApprove} designTeam={designTeam} />)}
        {drawings.length === 0 && <p className="text-sm text-muted-foreground">No drawings yet.</p>}
      </div>
    </div>
  );
}

// ---- Calc Links (round 2 — a calc sheet substantiates a DRAWING, not a bom_assemblies tree node) --
// Client-fetches its own data on mount (same shape as PortfolioPanel below), not the server-hydrated
// `drawings` prop DrawingsPanel uses — a calc<->drawing link is neither sheet- nor registry-scoped.
function CalcDrawingLinksPanel({ projectId }) {
  const [drawings, setDrawings] = useState(null);
  const [sheets, setSheets] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    if (!projectId) return;
    api(`/api/calc-drawings?project_id=${projectId}`).then((d) => setDrawings(d.drawings)).catch((err) => showToast(err.message, 'error'));
    api(`/api/calc-sheets?project_id=${projectId}`).then((d) => setSheets(d.sheets)).catch((err) => showToast(err.message, 'error'));
  }, [projectId]);

  if (!projectId) return <p className="text-sm text-muted-foreground">Open a project to link calc sheets to its drawings.</p>;
  if (!drawings || !sheets) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!drawings.length) return <p className="text-sm text-muted-foreground">No drawings yet — add one in Drawings first.</p>;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">Link a calculation sheet to whichever drawing it substantiates.</p>
      {drawings.map((d) => (
        <DrawingCalcLinksRow key={d.id} drawing={d} sheets={sheets} expanded={expandedId === d.id}
          onToggle={() => setExpandedId(expandedId === d.id ? null : d.id)} />
      ))}
    </div>
  );
}

function DrawingCalcLinksRow({ drawing, sheets, expanded, onToggle }) {
  const [links, setLinks] = useState(null);
  const [pickerValue, setPickerValue] = useState('');

  function loadLinks() {
    api(`/api/calc-drawings/${drawing.id}/calc-sheets`).then(setLinks).catch((err) => showToast(err.message, 'error'));
  }
  useEffect(() => { if (expanded && links === null) loadLinks(); }, [expanded]); // eslint-disable-line react-hooks/exhaustive-deps

  async function link(calcSheetId) {
    setPickerValue('');
    try {
      await api(`/api/calc-drawings/${drawing.id}/calc-sheets`, { method: 'POST', body: { calc_sheet_id: Number(calcSheetId) } });
      loadLinks();
    } catch (err) { showToast(err.message, 'error'); }
  }
  async function unlink(calcSheetId) {
    try {
      await api(`/api/calc-drawings/${drawing.id}/calc-sheets?calc_sheet_id=${calcSheetId}`, { method: 'DELETE' });
      loadLinks();
    } catch (err) { showToast(err.message, 'error'); }
  }

  const linkedIds = new Set((links || []).map((l) => l.id));
  const options = sheets.filter((s) => !linkedIds.has(s.id));

  return (
    <div className="rounded-md border">
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted/40">
        <div className="flex items-center gap-2">
          <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
          <EntityCode code={drawing.dgNo} fallback={drawing.name} />
        </div>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {links ? `${links.length} linked` : ''}
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-2 border-t p-3">
          <Select value={pickerValue} onValueChange={link}>
            <SelectTrigger className="h-8 w-72"><SelectValue placeholder="Link a calculation sheet…" /></SelectTrigger>
            <SelectContent>
              {options.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No matching calc sheets</div>}
              {options.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.cs_no || 'CS'} · {s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {links === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : links.length === 0 ? (
            <p className="text-sm text-muted-foreground">No calculation sheets linked yet.</p>
          ) : (
            <div className="flex flex-col divide-y rounded-md border">
              {links.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Calculator className="size-4 shrink-0 text-muted-foreground" />
                    <EntityCode code={s.cs_no} fallback={s.name} />
                  </div>
                  <Button size="icon-sm" variant="ghost" className="text-danger" onClick={() => unlink(s.id)} aria-label="Unlink">
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Portfolio (cross-project glance, reversal of the earlier §C scope cut) ---------------------
// Client-fetched on tab open rather than server-preloaded with every sheet page — this data spans
// every project, not just the one the workspace is currently scoped to, and is rarely the first
// tab opened. Reuses the exact same getDesignWork() rows the Operations Design master table
// already computes (app/api/calc-portfolio/route.js), not a second cross-project query.
function PortfolioPanel() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api('/api/calc-portfolio').then((d) => setRows(d.rows)).catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>;
  if (!rows) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!rows.length) return <p className="text-sm text-muted-foreground">No projects have a calc sheet or drawing yet.</p>;

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Portfolio — every project</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead><TableHead>Customer</TableHead>
              <TableHead>Design Progress</TableHead><TableHead>Bottleneck</TableHead>
              <TableHead>Calc Status</TableHead><TableHead>Drawings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((w) => (
              <TableRow key={w.id}>
                <TableCell><Link href={`/calc/project/${w.id}`} className="font-medium text-primary hover:underline">{w.project_no}</Link></TableCell>
                <TableCell className="text-muted-foreground">{w.customer_name}</TableCell>
                <TableCell className="font-mono text-xs">{w.designProgress.done}/{w.designProgress.total}</TableCell>
                <TableCell className="text-muted-foreground">{w.bottleneck || '—'}</TableCell>
                <TableCell className="font-mono text-xs">{w.calcStatus.done}/{w.calcStatus.total}</TableCell>
                <TableCell className="font-mono text-xs">{w.drawings.done}/{w.drawings.total}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
