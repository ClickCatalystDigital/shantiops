'use client';

// components/EngineeringWorkspace.jsx — Engineering's cross-project workspace (STERP items 16-19,
// SYSTEM.md §5o): BOM Structure (multi-level assemblies + roll-up drill-down), Where-Used,
// Common/Uncommon, and Engineering Change Notes. Per-project BOM *editing* stays on the project
// page (Engineering's BomPanel/BomTable) — this is the cross-project oversight surface, same split
// InstallationWorkspace draws between the project-page milestone action and its own workspace.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  LayersIcon, SearchIcon, Repeat2Icon, FileEditIcon, PlusIcon,
  ClipboardListIcon, CheckIcon, FileStackIcon, FilterIcon, GitBranchIcon,
} from 'lucide-react';
import { api, showToast, formatDate } from '@/lib/client';
import WorkspaceSidebar from '@/components/WorkspaceSidebar';
import SearchableSelect from '@/components/SearchableSelect';
import BomTemplateManager from '@/components/BomTemplateManager';
import BomStructureTemplateManager from '@/components/BomStructureTemplateManager';
import BomStructureWorkspace from '@/components/bom-structure/BomStructureWorkspace';
import { RaisePrTab, ReleaseBomTab } from '@/components/PrWorkspace';

// Round 3 Phase A — which tabs the shared project-selector header (below) applies to, and in which
// shape. "BOM Templates"/"PR Templates" are deliberately excluded alongside Purchase Requests: both
// BomTemplateManager instances manage reusable, cross-project templates (their own internal
// "Apply to project" picker lives inside a dialog, not the workspace level) — a single/multi
// "current project" doesn't map onto either any more than it does onto Purchase Requests' own
// per-line multi-project repeater.
const SINGLE_PROJECT_TABS = ['structure', 'pr_release'];
const MULTI_PROJECT_TABS = ['where_used', 'common_uncommon', 'ecn'];

// Same labeling convention as ProcurementWorkspace.jsx's projectLabel — a stock/sas BOM row's
// project_id points at the sentinel system project, not a real one; "Stock"/"SO #..." reads better
// than the sentinel's literal placeholder project_no.
function projectLabel(r) {
  if (!r.project_is_system) return r.project_no;
  if (r.source === 'sas') return `SO #${r.sale_order_no || '—'}`;
  if (r.source === 'stock') return 'Stock';
  return r.project_no;
}

// Phase 1 nav reorg (SYSTEM.md): "BOM Structure" -> "BOMs" (label only, key kept as 'structure' so
// BomPanel.jsx's existing ?tab=structure deep link keeps working). The flat "BOM Templates" tab
// (kind="bom") that used to sit here is gone — Structure Templates is a strict superset for
// Engineering/Design's own use (real hierarchy, richer item capture, whole-BOM save) — but the
// underlying bom_templates table/BomTemplateManager component are NOT removed: PR Templates
// (kind="pr") still needs them for pre-filling the Raise PR form, unrelated to the BOM tree, and
// PrWorkspace.jsx still renders a kind="bom" instance for Stores-only heads (no Engineering/Design
// access, so Structure Templates isn't reachable to them either) — deliberately left alone, not
// this round's call to remove.
// Requests' own three tabs (Purchase Requests/Release BOM/PR Templates) added at the end — same
// RaisePrTab/ReleaseBomTab/BomTemplateManager(kind="pr") components /pr already renders, imported
// directly rather than duplicated, so nothing is duplicated at the data layer, only the entry point
// (same precedent Release BOM's own button already established).
const ITEMS = [
  { key: 'structure', label: 'BOMs', icon: LayersIcon },
  { key: 'structure_templates', label: 'Structure Templates', icon: GitBranchIcon },
  { key: 'where_used', label: 'Where-Used', icon: SearchIcon },
  { key: 'common_uncommon', label: 'Common / Uncommon', icon: Repeat2Icon },
  { key: 'ecn', label: 'Change Notes', icon: FileEditIcon },
  { key: 'pr_raise', label: 'Purchase Requests', icon: ClipboardListIcon },
  { key: 'pr_templates', label: 'PR Templates', icon: FileStackIcon },
  { key: 'pr_divider', divider: true },
  { key: 'pr_release', label: 'Release BOM', icon: CheckIcon },
];

// ---------- BOM Structure ----------
// Phase 2 (SYSTEM.md): the flat create-only assembly form/table above was replaced by a real
// two-pane tree+detail workspace — see components/bom-structure/BomStructureWorkspace.jsx.

