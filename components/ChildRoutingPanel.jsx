'use client';

// components/ChildRoutingPanel.jsx — Multi-unit split: Stores' Production-or-Dispatch decision, per unit.
// Two views of the same data, shown as sub-tabs of Stores' Macro Allocator (StoresWorkspace.jsx):
//   view="route"  : one row per BOM line that has units ready and not yet routed. Tick Production or
//                   Dispatch, press Apply — it applies to every ready unit of that line. The pencil
//                   picks just some of the units (partial).
//   view="routed" : what is already routed, with a pencil to take routing back for chosen units.
// Quantity is fixed per unit (the line's per-unit requirement), so "how many" = how many units.
import { useEffect, useMemo, useState } from 'react';
import { PencilIcon } from 'lucide-react';
import { showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

const call = (url, method, body) => fetch(url, {
  method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
}).then(r => r.json().then(j => ({ ok: r.ok, ...j })));

// Checkbox grid of units with a filter — used by both pencils.
function UnitPicker({ units, selected, onChange, extra }) {
  const [filter, setFilter] = useState('');
  const shown = units.filter(u => !filter.trim() || u.project_no.toLowerCase().includes(filter.trim().toLowerCase()));
  const all = shown.length > 0 && shown.every(u => selected.has(u.id));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input className="h-8 w-44 text-xs" placeholder="Filter units…" value={filter} onChange={e => setFilter(e.target.value)} />
        <Button type="button" size="sm" variant="ghost" className="h-8 text-xs"
          onClick={() => onChange(new Set(all ? [...selected].filter(id => !shown.some(u => u.id === id)) : [...selected, ...shown.map(u => u.id)]))}>
          {all ? 'Clear shown' : 'Select shown'}
        </Button>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{selected.size} of {units.length}</span>
      </div>
      <div className="grid max-h-56 grid-cols-2 gap-x-4 gap-y-1.5 overflow-y-auto rounded-md border p-3 sm:grid-cols-3">
        {shown.map(u => (
          <label key={u.id} className="flex items-center gap-2 text-xs">
            <Checkbox checked={selected.has(u.id)}
              onCheckedChange={() => { const n = new Set(selected); n.has(u.id) ? n.delete(u.id) : n.add(u.id); onChange(n); }} />
            {u.project_no}{extra?.(u)}
          </label>
        ))}
      </div>
    </div>
  );
}

