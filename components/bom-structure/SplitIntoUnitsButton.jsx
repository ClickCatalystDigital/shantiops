'use client';

// components/bom-structure/SplitIntoUnitsButton.jsx — Multi-unit split, the actual UI entry point
// for POST/GET /api/projects/[id]/split (MULTI-UNIT-SPLIT-DESIGN.md §6). Lives next to Release BOM
// on ReleaseReadinessPanel, the placement the design doc specified. Self-fetches its own
// eligibility so it stays silent (renders nothing) for the ~100% common case — a project with
// unit_count=1 never sees this at all.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { showToast } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { LayersIcon, PlusIcon } from 'lucide-react';

// Phase E — post-split resize: "add more units" is the only supported direction (confirmed scope,
// MULTI-UNIT-SPLIT-DESIGN.md open question #5). Cancelling a specific already-split child is
// deliberately not built.
function AddUnitsControl({ projectId, currentCount, onAdded }) {
  const [n, setN] = useState('');
  const [busy, setBusy] = useState(false);

  async function addUnits() {
    const count = Math.round(Number(n));
    if (!count || count < 1) return showToast('Enter how many units to add', 'error');
    if (!window.confirm(`Add ${count} more unit project(s), starting at unit ${currentCount + 1}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/split`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addUnits: count }),
      }).then(r => r.json().then(j => ({ ok: r.ok, ...j })));
      if (!res.ok) throw new Error(res.error || 'Failed to add units');
      showToast(`Added ${res.childIds.length} unit projects`);
      setN('');
      onAdded();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <div className="flex items-center gap-1">
      <Input type="number" min="1" placeholder="N" value={n} onChange={e => setN(e.target.value)}
        className="h-7 w-14 px-1.5 text-xs" disabled={busy} />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" variant="ghost" className="h-7 px-1.5" disabled={busy} onClick={addUnits}>
            <PlusIcon className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Add N more unit projects to this already-split order</TooltipContent>
      </Tooltip>
    </div>
  );
}

export default function SplitIntoUnitsButton({ projectId }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  function reload() {
    fetch(`/api/projects/${projectId}/split`).then(r => r.json()).then(setStatus).catch(() => {});
  }
  useEffect(() => { reload(); }, [projectId]);

  if (!status || status.isChild || status.unitCount < 2) return null;

  if (status.alreadySplit) {
    return (
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Link href="/projects">
              <Badge variant="outline" className="cursor-pointer gap-1 font-normal">
                <LayersIcon className="size-3" />{status.children.length} units created
              </Badge>
            </Link>
          </TooltipTrigger>
          <TooltipContent>View unit projects on the Projects list</TooltipContent>
        </Tooltip>
        <AddUnitsControl projectId={projectId} currentCount={status.children.length} onAdded={reload} />
      </div>
    );
  }

  async function split() {
    if (!status.canSplitNow) {
      showToast(status.bomReleased ? 'Set Unit Count to 2 or more first' : 'Release the BOM first', 'error');
      return;
    }
    if (!window.confirm(
      `Create ${status.unitCount} real unit projects (SB-...-01 through -${String(status.unitCount).padStart(2, '0')})? ` +
      `This cannot be undone — a master can only be split once.`
    )) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/split`, { method: 'POST' }).then(r => r.json().then(j => ({ ok: r.ok, ...j })));
      if (!res.ok) throw new Error(res.error || 'Split failed');
      showToast(`Created ${res.unitCount} unit projects`);
      reload();
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="sm" variant="outline" disabled={busy || !status.canSplitNow} onClick={split}>
          <LayersIcon className="size-4" />
          {busy ? 'Splitting…' : `Split into ${status.unitCount} Units`}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {status.canSplitNow
          ? `Creates ${status.unitCount} real per-unit projects for QC/Production/Dispatch to work — one-time, irreversible.`
          : status.bomReleased ? 'Unit Count must be 2 or more.' : 'Release the BOM at least once first.'}
      </TooltipContent>
    </Tooltip>
  );
}