// ---------- Where-Used ----------

// `projectIds` (round 3 Phase A, optional array of ids — empty/omitted = no filter, matching the
// pre-existing all-projects default): threaded onto the search request as `project_ids=`. Re-runs
// the last query automatically when the shared header's filter changes, but only once a search has
// actually been performed — otherwise there's nothing to re-narrow yet.
function WhereUsedTab({ projectIds = [] }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const idsKey = projectIds.join(',');

  async function runSearch(query) {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const suffix = idsKey ? `&project_ids=${idsKey}` : '';
      setRows(await api(`/api/where-used?q=${encodeURIComponent(query)}${suffix}`));
    } catch (err) { showToast(err.message, 'error'); }
    setLoading(false);
  }

  useEffect(() => {
    if (rows !== null) runSearch(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  return (
    <Card>
      <CardHeader><CardTitle>Where-Used List</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form onSubmit={e => { e.preventDefault(); runSearch(q); }} className="flex gap-2">
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search a part description…" className="max-w-sm" />
          <Button type="submit" disabled={loading}>{loading ? 'Searching…' : 'Search'}</Button>
        </form>
        {rows && (rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No matches.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>MOC</TableHead>
                <TableHead>Size/Spec</TableHead>
                <TableHead>Qty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell>{projectLabel(r)}{r.customer_name ? ` · ${r.customer_name}` : ''}</TableCell>
                  <TableCell>{r.material_description}</TableCell>
                  <TableCell className="text-muted-foreground">{r.moc || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{r.size_spec || '—'}</TableCell>
                  <TableCell className="tnum text-muted-foreground">{r.qty_text || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ))}
      </CardContent>
    </Card>
  );
}

// ---------- Common / Uncommon ----------

// `projectIds` (round 3 Phase A, optional array of ids) — client-fetches /api/part-usage scoped to
// it, rather than filtering a static prop client-side: classification (project_count >= 2) is only
// honest when *recomputed* against the filtered set — filtering pre-computed rows would keep a part
// reading "common" off its unfiltered count even once scoped down to where it barely appears.
function CommonUncommonTab({ projectIds = [] }) {
  const [filter, setFilter] = useState('all');
  const [partUsage, setPartUsage] = useState(null);
  const idsKey = projectIds.join(',');

  useEffect(() => {
    const suffix = idsKey ? `?project_ids=${idsKey}` : '';
    api(`/api/part-usage${suffix}`).then(setPartUsage).catch(err => showToast(err.message, 'error'));
  }, [idsKey]);

  const rows = (partUsage || []).filter(r => filter === 'all' || r.classification === filter);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Common / Uncommon Parts</CardTitle>
        <CardAction>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All parts</SelectItem>
              <SelectItem value="common">Common only</SelectItem>
              <SelectItem value="uncommon">Uncommon only</SelectItem>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent>
        {!partUsage ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Part</TableHead>
              <TableHead>Projects</TableHead>
              <TableHead>Classification</TableHead>
              <TableHead>Used in</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.identity_key}>
                <TableCell className="font-medium">{r.material_description}{r.catalog_item_code && <span className="ml-2 text-xs text-muted-foreground">{r.catalog_item_code}</span>}</TableCell>
                <TableCell className="tnum text-muted-foreground">{r.project_count}</TableCell>
                <TableCell>
                  <Badge variant={r.classification === 'common' ? 'default' : 'secondary'}>{r.classification}</Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.project_nos.join(', ')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Engineering Change Notes ----------

function EcnForm({ projects, onClose, onCreated, router }) {
  const [form, setForm] = useState({ project_id: '', field_changed: '', old_value: '', new_value: '', reason: '' });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.field_changed.trim()) return showToast('Field changed is required', 'error');
    if (!form.reason.trim()) return showToast('Reason is required', 'error');
    setSaving(true);
    try {
      await api('/api/engineering-change-notes', { method: 'POST', body: form });
      showToast('Change note raised');
      router.refresh();
      onCreated?.();
      onClose();
    } catch (err) { showToast(err.message, 'error'); }
    setSaving(false);
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Raise a Change Note</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label>Project</Label>
            <Select value={form.project_id || undefined} onValueChange={v => setForm({ ...form, project_id: v })}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select a project" /></SelectTrigger>
              <SelectContent>
                {projects.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.project_no} · {p.customer_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Field changed</Label>
            <Input value={form.field_changed} onChange={e => setForm({ ...form, field_changed: e.target.value })}
              placeholder="e.g. size_spec, moc, material_description" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label>Old value</Label><Input value={form.old_value} onChange={e => setForm({ ...form, old_value: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>New value</Label><Input value={form.new_value} onChange={e => setForm({ ...form, new_value: e.target.value })} /></div>
          </div>
          <div className="grid gap-1.5">
            <Label>Reason</Label>
            <Textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} />
          </div>
        </div>
        <DialogFooter><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Raise'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ECN_STATUS_CLS = {
  pending: '', approved: 'bg-success/10 text-success ring-success/20', rejected: 'bg-danger/10 text-danger ring-danger/20',
};

// `projectIds` (round 3 Phase A, optional array of ids) — client-fetches, replacing the old static
// server-supplied `changeNotes` prop. `load()` is passed into EcnForm as `onCreated` so a freshly
// raised note appears immediately — router.refresh() alone no longer touches this list once it's
// client-fetched.
function EcnTab({ projects, projectIds = [], canApprove }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [changeNotes, setChangeNotes] = useState(null);
  const idsKey = projectIds.join(',');

  function load() {
    const suffix = idsKey ? `?project_ids=${idsKey}` : '';
    return api(`/api/engineering-change-notes${suffix}`).then(setChangeNotes).catch(err => showToast(err.message, 'error'));
  }
  useEffect(() => { load(); }, [idsKey]);

  async function decide(note, status) {
    try {
      await api(`/api/engineering-change-notes/${note.id}`, { method: 'PATCH', body: { status } });
      showToast(`Change note ${status}`);
      await load();
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Engineering Change Notes</CardTitle>
        <CardAction><Button size="sm" onClick={() => setShowForm(true)}><PlusIcon /> Raise ECN</Button></CardAction>
      </CardHeader>
      <CardContent>
        {!changeNotes ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : changeNotes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No change notes yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Field</TableHead>
                <TableHead>Old → New</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Revision</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {changeNotes.map(n => (
                <TableRow key={n.id}>
                  <TableCell>{n.project_no}</TableCell>
                  <TableCell className="font-medium">{n.field_changed}{n.material_description && <div className="text-xs text-muted-foreground">{n.material_description}</div>}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{n.old_value || '—'} → {n.new_value || '—'}</TableCell>
                  <TableCell className="max-w-64 truncate text-xs text-muted-foreground" title={n.reason}>{n.reason}</TableCell>
                  <TableCell>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${ECN_STATUS_CLS[n.status]}`}>{n.status}</span>
                  </TableCell>
                  <TableCell className="tnum text-xs text-muted-foreground">{n.effective_revision ?? '—'}</TableCell>
                  <TableCell>
                    {n.status === 'pending' && canApprove && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => decide(n, 'approved')}>Approve</Button>
                        <Button size="sm" variant="outline" className="text-danger" onClick={() => decide(n, 'rejected')}>Reject</Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {showForm && <EcnForm projects={projects} onClose={() => setShowForm(false)} onCreated={load} router={router} />}
    </Card>
  );
}

// ---------- Shared project selector header ----------
// Round 3 Phase A: one control, rendered via WorkspaceSidebar's `header` prop, owned by the shell so
// its state survives a tab switch. Shape follows the active tab — single project (BOMs/Release BOM),
// multi-project checklist (Where-Used/Common-Uncommon/Change Notes), or hidden (everything else).

function ProjectHeaderBar({
  tab, projects, globalProjectId, setGlobalProjectId, globalShowReleased, setGlobalShowReleased,
  globalProjectIds, setGlobalProjectIds,
}) {
  if (SINGLE_PROJECT_TABS.includes(tab)) {
    const selectedProject = projects.find(p => String(p.id) === globalProjectId);
    const visibleProjects = globalShowReleased ? projects : projects.filter(p => !p.bom_release_revision);
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Button size="sm" variant={globalShowReleased ? 'secondary' : 'outline'} onClick={() => setGlobalShowReleased(v => !v)}>
          {globalShowReleased ? 'Showing released' : 'Show released too'}
        </Button>
        <SearchableSelect
          className="w-72"
          value={globalProjectId} onChange={setGlobalProjectId}
          placeholder="Pick a project…"
          options={visibleProjects.map(p => ({ value: String(p.id), label: `${p.project_no} · ${p.customer_name}` }))}
          displayValue={selectedProject ? `${selectedProject.project_no} · ${selectedProject.customer_name}` : undefined}
        />
      </div>
    );
  }

  if (MULTI_PROJECT_TABS.includes(tab)) {
    function toggle(id) {
      setGlobalProjectIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    }
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline">
              <FilterIcon data-icon="inline-start" />
              {globalProjectIds.size === 0 ? 'All projects' : `${globalProjectIds.size} project${globalProjectIds.size === 1 ? '' : 's'}`}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-2">
            <div className="flex items-center justify-between px-1 pb-2">
              <span className="text-xs font-medium text-muted-foreground">Filter by project</span>
              {globalProjectIds.size > 0 && (
                <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setGlobalProjectIds(new Set())}>Clear</button>
              )}
            </div>
            <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
              {projects.map(p => (
                <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/40">
                  <Checkbox checked={globalProjectIds.has(p.id)} onCheckedChange={() => toggle(p.id)} />
                  <span className="truncate">{p.project_no} · {p.customer_name}</span>
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  return null;
}

// ---------- Shell ----------

export default function EngineeringWorkspace({ projects, canApproveEcn = false, initialTab, departments = [] }) {
  const [tab, setTab] = useState(ITEMS.some(i => i.key === initialTab) ? initialTab : 'structure');
  // Same small cross-tab handoff PrWorkspace.jsx owns internally for its own "PR Templates" tab —
  // reusing this workspace's existing setTab instead of a second tab-state.
  const [prTemplatePrefill, setPrTemplatePrefill] = useState(null);
  function useInRaisePr(items) {
    setPrTemplatePrefill(items);
    setTab('pr_raise');
  }

  const [globalProjectId, setGlobalProjectId] = useState('');
  const [globalShowReleased, setGlobalShowReleased] = useState(false);
  const [globalProjectIds, setGlobalProjectIds] = useState(new Set());
  // Switching from a single-select tab into a multi-select one seeds the checklist with whichever
  // one project was picked there, as a starting point — still fully clearable/expandable. Only seeds
  // once (guarded on the multi-set being empty), so it never stomps a filter already built up.
  useEffect(() => {
    if (MULTI_PROJECT_TABS.includes(tab) && globalProjectIds.size === 0 && globalProjectId) {
      setGlobalProjectIds(new Set([Number(globalProjectId)]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  const globalProjectIdsArr = [...globalProjectIds];

  const showHeader = SINGLE_PROJECT_TABS.includes(tab) || MULTI_PROJECT_TABS.includes(tab);

  return (
    <WorkspaceSidebar title="Engineering" icon={LayersIcon} items={ITEMS} activeKey={tab} onChange={setTab}
      header={showHeader && (
        <ProjectHeaderBar tab={tab} projects={projects}
          globalProjectId={globalProjectId} setGlobalProjectId={setGlobalProjectId}
          globalShowReleased={globalShowReleased} setGlobalShowReleased={setGlobalShowReleased}
          globalProjectIds={globalProjectIds} setGlobalProjectIds={setGlobalProjectIds} />
      )}>
      {tab === 'structure' && (
        <BomStructureWorkspace projects={projects}
          projectId={globalProjectId} onProjectIdChange={setGlobalProjectId}
          showReleased={globalShowReleased} onShowReleasedChange={setGlobalShowReleased} />
      )}
      {tab === 'structure_templates' && <BomStructureTemplateManager />}
      {tab === 'where_used' && <WhereUsedTab projectIds={globalProjectIdsArr} />}
      {tab === 'common_uncommon' && <CommonUncommonTab projectIds={globalProjectIdsArr} />}
      {tab === 'ecn' && <EcnTab projects={projects} projectIds={globalProjectIdsArr} canApprove={canApproveEcn} />}
      {tab === 'pr_raise' && (
        <RaisePrTab departments={departments} projects={projects}
          prTemplatePrefill={prTemplatePrefill} onPrefillConsumed={() => setPrTemplatePrefill(null)} />
      )}
      {tab === 'pr_templates' && (
        <BomTemplateManager kind="pr" title="PR Templates" projects={projects} onUseInRaisePr={useInRaisePr} />
      )}
      {tab === 'pr_release' && (
        <ReleaseBomTab projects={projects} departments={departments}
          projectId={globalProjectId} onProjectIdChange={setGlobalProjectId} />
      )}
    </WorkspaceSidebar>
  );
}
