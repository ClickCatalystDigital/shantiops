'use client';

// components/bom-structure/MoveAssemblyDialog.jsx — explicit reparent action (not drag-and-drop,
// see the plan's own reasoning: no dnd dependency exists in this app, and the cycle guard this
// dialog already needs is exactly what a from-scratch drag reorder would need anyway).
//
// Two-step picker, replacing the original single flat "every node in the project" dropdown (hard to
// scan on a large tree): step 1 picks the target LEVEL (System/Subsystem/Assembly/Sub-assembly/
// Item — lib/bom-tree.mjs's NODE_TYPE_SUGGESTIONS), step 2 lists only same-project, non-cycle
// candidates at the level directly above it (choosing "Sub-assembly" lists Assembly-level parents),
// each labeled with its full breadcrumb path so a same-named node under different parents is
// distinguishable. "System" has no parent by construction — no step 2, same as the old dialog's
// "— Top level —" option. node_type is free text with no DB enforcement (SYSTEM.md), so every
// candidate's level is resolved via effectiveNodeLevel (own node_type when recognized, else a
// depth-based fallback) rather than a strict string match, so a custom-labeled or NULL-typed node
// still buckets into one of the 5 levels instead of silently vanishing from the picker.
import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import SearchableSelect from '@/components/SearchableSelect';
import { wouldCreateCycle } from '@/lib/bom-structure.mjs';
import { NODE_TYPE_SUGGESTIONS, effectiveNodeLevel, nodePath } from '@/lib/bom-tree.mjs';

const TOP_LEVEL_TYPE = NODE_TYPE_SUGGESTIONS[0]; // 'System' — no parent, by construction

export default function MoveAssemblyDialog({ node, assemblies, onClose, onMove }) {
  const byId = useMemo(() => new Map(assemblies.map(a => [a.id, a])), [assemblies]);

  // Default to the node's own current level (its current parent's level, one rung down — or System
  // if it has no parent) so opening the dialog starts at "no change," same intent as the old
  // dialog's `useState(node.parent_id ? ... : TOP_LEVEL)` seeding.
  const currentParent = node.parent_id != null ? byId.get(node.parent_id) : null;
  const defaultLevel = currentParent
    ? NODE_TYPE_SUGGESTIONS[Math.min(
        NODE_TYPE_SUGGESTIONS.indexOf(effectiveNodeLevel(currentParent, byId)) + 1,
        NODE_TYPE_SUGGESTIONS.length - 1
      )]
    : TOP_LEVEL_TYPE;

  const [level, setLevel] = useState(defaultLevel);
  const [parentId, setParentId] = useState(node.parent_id != null ? String(node.parent_id) : '');
  const [saving, setSaving] = useState(false);

  const needsParent = level !== TOP_LEVEL_TYPE;
  const parentLevel = NODE_TYPE_SUGGESTIONS[Math.max(0, NODE_TYPE_SUGGESTIONS.indexOf(level) - 1)];

  const candidates = useMemo(() => {
    if (!needsParent) return [];
    return assemblies.filter(a =>
      a.id !== node.id && !wouldCreateCycle(node.id, a.id, byId) && effectiveNodeLevel(a, byId) === parentLevel
    );
  }, [assemblies, node.id, byId, needsParent, parentLevel]);

  const options = useMemo(
    () => candidates.map(a => ({ value: String(a.id), label: nodePath(a.id, byId).join(' › ') })),
    [candidates, byId]
  );

  function chooseLevel(l) {
    setLevel(l);
    setParentId('');
  }

  async function submit() {
    setSaving(true);
    try {
      await onMove(needsParent ? Number(parentId) : null, level);
      onClose();
    } finally { setSaving(false); }
  }

  const canSubmit = !needsParent || (parentId !== '' && candidates.some(c => String(c.id) === parentId));

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Move "{node.name}"</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Move this to which level?</p>
            <div className="flex flex-wrap gap-1.5">
              {NODE_TYPE_SUGGESTIONS.map(l => (
                <button
                  key={l} type="button" onClick={() => chooseLevel(l)}
                  className={`rounded-full border px-2.5 py-1 text-xs ${level === l ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          {needsParent && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Under which {parentLevel}?</p>
              {options.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No {parentLevel}-level nodes exist yet — create one first, or choose a different level.
                </p>
              ) : (
                <SearchableSelect
                  value={parentId} onChange={setParentId} options={options}
                  placeholder={`Search ${parentLevel} nodes…`} className="w-full"
                />
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !canSubmit}>{saving ? 'Moving…' : 'Move'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
