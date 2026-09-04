'use client';

// components/AllocationPanel.jsx — Multi-unit BOM split, Phase 4 (MULTI-UNIT-SPLIT-DESIGN.md §5.2),
// the Stores pipeline view. Shown only on a MASTER project's own page (one with real children) —
// per BOM line: received so far, allocated so far, available to allocate, and an inline action to
// allocate a quantity to one specific child unit. Deliberately separate from BomTable/
// ReceiveBomItemDialog — allocation is its own optional, later step over stock that's already
// arrived, not part of receiving itself, and this never touches the existing Open Requests/
// Reserve-from-stock/Trading (SAS) workflows (StoresWorkspace.jsx, §5e) at all.
import { useEffect, useState } from 'react';
import { showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Bundle allocation — pick N children in one action, one qty auto-split 1-per-child off the line's
// own per-unit requirement (server-computed, never hand-typed). Same checkbox idiom as
// DispatchBatchPackingPanel's own batch action.
function BundleAllocate({ line, children, onDone }) {
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);

  function toggle(id) {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  const perUnit = line.per_unit_qty ?? 1;
  const fits = line.available >= perUnit * selected.size;

  async function submit() {
    if (!selected.size) return showToast('Pick at least one unit', 'error');
    setBusy(true);
    try {
      const res = await fetch(`/api/bom-items/${line.id}/allocate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ child_project_ids: [...selected] }),
      }).then(r => r.json().then(j => ({ ok: r.ok, ...j })));
      if (!res.ok) throw new Error(res.error || 'Failed to allocate');
      showToast(`Allocated 1 unit's worth (${res.per_unit_qty}) to ${res.created} unit(s) — ${res.available_after} left available`);
      setSelected(new Set());
      onDone?.();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-2">
        {children.map(c => (
          <label key={c.id} className="flex items-center gap-1 text-xs">
            <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} />
            {c.project_no}
          </label>
        ))}
      </div>
      <Button size="sm" variant="outline" className="h-7 w-fit text-xs" disabled={busy || !selected.size || !fits} onClick={submit}>
        {busy ? '…' : `Allocate 1 unit's worth to ${selected.size || 'N'}`}
      </Button>
    </div>
  );
}

function AllocateRow({ line, children, onDone }) {
  const [childId, setChildId] = useState('');
  const [qty, setQty] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!childId) return showToast('Pick a unit', 'error');
    if (!(Number(qty) > 0)) return showToast('Enter a quantity', 'error');
    setBusy(true);
    try {
      const res = await fetch(`/api/bom-items/${line.id}/allocate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ child_project_id: Number(childId), qty_allocated: Number(qty) }),
      }).then(r => r.json().then(j => ({ ok: r.ok, ...j })));
      if (!res.ok) throw new Error(res.error || 'Failed to allocate');
      showToast(`Allocated ${qty} — ${res.available_after} left available`);
      setQty('');
      onDone?.();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  if (line.available <= 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Select value={childId} onValueChange={setChildId}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Unit…" /></SelectTrigger>
          <SelectContent>
            {children.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.project_no}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input className="h-8 w-20 text-xs" placeholder="Qty" value={qty} onChange={e => setQty(e.target.value)} />
        <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy} onClick={submit}>
          {busy ? '…' : 'Allocate'}
        </Button>
      </div>
      {children.length > 1 && <BundleAllocate line={line} children={children} onDone={onDone} />}
    </div>
  );
}

export default function AllocationPanel({ projectId }) {
  const [data, setData] = useState(null);

  function reload() {
    fetch(`/api/projects/${projectId}/allocation-summary`).then(r => r.json()).then(setData).catch(() => {});
  }
  useEffect(() => { reload(); }, [projectId]);

  const relevant = data ? data.lines.filter(l => l.received > 0 || l.allocated > 0) : [];
  const children = data?.children ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Material allocation to unit projects</CardTitle>
        <p className="text-sm text-muted-foreground">
          Received material stays at the master level until optionally allocated to a specific unit —
          allocating never creates a new procurement requirement, and a receipt never implies a unit
          is complete.
        </p>
      </CardHeader>
      <CardContent>
        {!data ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : relevant.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing received yet — allocation becomes available once Stores logs a receipt.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Allocated</TableHead>
                  <TableHead>Available</TableHead>
                  <TableHead>Allocate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {relevant.map(l => (
                  <TableRow key={l.id}>
                    <TableCell className="max-w-xs truncate">{l.material_description}</TableCell>
                    <TableCell>{l.received}</TableCell>
                    <TableCell>{l.allocated}</TableCell>
                    <TableCell className="font-medium">{l.available}</TableCell>
                    <TableCell><AllocateRow line={l} children={children} onDone={reload} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
