'use client';

// Material Indent bridge — Production's own cross-project worklist of "material Stores has routed
// to me, ready to indent" (the plan's §9/§10). Backed by GET /api/production/material-indent-lines
// (lib/data.js's getPendingProductionMaterialLines); the actual create action reuses the existing,
// unmodified POST /api/material-indents — nothing about that route changes here.
//
// Grouped by project. material_indents.project_id is a single scalar and the release route rejects a
// line whose own bom_item.project_id doesn't match it, so one indent can never span projects: the
// one "Create" button below makes one indent per project that has selected lines.
import { useEffect, useMemo, useState } from 'react';
import { api, showToast } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import ProjectMultiFilter from '@/components/ProjectMultiFilter';
import StoresSubTabs from '@/components/StoresSubTabs';
import { formatDate } from '@/lib/client';
import { ChevronDownIcon, ChevronRightIcon, InfoIcon, PackageCheckIcon, SearchIcon, FileTextIcon } from 'lucide-react';
import { useParamSync } from '@/lib/use-entity-highlight';

// qty_text is free text like "2 Nos"; this strips the leading number to show just the unit.
function unitSuffix(qtyText) {
  return String(qtyText || '').replace(/^\s*[\d.]+\s*/, '').trim();
}

// A split-master line routed for several child units produces one worklist row per unit (each was
// independently allocated/routed) — key on (bom_item_id, unit) so they select independently.
function rowKey(r) {
  return `${r.bom_item_id}:${r.unit_project_no || ''}`;
}

// The quantity a NEW indent line should ask for — the still-uncovered remainder, never the full
// requirement again. Getting this wrong would let Production silently re-request material Stores
// already released via an earlier indent.
function remainingQty(r) {
  if (!r.required_qty) return 0;
  return Math.max(0, r.required_qty - (r.already_indented_open + r.already_indented_released));
}
// A big split order can have thousands of lines; show the first batch and let the user ask for the rest.
const LINE_CAP = 100;
const isSelectable = r => !!r.required_qty && remainingQty(r) > 0;

