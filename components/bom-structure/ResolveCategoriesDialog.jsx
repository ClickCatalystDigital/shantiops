'use client';

// components/bom-structure/ResolveCategoriesDialog.jsx — turns the readiness panel's aggregated
// "N uncategorized" count from a passive number into an actionable queue: one item at a time,
// Save & Next auto-advances, so filling in 30 gaps is a fast walkthrough instead of hunting through
// the tree or the flat table for each one. Direct user request, explicitly preferred over an
// import-time-only wizard — this works on the BOM's live state at any time (manually-added items,
// items an import guessed wrong and got cleared, etc.), not just the moment of upload.
//
// Deliberately named/shaped for categories specifically, not a generic "resolve any field" engine —
// the user floated reusing this pattern for other gaps (missing drawing, unassigned, etc.) later,
// but each of those has its own real shape (a drawing picker isn't a category Select); building a
// speculative one-size-fits-all framework now would cost more than it saves. If a second concrete
// case shows up, this file is the one to copy, not a base class to extend.
import { useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import SearchableSelect from '@/components/SearchableSelect';
import { CATEGORY_LABEL } from '@/lib/section-shapes';
import { api, showToast } from '@/lib/client';

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }));

// items: the live, uncategorized subset of projectBom, each optionally carrying `_path` (its
// assembly breadcrumb, or null for Unassigned — computed by the caller, which already has byId/
// nodePath in scope) so the reviewer has the same "where does this live" context the tree gives,
// without leaving the dialog for the common case.
export default function ResolveCategoriesDialog({ items, onClose, onOpenInTree, onResolved }) {
  const [queue, setQueue] = useState(items);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const total = items.length;
  const current = queue[0];

  function advance() {
    setQueue(q => q.slice(1));
    setValue('');
  }

  async function saveAndNext() {
    if (!current || !value) return;
    setSaving(true);
    try {
      await api(`/api/bom-items/${current.id}`, { method: 'PATCH', body: { category: value } });
      onResolved?.(current.id, value);
      advance();
    } catch (err) { showToast(err.message, 'error'); }
    setSaving(false);
  }

  function skip() { advance(); }

  function close() {
    // Anything actually saved (onResolved already fired per-item) sticks — closing early just
    // stops the walkthrough, it never undoes progress already made.
    onClose();
  }

  return (
    <Dialog open onOpenChange={o => !o && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Resolve categories</DialogTitle>
          <DialogDescription>
            {current ? `${total - queue.length + 1} of ${total}` : 'All done'} — pick a category and
            move to the next, or skip to leave it for later.
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
              <div className="mt-2 flex items-center gap-1.5">
                <Badge variant="outline" className="text-[10px] font-normal">
                  {current._path?.length ? current._path.join(' > ') : 'Unassigned'}
                </Badge>
                {onOpenInTree && (
                  <button type="button" className="text-xs text-primary underline" onClick={() => onOpenInTree(current)}>
                    Open in tree
                  </button>
                )}
              </div>
            </div>

            <SearchableSelect
              value={value} onChange={setValue}
              placeholder="Pick a category…"
              options={CATEGORY_OPTIONS}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Every item that had a category to pick has one now.</p>
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
