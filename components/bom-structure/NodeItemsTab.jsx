'use client';

// components/bom-structure/NodeItemsTab.jsx — a node's Items tab: the same shared BomTable every
// other department panel uses, filtered to this node's assembly_id, plus a picker to assign an
// already-existing unassigned item. Item *creation* reuses BomTable's own existing "+ Add item"
// dialog (same POST /api/bom-items flow) — no second item model, no new form — just pre-filled to
// this node via BomTable's new defaultAssemblyId prop.
import { useMemo, useState } from 'react';
import { api, showToast } from '@/lib/client';
import BomTable from '@/components/BomTable';
import SearchableSelect from '@/components/SearchableSelect';
import { Label } from '@/components/ui/label';
import { BOM_FIELD_OWNERS } from '@/lib/bom-fields.mjs';
import { rankItemsByRelevance } from '@/lib/bom-tree.mjs';

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
      <BomTable
        projectId={projectId} bom={nodeItems} editableFields={BOM_FIELD_OWNERS.Engineering}
        department="Engineering" assemblies={assemblies} showItemCode defaultAssemblyId={node.id}
        suggestionsFrom={projectBom} onSaved={onSaved} layout="cards"
      />
    </div>
  );
}
