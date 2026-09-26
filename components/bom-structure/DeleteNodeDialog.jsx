'use client';

// components/bom-structure/DeleteNodeDialog.jsx — deleting a BOM node never silently drops its items out of the tree:
// when the node still holds items, the person chooses which node they move to (default: its parent; a top-level node has
// no parent, so it must pick one). The server enforces the same rule (DELETE /api/bom-assemblies/[id]?move_to=).
import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import SearchableSelect from '@/components/SearchableSelect';
import { nodePath } from '@/lib/bom-tree.mjs';

export default function DeleteNodeDialog({ node, assemblies, byId, onClose, onConfirm }) {
  const itemCount = node.items?.length || 0;
  const hasChildren = assemblies.some(a => a.parent_id === node.id);
  const [dest, setDest] = useState(node.parent_id != null ? String(node.parent_id) : '');
  const [busy, setBusy] = useState(false);
  const options = useMemo(() => assemblies
    .filter(a => a.id !== node.id)
    .map(a => ({ value: String(a.id), label: nodePath(a.id, byId).join(' > ') }))
    .sort((a, b) => a.label.localeCompare(b.label)), [assemblies, byId, node.id]);
  const needsDest = itemCount > 0;

  return (
    <Dialog open onOpenChange={o => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Delete “{node.name}”?</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          {hasChildren && <p className="text-danger">This node has sub-assemblies — delete or move those first.</p>}
          {needsDest ? (
            <>
              <p>It still holds <strong>{itemCount}</strong> item{itemCount === 1 ? '' : 's'}. They are not deleted — choose where they go:</p>
              <SearchableSelect value={dest} onChange={setDest} options={options} placeholder="Move items to…" />
              {Number(node.qty) !== 1 && <p className="text-xs text-warning">This node's quantity is ×{node.qty}; the moved items' roll-up quantity will change to the destination's.</p>}
            </>
          ) : <p>The node is empty, so nothing else changes.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="destructive" disabled={busy || hasChildren || (needsDest && !dest)}
            onClick={async () => { setBusy(true); try { await onConfirm(needsDest ? Number(dest) : null); } finally { setBusy(false); } }}>
            {busy ? 'Deleting…' : 'Delete node'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
