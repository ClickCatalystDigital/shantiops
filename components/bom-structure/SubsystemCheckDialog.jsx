'use client';

// components/bom-structure/SubsystemCheckDialog.jsx — "possibly missing": per subsystem, the REQUIRED lines of the
// closest saved build that this BOM does not have. Informational only: read it, add what is really missing (Add
// subsystem, or add the line on the node), and mark the rest "Not needed here". Never blocks Release.
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { api, showToast } from '@/lib/client';

export default function SubsystemCheckDialog({ projectId, groups, onClose, onOpenNode, onChanged }) {
  const [busyKey, setBusyKey] = useState(null);
  const [hidden, setHidden] = useState(new Set());

  async function dismiss(nodeId, key) {
    setBusyKey(`${nodeId}:${key}`);
    try {
      await api(`/api/projects/${projectId}/subsystem-check`, { method: 'POST', body: { node_id: nodeId, key } });
      setHidden(h => new Set([...h, `${nodeId}:${key}`]));
      onChanged?.();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusyKey(null); }
  }

  const shown = groups.map(g => ({ ...g, missing: g.missing.filter(m => !hidden.has(`${g.node_id}:${m.key}`)) })).filter(g => g.missing.length);
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Possibly missing</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Lines that the saved build of each subsystem always has, and this BOM does not. A different size of the same item counts as present.
          This is a list to read — it never blocks release.
        </p>
        {shown.length === 0 ? <p className="text-sm text-muted-foreground">Nothing left to check.</p> : (
          <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto">
            {shown.map(g => (
              <div key={g.node_id} className="rounded-md border">
                <div className="flex items-center justify-between gap-2 bg-muted/40 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{g.node}</div>
                    <div className="truncate text-xs text-muted-foreground">compared with “{g.build.name}”</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => { onOpenNode(g.node_id); onClose(); }}>Open in tree</Button>
                </div>
                {g.missing.map(m => (
                  <div key={m.key} className="flex items-center justify-between gap-3 border-t px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate">{m.description}</span>
                      <span className="block truncate text-xs text-muted-foreground">{[m.path, m.size_spec, m.qty_text].filter(Boolean).join(' · ')}</span>
                    </span>
                    <Button size="sm" variant="ghost" disabled={busyKey === `${g.node_id}:${m.key}`} onClick={() => dismiss(g.node_id, m.key)}>Not needed here</Button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        <DialogFooter className="m-0"><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
