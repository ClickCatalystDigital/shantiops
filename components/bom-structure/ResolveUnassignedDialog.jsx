'use client';

// components/bom-structure/ResolveUnassignedDialog.jsx — the same aggregated-count-becomes-a-queue
// pattern ResolveCategoriesDialog.jsx already shipped (see that file's own header for the full
// rationale), applied to "unassigned" instead of "uncategorized". A direct sibling, not a shared
// engine — the picker here is a structure node, not a category, and every item entering this queue
// is definitionally unassigned, so there's no breadcrumb to show. If a third concrete case ever
// shows up, copy whichever of these two is the closer shape, don't generalize either into a base.
import { useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import SearchableSelect from '@/components/SearchableSelect';
import { nodePath } from '@/lib/bom-tree.mjs';
import { api, showToast } from '@/lib/client';

// items: the live, unassigned subset of projectBom. assemblies/byId: the project's own tree, used
// to build the node picker and its breadcrumb-path labels (already computed by the caller).
export default function ResolveUnassignedDialog({ items, assemblies, byId, onClose, onOpenInTree }) {
  const [queue, setQueue] = useState(items);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const total = items.length;
  const current = queue[0];

  const nodeOptions = (assemblies || [])
    .map(a => ({ value: String(a.id), label: nodePath(a.id, byId).join(' > ') }))
    .sort((a, b) => a.label.localeCompare(b.label));

  function advance() {
    setQueue(q => q.slice(1));
    setValue('');
  }

  async function saveAndNext() {
    if (!current || !value) return;
    setSaving(true);
    try {
      await api(`/api/bom-items/${current.id}`, { method: 'PATCH', body: { assembly_id: Number(value) } });
      advance();
    } catch (err) { showToast(err.message, 'error'); }
    setSaving(false);
  }

  function skip() { advance(); }

  function close() {
    // Anything actually saved sticks — closing early just stops the walkthrough, it never undoes
    // progress already made.
    onClose();
  }

  return (
    <Dialog open onOpenChange={o => !o && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Resolve unassigned items</DialogTitle>
          <DialogDescription>
            {current ? `${total - queue.length + 1} of ${total}` : 'All done'} — assign to a
            structure node and move to the next, or skip to leave it for later.
          </DialogDescription>
        </DialogHeader>

        {current ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-md border p-3">
              <p className="text-sm font-medium">
                <span className="text-muted-foreground">BM-{current.id} · </span>{current.material_description}
              </p>
              {(current.moc || current.size_spec) && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {[current.moc, current.size_spec].filter(Boolean).join(' · ')}
                </p>
              )}
              {onOpenInTree && (
                <button type="button" className="mt-2 text-xs text-primary underline" onClick={() => onOpenInTree(current)}>
                  Open in tree
                </button>
              )}
            </div>

            {nodeOptions.length ? (
              <SearchableSelect
                value={value} onChange={setValue}
                placeholder="Assign to node…"
                options={nodeOptions}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                No structure nodes exist yet — build the tree first, then come back.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Every item that needed an assignment has one now.</p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={close}>{current ? 'Close' : 'Done'}</Button>
          {current && (
            <>
              <Button variant="outline" onClick={skip} disabled={saving}>Skip</Button>
              <Button onClick={saveAndNext} disabled={saving || !value}>
                {saving ? 'Saving…' : 'Save & Next'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
