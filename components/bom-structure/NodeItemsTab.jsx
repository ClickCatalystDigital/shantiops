'use client';

// components/bom-structure/NodeItemsTab.jsx — a node's Items tab: the same shared BomTable every
// other department panel uses, filtered to this node's assembly_id, plus a picker to assign an
// already-existing unassigned item. Item *creation* reuses BomTable's own existing "+ Add item"
// dialog (same POST /api/bom-items flow) — no second item model, no new form — just pre-filled to
// this node via BomTable's new defaultAssemblyId prop.
import { useEffect, useMemo, useState } from 'react';
import { api, showToast } from '@/lib/client';
import BomTable from '@/components/BomTable';
import SearchableSelect from '@/components/SearchableSelect';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { BOM_FIELD_OWNERS } from '@/lib/bom-fields.mjs';
import { rankItemsByRelevance } from '@/lib/bom-tree.mjs';

// Items imported before multi-value cells were split: ONE row holding several sizes + quantities. Read-only list from the
// server (only rows whose sizes and quantities line up one-to-one); splitting is always a deliberate click.
function SplitMultiValueBanner({ node, itemCount, onSplit }) {
  const [cands, setCands] = useState([]);
  const [picked, setPicked] = useState(new Set());
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setCands([]); setPicked(new Set()); setOpen(false);
    if (!itemCount) return undefined;
    let cancelled = false;
    api(`/api/bom-assemblies/${node.id}/split-multi-value-items`)
      .then(r => { if (!cancelled) { setCands(r.candidates || []); setPicked(new Set((r.candidates || []).filter(c => c.convertible).map(c => c.id))); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [node.id, itemCount]);
  if (!cands.length) return null;

  async function run() {
    setBusy(true);
    try {
      const r = await api(`/api/bom-assemblies/${node.id}/split-multi-value-items`, { method: 'POST', body: { item_ids: [...picked] } });
      showToast(`Split ${r.split} item${r.split === 1 ? '' : 's'} into ${r.split + r.created} rows` + (r.skipped?.length ? ` — ${r.skipped.length} could not be split` : ''));
      setOpen(false);
      onSplit?.();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setBusy(false); }
  }

  return (
    <div className="rounded-md border border-warning/40 bg-warning/5 p-2.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span>
          <strong>{cands.length}</strong> item{cands.length === 1 ? '' : 's'} on this node {cands.length === 1 ? 'holds' : 'hold'} several sizes and quantities in one cell.
          Splitting gives each its own item.
        </span>
        <Button size="sm" variant="outline" onClick={() => setOpen(v => !v)}>{open ? 'Hide' : 'Review & split'}</Button>
      </div>
      {open && (
        <div className="mt-2 flex flex-col gap-1.5">
          <div className="flex max-h-56 flex-col divide-y overflow-y-auto rounded-md border bg-background">
            {cands.map(c => (
              <label key={c.id} className={`flex items-center gap-2 px-2 py-1.5 ${c.convertible ? '' : 'opacity-60'}`}>
                <input
                  type="checkbox" disabled={!c.convertible} checked={picked.has(c.id)}
                  onChange={e => setPicked(prev => { const n = new Set(prev); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n; })}
                />
                <span className="w-1/3 shrink-0 truncate font-medium" title={c.description}>{c.description}</span>
                <span className="flex-1 truncate" title={c.quantities.join(', ')}>{c.parts} rows: {c.quantities.join(', ')}</span>
                {!c.convertible && <span className="shrink-0 text-muted-foreground">{c.reason}</span>}
              </label>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Each new row keeps the same material, make and status; only size and quantity differ.</span>
            <Button size="sm" onClick={run} disabled={busy || picked.size === 0}>{busy ? 'Splitting…' : `Split ${picked.size}`}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function NodeItemsTab({ projectId, node, path, projectBom, assemblies, unassignedItems, onSaved }) {
  const [assigning, setAssigning] = useState(false);
  const nodeItems = (projectBom || []).filter(r => r.assembly_id === node.id);

  // "Only show relevant items" — ranks by keyword overlap against this node's own name + its
  // ancestor path (lib/bom-tree.mjs's rankItemsByRelevance, same keyword-overlap primitive Stores/QC
  // already trust for their own possible-match badges). Never hides anything — a non-matching item
  // just sorts to the end, still reachable by typing into the SearchableSelect below.
  const rankedUnassigned = useMemo(
    () => rankItemsByRelevance(path || [node.name], unassignedItems),
    [path, node.name, unassignedItems]
  );

  async function assignExisting(itemId) {
    setAssigning(true);
    try {
      await api(`/api/bom-items/${itemId}`, { method: 'PATCH', body: { assembly_id: node.id } });
      showToast('Item assigned');
      onSaved?.();
    } catch (err) { showToast(err.message, 'error'); }
    setAssigning(false);
  }

  return (
    <div className="flex flex-col gap-3">
      {unassignedItems.length > 0 && (
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground shrink-0">Assign existing item</Label>
          <SearchableSelect
            value="" onChange={assignExisting} className="w-80"
            placeholder={assigning ? 'Assigning…' : 'Search an unassigned item…'}
            options={rankedUnassigned.map(it => ({ value: String(it.id), label: `BM-${it.id} · ${it.material_description}` }))}
          />
        </div>
      )}
      <SplitMultiValueBanner node={node} itemCount={nodeItems.length} onSplit={onSaved} />
      <BomTable
        projectId={projectId} bom={nodeItems} editableFields={BOM_FIELD_OWNERS.Engineering}
        department="Engineering" assemblies={assemblies} showItemCode defaultAssemblyId={node.id}
        suggestionsFrom={projectBom} onSaved={onSaved} layout="cards"
      />
    </div>
  );
}
