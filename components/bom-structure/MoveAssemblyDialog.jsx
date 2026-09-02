'use client';

// components/bom-structure/MoveAssemblyDialog.jsx — explicit reparent action (not drag-and-drop,
// see the plan's own reasoning: no dnd dependency exists in this app, and the cycle guard this
// dialog already needs is exactly what a from-scratch drag reorder would need anyway). Filters out
// invalid targets client-side for instant feedback via the same wouldCreateCycle the server
// re-checks authoritatively.
import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { wouldCreateCycle } from '@/lib/bom-structure.mjs';

const TOP_LEVEL = '__top__';

export default function MoveAssemblyDialog({ node, assemblies, onClose, onMove }) {
  const [target, setTarget] = useState(node.parent_id ? String(node.parent_id) : TOP_LEVEL);
  const [saving, setSaving] = useState(false);

  const byId = useMemo(() => new Map(assemblies.map(a => [a.id, a])), [assemblies]);
  const validTargets = useMemo(
    () => assemblies.filter(a => a.id !== node.id && !wouldCreateCycle(node.id, a.id, byId)),
    [assemblies, node.id, byId]
  );

  async function submit() {
    setSaving(true);
    try {
      await onMove(target === TOP_LEVEL ? null : Number(target));
      onClose();
    } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Move "{node.name}"</DialogTitle></DialogHeader>
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TOP_LEVEL}>— Top level —</SelectItem>
            {validTargets.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Moving…' : 'Move'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
