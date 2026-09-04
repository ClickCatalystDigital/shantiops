'use client';

// components/ChildRoutingPanel.jsx — Multi-unit split: Stores' active routing decision UI. Shown
// only on a MASTER project's own page, Stores-only. One row per BOM line with at least one
// allocation-ready cell; expands to a checkbox strip of that line's cells (ready ones actionable,
// not-yet-ready ones shown greyed with their allocated/required progress) plus two buttons —
// → Production / → Dispatch. Reuses the checkbox-strip idiom DispatchBatchPackingPanel already uses.
import { useEffect, useState } from 'react';
import { showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';

function LineRow({ line, cells, childrenById, onDone }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(new Set());
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
          <div className="flex flex-wrap gap-3">
            {cells.map(c => {
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
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy || !selected.size} onClick={() => route('production')}>
              → Production
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy || !selected.size} onClick={() => route('dispatch')}>
              → Dispatch
            </Button>
          </div>
        </div>
      )}
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

  const rows = data.lines
    .map(line => ({ line, cells: cellsByLine.get(line.id) || [] }))
    .filter(r => r.cells.length > 0)
    .filter(r => showAll || r.cells.some(c => c.ready && !c.routed_to));

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Route material to Production or Dispatch, per unit</CardTitle>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAll(v => !v)}>
          {showAll ? 'Show awaiting only' : 'Show all'}
        </Button>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing awaiting a routing decision — allocate material to a unit first.
          </p>
        ) : (
          rows.map(r => <LineRow key={r.line.id} line={r.line} cells={r.cells} childrenById={childrenById} onDone={reload} />)
        )}
      </CardContent>
    </Card>
  );
}