export default function MaterialIndentWorklist() {
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [q, setQ] = useState('');
  const [projFilter, setProjFilter] = useState(new Set());
  const [showAll, setShowAll] = useState(new Set()); // projects whose full line list is shown
  const [open, setOpen] = useState(null); // Set of expanded project ids; null = decide once rows load
  const [busy, setBusy] = useState(false);
  const [justCreated, setJustCreated] = useState([]);
  const [sub, setSub] = useState('todo');
  const [raised, setRaised] = useState(null);
  // Alert links: ?view=raised (+ ?highlight=<indent no>), ?q=<material or project>.
  useParamSync('view', v => setSub(v === 'raised' ? 'raised' : 'todo'));
  useParamSync('q', setQ);

  async function load() {
    const data = await api('/api/production/material-indent-lines');
    setRows(data);
    setSelected(new Set());
  }
  useEffect(() => { load().catch(err => showToast(err.message, 'error')); }, []);
  // History of indents already raised (any status) — what Stores is working on, with PDF.
  const loadRaised = () => api('/api/material-indents').then(setRaised).catch(err => { showToast(err.message, 'error'); setRaised([]); });
  useEffect(() => { loadRaised(); }, []);

  const projectOptions = useMemo(() => {
    const m = new Map();
    (rows || []).forEach(r => m.set(r.indent_project_id, { id: r.indent_project_id, label: r.indent_project_no, sub: r.customer_name }));
    (raised || []).forEach(i => { if (i.project_id && !m.has(i.project_id)) m.set(i.project_id, { id: i.project_id, label: i.project_no }); });
    return [...m.values()];
  }, [rows, raised]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows || []).filter(r => {
      if (projFilter.size && !projFilter.has(r.indent_project_id)) return false;
      if (!needle) return true;
      return [r.material_description, r.size_spec, r.moc, r.indent_project_no, r.customer_name, r.unit_project_no, r.catalog_item_code]
        .some(v => String(v || '').toLowerCase().includes(needle));
    });
  }, [rows, q, projFilter]);

  const groups = useMemo(() => {
    const g = new Map();
    visible.forEach(r => {
      if (!g.has(r.indent_project_id)) g.set(r.indent_project_id, { id: r.indent_project_id, project_no: r.indent_project_no, customer_name: r.customer_name, rows: [] });
      g.get(r.indent_project_id).rows.push(r);
    });
    return [...g.values()];
  }, [visible]);

  // Few projects: show them open. Many: start folded so the page isn't a wall of lines.
  const isOpen = id => (open ? open.has(id) : groups.length <= 3);
  function toggleOpen(id) {
    const base = open || new Set(groups.length <= 3 ? groups.map(g => g.id) : []);
    const next = new Set(base);
    next.has(id) ? next.delete(id) : next.add(id);
    setOpen(next);
  }

  const selectable = visible.filter(isSelectable);
  const picked = selectable.filter(r => selected.has(rowKey(r)));
  const pickedProjects = new Set(picked.map(r => r.indent_project_id)).size;
  const allPicked = selectable.length > 0 && picked.length === selectable.length;

  function setKeys(list, on) {
    setSelected(prev => {
      const next = new Set(prev);
      list.forEach(r => (on ? next.add(rowKey(r)) : next.delete(rowKey(r))));
      return next;
    });
  }
  function toggle(r) { setKeys([r], !selected.has(rowKey(r))); }

  // One indent per project that has selected lines. A failure on one project doesn't stop the rest.
  async function createIndents() {
    if (!picked.length) return;
    setBusy(true);
    const byProject = new Map();
    picked.forEach(r => { if (!byProject.has(r.indent_project_id)) byProject.set(r.indent_project_id, []); byProject.get(r.indent_project_id).push(r); });
    const made = [], failed = [];
    for (const [projectId, lines] of byProject) {
      try {
        const units = [...new Set(lines.map(r => r.unit_project_no).filter(Boolean))];
        const created = await api('/api/material-indents', {
          method: 'POST',
          body: {
            project_id: Number(projectId),
            notes: units.length ? `For unit(s): ${units.join(', ')}` : undefined,
            items: lines.map(r => ({ bom_item_id: r.bom_item_id, qty_requested: remainingQty(r), child_project_id: r.unit_project_id || undefined })),
          },
        });
        made.push({ id: created.id, indent_no: created.indent_no });
      } catch (err) { failed.push(`${lines[0].indent_project_no}: ${err.message}`); }
    }
    if (made.length) {
      showToast(`${made.length} indent${made.length === 1 ? '' : 's'} raised: ${made.map(m => m.indent_no).join(', ')}`);
      setJustCreated(prev => [...made, ...prev].slice(0, 5));
    }
    failed.forEach(m => showToast(m, 'error'));
    await Promise.all([load(), loadRaised()]).catch(err => showToast(err.message, 'error'));
    setBusy(false);
  }

  if (rows === null) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const recentlyCreated = justCreated.length > 0 && (
    <div className="flex flex-col gap-1 rounded-lg border border-success/30 bg-success-surface px-3 py-2 text-sm">
      <span className="font-medium">Just created</span>
      {justCreated.map(ind => (
        <div key={ind.id} className="flex items-center gap-2 text-xs">
          <span className="tnum">{ind.indent_no}</span>
          <a href={`/api/material-indents/${ind.id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline"><FileTextIcon className="size-3" />Download PDF</a>
        </div>
      ))}
    </div>
  );

  // Raised indents, narrowed by the same search + project filter.
  const needleR = q.trim().toLowerCase();
  const raisedRows = (raised || []).filter(i => {
    if (projFilter.size && !projFilter.has(i.project_id)) return false;
    if (!needleR) return true;
    return [i.indent_no, i.project_no, i.requested_by, ...(i.items || []).map(it => it.bom_description || it.inventory_description)]
      .some(v => String(v || '').toLowerCase().includes(needleR));
  });
  const liveRaised = (raised || []).filter(i => !['released', 'cancelled'].includes(i.status)).length;

  return (
    <div className="flex flex-col gap-3 pb-16">
      {recentlyCreated}
      <StoresSubTabs value={sub} onChange={setSub} tabs={[
        { value: 'todo', label: 'To indent', count: rows.filter(isSelectable).length },
        { value: 'raised', label: 'Raised', count: liveRaised },
      ]} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search material, project, unit…" className="h-9 pl-9" />
        </div>
        <ProjectMultiFilter options={projectOptions} value={projFilter} onChange={setProjFilter} />
        {sub === 'todo' && (
          <Button variant="outline" size="sm" disabled={!selectable.length} onClick={() => setKeys(selectable, !allPicked)}>
            {allPicked ? 'Unselect all' : `Select all (${selectable.length})`}
          </Button>
        )}
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" aria-label="How this works" className="inline-flex size-7 items-center justify-center rounded-full border text-muted-foreground hover:bg-muted"><InfoIcon className="size-3.5" /></button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 text-xs text-muted-foreground">
            Material Stores has routed to Production, ready to be indented. Tick the lines you need; one indent is
            made for each project (an indent can't span projects). Lines already fully indented, or with an unclear
            quantity, can't be ticked.
          </PopoverContent>
        </Popover>
      </div>

      {sub === 'raised' && <RaisedIndents rows={raisedRows} loading={raised === null} />}

      {sub === 'todo' && !rows.length && (
        <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
          <PackageCheckIcon className="mx-auto mb-2 size-6 opacity-40" />
          Nothing routed to Production yet — Stores routes a received BOM line "→ Production" once
          it's ready, and it appears here automatically.
        </div>
      )}
      {sub === 'todo' && rows.length > 0 && groups.length === 0 && <p className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">No lines match.</p>}

      {sub === 'todo' && groups.map(g => {
        const sel = g.rows.filter(r => isSelectable(r) && selected.has(rowKey(r)));
        const sels = g.rows.filter(isSelectable);
        const expanded = isOpen(g.id);
        return (
          <section key={g.id} className="overflow-hidden rounded-xl border bg-card">
            <div className="flex items-center gap-2 px-3 py-2.5">
              <Checkbox disabled={!sels.length} aria-label={`Select all lines of ${g.project_no}`}
                checked={sels.length > 0 && sel.length === sels.length}
                onCheckedChange={v => setKeys(sels, !!v)} />
              <button type="button" onClick={() => toggleOpen(g.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                {expanded ? <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" /> : <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />}
                <span className="font-semibold">{g.project_no}</span>
                <span className="truncate text-sm text-muted-foreground">{g.customer_name}</span>
              </button>
              <span className="shrink-0 text-xs text-muted-foreground tnum">{sel.length ? `${sel.length} selected · ` : ''}{g.rows.length} line{g.rows.length === 1 ? '' : 's'}</span>
            </div>
            {expanded && (
              <div className="divide-y border-t">
                {(showAll.has(g.id) ? g.rows : g.rows.slice(0, LINE_CAP)).map(r => {
                  const key = rowKey(r);
                  const remaining = remainingQty(r);
                  const unclear = !r.required_qty;
                  const full = !unclear && remaining <= 0;
                  const disabled = unclear || full;
                  return (
                    <label key={key} className={`flex items-start gap-3 px-3 py-2 text-sm ${disabled ? 'opacity-55' : 'cursor-pointer hover:bg-muted/40'}`}>
                      <Checkbox checked={selected.has(key)} onCheckedChange={() => toggle(r)} disabled={disabled} className="mt-1" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2">
                          <span className="font-medium">{r.material_description}</span>
                          {r.size_spec && <span className="text-xs text-muted-foreground">{r.size_spec}</span>}
                          {r.unit_project_no && <Badge variant="outline" className="text-[10px]">Unit {r.unit_project_no}</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground tnum">
                          {[r.catalog_item_code, r.moc, r.piece ? `Piece ${r.piece.code}${r.piece.heat_no ? ` (heat ${r.piece.heat_no})` : ''}` : null].filter(Boolean).join(' · ')}
                        </div>
                        {unclear && <div className="text-xs text-warning">Required qty unclear — raise from the BOM tab instead</div>}
                      </div>
                      {!unclear && (
                        <div className="shrink-0 text-right text-xs tnum text-muted-foreground">
                          <div>Need <span className="font-medium text-foreground">{r.required_qty} {unitSuffix(r.qty_text)}</span></div>
                          <div>{full ? <span className="text-success">Fully indented</span> : <>Left <span className="font-medium text-foreground">{remaining}</span></>}</div>
                        </div>
                      )}
                    </label>
                  );
                })}
                {g.rows.length > LINE_CAP && !showAll.has(g.id) && (
                  <button type="button" onClick={() => setShowAll(prev => new Set(prev).add(g.id))}
                    className="w-full px-3 py-2 text-center text-xs font-medium text-primary hover:bg-muted/40">
                    Show all {g.rows.length} lines
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })}

      {sub === 'todo' && picked.length > 0 && (
        <div className="sticky bottom-3 z-10 flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-2.5 shadow-lg">
          <span className="text-sm">
            <span className="font-semibold tnum">{picked.length}</span> line{picked.length === 1 ? '' : 's'} · <span className="tnum">{pickedProjects}</span> project{pickedProjects === 1 ? '' : 's'}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setKeys(picked, false)}>Clear</Button>
            <Button size="sm" disabled={busy} onClick={createIndents}>
              {busy ? 'Creating…' : `Create ${pickedProjects} indent${pickedProjects === 1 ? '' : 's'}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const INDENT_BADGE = {
  open: 'border-info/30 bg-info-surface text-info',
  partially_released: 'border-warning/30 bg-warning-surface text-warning',
  released: 'border-success/30 bg-success-surface text-success',
  cancelled: 'text-muted-foreground',
};

// What Production has already raised, newest first, grouped by project. Read-only: Stores releases
// the material; this just shows where each indent stands and re-opens its PDF.
function RaisedIndents({ rows, loading }) {
  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!rows.length) return <p className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">No indents raised yet.</p>;
  const byProject = new Map();
  rows.forEach(i => {
    const k = i.project_id || 0;
    if (!byProject.has(k)) byProject.set(k, { project_no: i.project_no || 'No project', rows: [] });
    byProject.get(k).rows.push(i);
  });
  return [...byProject.entries()].map(([k, g]) => (
    <section key={k} className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="font-semibold">{g.project_no}</span>
        <span className="text-xs text-muted-foreground tnum">{g.rows.length} indent{g.rows.length === 1 ? '' : 's'}</span>
      </div>
      <div className="divide-y border-t">
        {g.rows.map(i => {
          const items = (i.items || []).filter(it => it.status !== 'cancelled');
          const done = items.filter(it => it.status === 'released').length;
          return (
            <div key={i.id} data-entity-code={i.indent_no} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className="font-medium tnum">{i.indent_no}</span>
              <Badge variant="outline" className={`text-[10px] ${INDENT_BADGE[i.status] || ''}`}>{String(i.status).replace('_', ' ')}</Badge>
              <span className="text-xs text-muted-foreground">{formatDate(i.created_at)}{i.requested_by ? ` · ${i.requested_by}` : ''}</span>
              <span className="ml-auto text-xs text-muted-foreground tnum">{done} of {items.length} line{items.length === 1 ? '' : 's'} released</span>
              <a href={`/api/material-indents/${i.id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline"><FileTextIcon className="size-3" />PDF</a>
            </div>
          );
        })}
      </div>
    </section>
  ));
}
