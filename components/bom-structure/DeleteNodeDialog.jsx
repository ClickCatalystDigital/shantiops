'use client';

// components/bom-structure/DeleteNodeDialog.jsx — confirm deleting a BOM node with everything under it (sub-nodes and
// their items). Items can go with it, or be kept by moving them to another node outside it. The server enforces the same
// rules (DELETE /api/bom-assemblies/[id]?delete_items=1 | ?move_to=).
import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import SearchableSelect from '@/components/SearchableSelect';
import { nodePath } from '@/lib/bom-tree.mjs';

export default function DeleteNodeDialog({ node, assemblies, byId, onClose, onConfirm }) {
  const subtree = useMemo(() => {
    const ids = new Set([node.id]);
    let grew = true;
    while (grew) { grew = false; for (const a of assemblies) if (!ids.has(a.id) && ids.has(a.parent_id)) { ids.add(a.id); grew = true; } }
    return ids;
  }, [assemblies, node.id]);
  const subNodes = subtree.size - 1;
  const itemCount = assemblies.filter(a => subtree.has(a.id)).reduce((n, a) => n + (a.items?.length || 0), 0);
  const [keepItems, setKeepItems] = useState(false);
  const [dest, setDest] = useState(node.parent_id != null ? String(node.parent_id) : '');
  const [busy, setBusy] = useState(false);
  const options = useMemo(() => assemblies
    .filter(a => !subtree.has(a.id))
    .map(a => ({ value: String(a.id), label: nodePath(a.id, byId).join(' > ') }))
    .sort((a, b) => a.label.localeCompare(b.label)), [assemblies, byId, subtree]);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  return (
    <Dialog open onOpenChange={o => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Delete “{node.name}”?</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          {subNodes || itemCount ? (
            <p>This also deletes {[subNodes && plural(subNodes, 'sub-node'), itemCount && (keepItems ? null : plural(itemCount, 'item'))].filter(Boolean).join(' and ') || 'no other node'} under it.</p>
          ) : <p>The node is empty, so nothing else changes.</p>}
          {itemCount > 0 && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={keepItems} onChange={e => setKeepItems(e.target.checked)} />
              Keep the {plural(itemCount, 'item')} — move them to another node
            </label>
          )}
          {keepItems && <SearchableSelect value={dest} onChange={setDest} options={options} placeholder="Move items to…" />}
          <p className="text-xs text-muted-foreground">You'll have 5 seconds to undo.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="destructive" disabled={busy || (keepItems && !dest)}
            onClick={async () => { setBusy(true); try { await onConfirm(keepItems ? Number(dest) : null, [...subtree]); } finally { setBusy(false); } }}>
            {busy ? 'Checking…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
