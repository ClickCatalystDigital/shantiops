'use client';

// components/bom-structure/BuildFromTemplatesDialog.jsx — the tree pane's "Build from Templates"
// entry point (always visible, next to "Add top-level node" — not buried in a tab). Lists every
// System-level template as a checkable card; applying inserts each selected one as a new top-level
// root (+ full descendants) in one batch call. This is the highest-value entry point of the whole
// Structure Templates feature — turning "rebuild a boiler's BOM" from hours into a few clicks.
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { api } from '@/lib/client';

export default function BuildFromTemplatesDialog({ onClose, onApply }) {
  const [templates, setTemplates] = useState(null);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    api('/api/bom-structure-templates?level=System').then(setTemplates).catch(() => setTemplates([]));
  }, []);

  function toggleChecked(id) {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (!checkedIds.size) return;
    setApplying(true);
    try {
      await onApply([...checkedIds]);
      onClose();
    } finally { setApplying(false); }
  }

  const totals = (templates || []).filter(t => checkedIds.has(t.id))
    .reduce((acc, t) => ({ nodes: acc.nodes + t.node_count, items: acc.items + t.item_count }), { nodes: 0, items: 0 });

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Build from Templates</DialogTitle>
        </DialogHeader>
        {templates === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No System-level templates saved yet — build a project's tree by hand once, then "Save as template" from a real top-level node to create one.</p>
        ) : (
          <>
            <div className="flex max-h-80 flex-col divide-y overflow-y-auto rounded-md border">
              {templates.map(t => (
                <label key={t.id} className="flex cursor-pointer items-start gap-2 px-3 py-2.5 text-sm transition-colors hover:bg-muted/40">
                  <Checkbox checked={checkedIds.has(t.id)} onCheckedChange={() => toggleChecked(t.id)} className="mt-0.5" />
                  <span className="flex flex-col">
                    <span className="flex items-center gap-1.5">
                      {t.name}
                      {t.is_default ? <span className="text-warning">★</span> : null}
                      {t.root_count > 1 && <span className="rounded-full bg-primary/15 px-1.5 py-0 text-[10px] text-primary">Complete BOM · {t.root_count} systems</span>}
                      {t.series && <span className="rounded-full border px-1.5 py-0 text-[10px] text-muted-foreground">{t.series}</span>}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t.node_count} node{t.node_count === 1 ? '' : 's'} · {t.item_count} item{t.item_count === 1 ? '' : 's'}
                      {t.source_project_no ? ` · ${t.source_project_no}` : ''}
                    </span>
                    {t.description && <span className="text-xs text-muted-foreground">{t.description}</span>}
                  </span>
                </label>
              ))}
            </div>
            {checkedIds.size > 0 && (
              <p className="text-xs text-muted-foreground">
                Creates {checkedIds.size} new top-level node{checkedIds.size === 1 ? '' : 's'} — {totals.nodes} node{totals.nodes === 1 ? '' : 's'} and{' '}
                {totals.items} item{totals.items === 1 ? '' : 's'} total, with their saved specs exactly as captured. Sizes/quantities may need review
                for this project's capacity before release.
              </p>
            )}
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={applying || !checkedIds.size}>
            {applying ? 'Building…' : `Build ${checkedIds.size || ''}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