function RouteView({ rows, unitsById, onDone }) {
  const [selected, setSelected] = useState(() => new Set());
  const [state, setState] = useState({});
  const [editing, setEditing] = useState(null); // line being edited
  const [draft, setDraft] = useState(new Set());
  const [busy, setBusy] = useState(false);

  const ready = r => r.cells.filter(c => c.ready && !c.routed_to).map(c => c.child_project_id);
  const get = r => ({
    routing: r.line.requires_manufacturing ? 'production' : 'dispatch',
    def: !!r.line.default_requires_manufacturing,
    units: null, ...(state[r.line.id] || {}),
  });
  const patch = (r, p) => setState(s => ({ ...s, [r.line.id]: { ...get(r), ...p } }));
  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.line.id));

  async function apply() {
    const picked = rows.filter(r => selected.has(r.line.id));
    if (!picked.length) return showToast('Select at least one line', 'error');
    setBusy(true);
    let ok = 0, failed = 0, units = 0;
    for (const r of picked) {
      const st = get(r);
      const ids = st.units ? [...st.units] : ready(r);
      const res = await call(`/api/bom-items/${r.line.id}/route-to`, 'POST', { child_project_ids: ids, routed_to: st.routing });
      if (!res.ok) { failed++; showToast(`${r.line.material_description}: ${res.error || 'failed'}`, 'error'); continue; }
      ok++; units += ids.length;
      if (r.line.item_id && st.def !== !!r.line.default_requires_manufacturing) {
        await call(`/api/item-master/${r.line.item_id}`, 'PATCH', { default_requires_manufacturing: st.def }).catch(() => {});
      }
    }
    setBusy(false);
    setSelected(new Set());
    setState({});
    if (ok) showToast(`${ok} line${ok === 1 ? '' : 's'} routed (${units} unit${units === 1 ? '' : 's'})${failed ? ` · ${failed} failed` : ''}`, failed ? 'warning' : undefined);
    onDone?.();
  }

  const editUnits = editing ? ready(editing).map(id => unitsById.get(id)).filter(Boolean) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>To route</CardTitle>
        <p className="text-sm text-muted-foreground">
          Material allocated to units and ready. Tick where it goes, then Apply — it covers every ready unit of the line. Use the pencil to pick only some units.
        </p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing waiting. Allocate material to units first.</p>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2 border-b bg-muted/40 px-1 py-2">
              <span className="text-sm font-medium">{selected.size} selected</span>
              <Button size="sm" className="h-7" disabled={busy || !selected.size} onClick={apply}>{busy ? 'Applying…' : 'Apply'}</Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"><Checkbox checked={allSelected} onCheckedChange={v => setSelected(new Set(v ? rows.map(r => r.line.id) : []))} aria-label="Select all" /></TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead className="w-20">Qty / unit</TableHead>
                  <TableHead className="w-36">Units</TableHead>
                  <TableHead className="w-24 text-center">Production</TableHead>
                  <TableHead className="w-24 text-center">Dispatch</TableHead>
                  <TableHead className="w-20 text-center text-muted-foreground" title="Corrects the catalog item's own default for FUTURE orders — no effect on this line">Default</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => {
                  const st = get(r), all = ready(r).length, n = st.units ? st.units.size : all;
                  const waiting = r.cells.filter(c => !c.ready).length;
                  return (
                    <TableRow key={r.line.id}>
                      <TableCell><Checkbox checked={selected.has(r.line.id)} onCheckedChange={v => setSelected(s => { const x = new Set(s); v ? x.add(r.line.id) : x.delete(r.line.id); return x; })} aria-label="Select line" /></TableCell>
                      <TableCell className="max-w-0 truncate">{r.line.material_description}
                        <span className="block truncate text-[11px] text-muted-foreground">{[r.line.moc, r.line.size_spec].filter(Boolean).join(' · ')}</span></TableCell>
                      <TableCell className="text-xs text-muted-foreground tabular-nums">{r.cells[0]?.per_unit_required}</TableCell>
                      <TableCell className="text-xs tabular-nums">
                        <span className="inline-flex items-center gap-1">
                          <span className={st.units ? 'font-medium text-primary' : ''}>{n} of {all}</span>
                          <Button size="icon-sm" variant="ghost" className="size-6" title="Choose which units" aria-label="Choose units"
                            onClick={() => { setEditing(r); setDraft(new Set(st.units || ready(r))); }}>
                            <PencilIcon className="size-3.5" />
                          </Button>
                        </span>
                        {waiting > 0 && <span className="block text-[11px] text-muted-foreground">{waiting} still to allocate</span>}
                      </TableCell>
                      <TableCell className="text-center"><Checkbox checked={st.routing === 'production'} onCheckedChange={v => v && patch(r, { routing: 'production' })} aria-label="Production" /></TableCell>
                      <TableCell className="text-center"><Checkbox checked={st.routing === 'dispatch'} onCheckedChange={v => v && patch(r, { routing: 'dispatch' })} aria-label="Dispatch" /></TableCell>
                      <TableCell className="text-center">
                        {r.line.item_id
                          ? <Checkbox className="opacity-70" checked={st.def} onCheckedChange={v => patch(r, { def: !!v })} aria-label="Catalog manufacturing default" />
                          : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>

      {editing && (
        <Dialog open onOpenChange={o => !o && setEditing(null)}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader><DialogTitle>Choose units — {editing.line.material_description}</DialogTitle></DialogHeader>
            <UnitPicker units={editUnits} selected={draft} onChange={setDraft} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button disabled={!draft.size} onClick={() => {
                patch(editing, { units: draft.size === editUnits.length ? null : new Set(draft) });
                setSelected(s => new Set(s).add(editing.line.id));
                setEditing(null);
              }}>Use {draft.size} unit{draft.size === 1 ? '' : 's'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

function RoutedView({ rows, unitsById, onDone }) {
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const routed = r => r.cells.filter(c => c.routed_to);
  const count = (r, to) => routed(r).filter(c => c.routed_to === to).length;
  const editUnits = editing ? routed(editing).map(c => ({ ...unitsById.get(c.child_project_id), routed_to: c.routed_to })).filter(u => u.id) : [];

  async function undo() {
    setBusy(true);
    const res = await call(`/api/bom-items/${editing.line.id}/route-to`, 'DELETE', { child_project_ids: [...draft] });
    setBusy(false);
    if (!res.ok) return showToast(res.error || 'Could not undo', 'error');
    showToast(`Routing cleared for ${res.cleared} unit${res.cleared === 1 ? '' : 's'}`);
    setEditing(null);
    onDone?.();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Routed</CardTitle>
        <p className="text-sm text-muted-foreground">
          Units already sent to Production or Dispatch. Use the pencil to take routing back — possible only while no Production request or packing list exists for that unit.
        </p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing routed yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Material</TableHead>
                <TableHead className="w-32">To Production</TableHead>
                <TableHead className="w-32">To Dispatch</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.line.id}>
                  <TableCell className="max-w-0 truncate">{r.line.material_description}</TableCell>
                  <TableCell>{count(r, 'production') > 0 ? <Badge variant="outline">{count(r, 'production')} unit{count(r, 'production') === 1 ? '' : 's'}</Badge> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                  <TableCell>{count(r, 'dispatch') > 0 ? <Badge variant="outline">{count(r, 'dispatch')} unit{count(r, 'dispatch') === 1 ? '' : 's'}</Badge> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                  <TableCell><Button size="icon-sm" variant="ghost" className="size-7" title="Take routing back" aria-label="Take routing back"
                    onClick={() => { setEditing(r); setDraft(new Set()); }}><PencilIcon className="size-3.5" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {editing && (
        <Dialog open onOpenChange={o => !o && setEditing(null)}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader><DialogTitle>Take routing back — {editing.line.material_description}</DialogTitle></DialogHeader>
            <UnitPicker units={editUnits} selected={draft} onChange={setDraft}
              extra={u => <span className="text-muted-foreground">(→ {u.routed_to === 'production' ? 'Production' : 'Dispatch'})</span>} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>Close</Button>
              <Button disabled={busy || !draft.size} onClick={undo}>{busy ? 'Working…' : `Undo routing for ${draft.size}`}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

export default function ChildRoutingPanel({ projectId, view = 'route' }) {
  const [data, setData] = useState(null);
  function reload() {
    fetch(`/api/projects/${projectId}/child-routing`).then(r => r.json()).then(setData).catch(() => {});
  }
  useEffect(() => { reload(); }, [projectId, view]);

  const { unitsById, rows } = useMemo(() => {
    if (!data) return { unitsById: new Map(), rows: [] };
    const unitsById = new Map(data.children.map(c => [c.id, c]));
    const byLine = new Map();
    data.cells.forEach(c => { if (!byLine.has(c.bom_item_id)) byLine.set(c.bom_item_id, []); byLine.get(c.bom_item_id).push(c); });
    const all = data.lines.map(line => ({ line, cells: byLine.get(line.id) || [] })).filter(r => r.cells.length > 0);
    return {
      unitsById,
      rows: view === 'route'
        ? all.filter(r => r.cells.some(c => c.ready && !c.routed_to))
        : all.filter(r => r.cells.some(c => c.routed_to)),
    };
  }, [data, view]);

  if (!data) return <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>;
  return view === 'route'
    ? <RouteView key={rows.map(r => r.line.id).join(',')} rows={rows} unitsById={unitsById} onDone={reload} />
    : <RoutedView rows={rows} unitsById={unitsById} onDone={reload} />;
}
