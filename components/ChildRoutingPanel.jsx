'use client';

// components/ChildRoutingPanel.jsx — Multi-unit split: Stores' active routing decision UI. Lives
// inline in Stores' own Allocation & Routing tab (StoresWorkspace.jsx), Stores-only — moved off the
// project page so the daily allocate-then-route workflow doesn't need a trip to a (often 180+-line)
// project page per order. One row per BOM line with at least one
// allocation-ready cell; expands to a checkbox strip of that line's cells (ready ones actionable,
// not-yet-ready ones shown greyed with their allocated/required progress) plus two buttons —
// → Production / → Dispatch. Reuses the checkbox-strip idiom DispatchBatchPackingPanel already uses.
import { useEffect, useState } from 'react';
import { showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

function LineRow({ line, cells, childrenById, onDone }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);

  const ready = cells.filter(c => c.ready);
  const routedCount = { production: 0, dispatch: 0 };
  ready.forEach(c => { if (c.routed_to) routedCount[c.routed_to]++; });
  const awaiting = ready.filter(c => !c.routed_to).length;
  const notReady = cells.length - ready.length;

  function toggle(childId) {
    setSelected(prev => { const next = new Set(prev); next.has(childId) ? next.delete(childId) : next.add(childId); return next; });
  }

  async function route(routedTo) {
    if (!selected.size) return showToast('Pick at least one unit', 'error');
    setBusy(true);
    try {
      const res = await fetch(`/api/bom-items/${line.id}/route-to`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ child_project_ids: [...selected], routed_to: routedTo }),
      }).then(r => r.json().then(j => ({ ok: r.ok, ...j })));
      if (!res.ok) throw new Error(res.error || 'Failed to route');
      showToast(`Routed ${res.routed} unit(s) to ${routedTo}`);
      setSelected(new Set());
      onDone?.();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  async function undoRouting() {
    if (!selected.size) return showToast('Pick at least one routed unit', 'error');
    setBusy(true);
    try {
      const res = await fetch(`/api/bom-items/${line.id}/route-to`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ child_project_ids: [...selected] }),
      }).then(r => r.json().then(j => ({ ok: r.ok, ...j })));
      if (!res.ok) throw new Error(res.error || 'Failed to undo');
      showToast(`Routing cleared for ${res.cleared} unit(s)`);
      setSelected(new Set());
      onDone?.();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <div className="border-b py-2 last:border-0">
      <button type="button" className="flex w-full items-center justify-between gap-2 text-left text-sm" onClick={() => setOpen(o => !o)}>
        <span className="max-w-xs truncate">{line.material_description}</span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {awaiting > 0 && <Badge variant="outline">{awaiting} ready</Badge>}
          {routedCount.production > 0 && <Badge variant="outline">{routedCount.production} → Production</Badge>}
          {routedCount.dispatch > 0 && <Badge variant="outline">{routedCount.dispatch} → Dispatch</Badge>}
          {notReady > 0 && <span>{notReady} not yet ready</span>}
        </span>
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {cells.length > 6 && (
            <Input className="h-7 w-40 text-xs" placeholder="Filter units…" value={filter} onChange={e => setFilter(e.target.value)} />
          )}
          <div className="flex max-h-32 flex-wrap gap-3 overflow-y-auto">
            {cells
              .filter(c => !filter.trim() || childrenById.get(c.child_project_id)?.project_no.toLowerCase().includes(filter.trim().toLowerCase()))
              .map(c => {
                const child = childrenById.get(c.child_project_id);
                if (!child) return null;
                return (
                  <label key={c.child_project_id} className={`flex items-center gap-1.5 text-xs ${!c.ready ? 'text-muted-foreground' : ''}`}>
                    <Checkbox disabled={!c.ready} checked={selected.has(c.child_project_id)} onCheckedChange={() => toggle(c.child_project_id)} />
                    {child.project_no}
                    {c.ready
                      ? (c.routed_to ? <span>(→ {c.routed_to})</span> : null)
                      : <span>({c.allocated}/{c.per_unit_required})</span>}
                  </label>
                );
              })}
          </div>
          {selected.size > 0 && (
            <p className="text-xs tnum text-muted-foreground">Selected: {selected.size} unit{selected.size === 1 ? '' : 's'}</p>
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy || !selected.size} onClick={() => route('production')}>
              → Production
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy || !selected.size} onClick={() => route('dispatch')}>
              → Dispatch
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy || !selected.size}
              title="Clear the Production/Dispatch choice for the ticked units (only if nothing was built on it)" onClick={undoRouting}>
              Undo routing
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Same shape as the Allocator tab for ordinary projects: one row per line, Production / Dispatch (mutually
// exclusive, pre-filled from the line's own requires_manufacturing), an optional catalog "Default" correction
// and ONE Apply. A row applies to every unit of that line that is ready and not yet routed.
function AwaitingTable({ rows, childrenById, onDone }) {
  const [selected, setSelected] = useState(() => new Set());
  const [state, setState] = useState({});
  const [busy, setBusy] = useState(false);
  const get = r => state[r.line.id] || {
    routing: r.line.requires_manufacturing ? 'production' : 'dispatch',
    def: !!r.line.default_requires_manufacturing,
  };
  const patch = (id, p) => setState(s => ({ ...s, [id]: { ...get(rows.find(r => r.line.id === id)), ...p } }));
  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.line.id));

  async function apply() {
    const picked = rows.filter(r => selected.has(r.line.id));
    if (!picked.length) return showToast('Select at least one line', 'error');
    setBusy(true);
    let ok = 0, failed = 0;
    for (const r of picked) {
      const st = get(r);
      const ids = r.cells.filter(c => c.ready && !c.routed_to).map(c => c.child_project_id);
      try {
        const res = await fetch(`/api/bom-items/${r.line.id}/route-to`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ child_project_ids: ids, routed_to: st.routing }),
        }).then(x => x.json().then(j => ({ ok: x.ok, ...j })));
        if (!res.ok) throw new Error(res.error || 'Failed');
        ok++;
      } catch { failed++; continue; }
      if (r.line.item_id && st.def !== !!r.line.default_requires_manufacturing) {
        try {
          await fetch(`/api/item-master/${r.line.item_id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ default_requires_manufacturing: st.def }),
          });
        } catch { /* routing is what matters; the catalog default can be corrected again */ }
      }
    }
    setBusy(false);
    setSelected(new Set());
    showToast(`${ok} line(s) routed${failed ? ` · ${failed} failed` : ''}`, failed ? 'warning' : undefined);
    onDone?.();
  }

  if (!rows.length) return null;
  return (
    <div className="mb-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-1 py-2">
        <span className="text-sm font-medium">{selected.size} selected</span>
        <Button size="sm" className="h-7" disabled={busy || !selected.size} onClick={apply}>{busy ? 'Applying…' : 'Apply Allocations'}</Button>
        <span className="text-xs text-muted-foreground">Applies to every unit of a line that is ready and not yet routed.</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8"><Checkbox checked={allSelected} onCheckedChange={v => setSelected(new Set(v ? rows.map(r => r.line.id) : []))} aria-label="Select all" /></TableHead>
            <TableHead>Material</TableHead>
            <TableHead className="w-28">Units</TableHead>
            <TableHead className="w-24 text-center">Production</TableHead>
            <TableHead className="w-24 text-center">Dispatch</TableHead>
            <TableHead className="w-24 text-center text-muted-foreground" title="Corrects the catalog item's own default for FUTURE orders — no effect on this line">Default</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(r => {
            const st = get(r), n = r.cells.filter(c => c.ready && !c.routed_to).length;
            return (
              <TableRow key={r.line.id}>
                <TableCell><Checkbox checked={selected.has(r.line.id)} onCheckedChange={v => setSelected(s => { const x = new Set(s); v ? x.add(r.line.id) : x.delete(r.line.id); return x; })} /></TableCell>
                <TableCell className="max-w-0 truncate">{r.line.material_description}
                  <span className="block truncate text-[11px] text-muted-foreground">{[r.line.moc, r.line.size_spec].filter(Boolean).join(' · ')}</span></TableCell>
                <TableCell className="text-xs text-muted-foreground tnum">{n} unit{n === 1 ? '' : 's'}</TableCell>
                <TableCell className="text-center"><Checkbox checked={st.routing === 'production'} onCheckedChange={v => v && patch(r.line.id, { routing: 'production' })} aria-label="Production" /></TableCell>
                <TableCell className="text-center"><Checkbox checked={st.routing === 'dispatch'} onCheckedChange={v => v && patch(r.line.id, { routing: 'dispatch' })} aria-label="Dispatch" /></TableCell>
                <TableCell className="text-center">
                  {r.line.item_id
                    ? <Checkbox className="opacity-70" checked={st.def} onCheckedChange={v => patch(r.line.id, { def: !!v })} aria-label="Catalog manufacturing default" />
                    : <span className="text-xs text-muted-foreground">—</span>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default function ChildRoutingPanel({ projectId }) {
  const [data, setData] = useState(null);
  const [showAll, setShowAll] = useState(false);

  function reload() {
    fetch(`/api/projects/${projectId}/child-routing`).then(r => r.json()).then(setData).catch(() => {});
  }
  useEffect(() => { reload(); }, [projectId]);

  if (!data) return null;
  const childrenById = new Map(data.children.map(c => [c.id, c]));
  const cellsByLine = new Map();
  data.cells.forEach(c => {
    if (!cellsByLine.has(c.bom_item_id)) cellsByLine.set(c.bom_item_id, []);
    cellsByLine.get(c.bom_item_id).push(c);
  });

  const allRows = data.lines
    .map(line => ({ line, cells: cellsByLine.get(line.id) || [] }))
    .filter(r => r.cells.length > 0);
  const awaiting = allRows.filter(r => r.cells.some(c => c.ready && !c.routed_to));
  // The per-unit strips below are the exception path (route some units differently, or undo); they list
  // routed lines too, which is what "Show all" reveals.
  const rows = allRows.filter(r => showAll || r.cells.some(c => c.routed_to));

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Route material to Production or Dispatch, per unit</CardTitle>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAll(v => !v)}>
          {showAll ? 'Show awaiting only' : 'Show all'}
        </Button>
      </CardHeader>
      <CardContent>
        <AwaitingTable rows={awaiting} childrenById={childrenById} onDone={reload} />
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {awaiting.length ? '' : 'Nothing awaiting a routing decision — allocate material to a unit first.'}
          </p>
        ) : (
          <>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Per unit — route some units differently, or undo</p>
            {rows.map(r => <LineRow key={r.line.id} line={r.line} cells={r.cells} childrenById={childrenById} onDone={reload} />)}
          </>
        )}
      </CardContent>
    </Card>
  );
}
