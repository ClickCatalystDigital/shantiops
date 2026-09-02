'use client';

// components/bom-structure/NodeDrawingsTab.jsx — a node's linked drawings. Picker defaults to
// approved/as_built only (the "must not accidentally use an unapproved drawing" requirement);
// "Show all statuses" reveals the rest, each visibly badged "Under review" both in the picker and
// once linked, so pre-linking never silently reads as approval. Linked rows render through the
// existing EntityCode component (real DG-#### code), not a hand-rolled link.
import { useEffect, useState } from 'react';
import { api, showToast } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { EntityCode } from '@/components/EntityRefLink';
import { TrashIcon, FileTextIcon } from 'lucide-react';

const APPROVED_STATUSES = ['approved', 'as_built'];

export default function NodeDrawingsTab({ projectId, node, onLinkChange }) {
  const [links, setLinks] = useState(null);
  const [candidates, setCandidates] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [pickerValue, setPickerValue] = useState('');

  function loadLinks() {
    api(`/api/bom-assemblies/${node.id}/drawings`).then(setLinks).catch(err => showToast(err.message, 'error'));
  }
  function loadCandidates() {
    const q = showAll ? '' : `&status=${APPROVED_STATUSES.join(',')}`;
    api(`/api/calc-drawings?project_id=${projectId}${q}`).then(d => setCandidates(d.drawings)).catch(err => showToast(err.message, 'error'));
  }
  useEffect(loadLinks, [node.id]);
  useEffect(loadCandidates, [projectId, showAll]);

  async function link(drawingId) {
    setPickerValue('');
    try {
      await api(`/api/bom-assemblies/${node.id}/drawings`, { method: 'POST', body: { drawing_id: Number(drawingId) } });
      loadLinks();
      onLinkChange?.();
    } catch (err) { showToast(err.message, 'error'); }
  }
  async function unlink(drawingId) {
    try {
      await api(`/api/bom-assemblies/${node.id}/drawings?drawing_id=${drawingId}`, { method: 'DELETE' });
      loadLinks();
      onLinkChange?.();
    } catch (err) { showToast(err.message, 'error'); }
  }

  const linkedIds = new Set((links || []).map(l => l.id));
  const options = (candidates || []).filter(d => !linkedIds.has(d.id));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Select value={pickerValue} onValueChange={link}>
          <SelectTrigger className="h-8 w-72"><SelectValue placeholder="Link a drawing…" /></SelectTrigger>
          <SelectContent>
            {options.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No matching drawings</div>}
            {options.map(d => (
              <SelectItem key={d.id} value={String(d.id)}>
                {d.dgNo || 'DWG'} · {d.name}{!APPROVED_STATUSES.includes(d.status) ? ' (Under review)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant={showAll ? 'secondary' : 'outline'} className="h-8" onClick={() => setShowAll(v => !v)}>
          {showAll ? 'Showing all statuses' : 'Show all statuses'}
        </Button>
      </div>

      {links === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : links.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-md border border-dashed py-8 text-center">
          <FileTextIcon className="size-5 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">No drawings linked to this node yet.</p>
        </div>
      ) : (
        <div className="flex flex-col divide-y rounded-md border">
          {links.map(d => (
            <div key={d.id} className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm transition-colors hover:bg-muted/40">
              <div className="flex items-center gap-2">
                <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                <EntityCode code={d.dg_no} fallback={d.name} />
                {!APPROVED_STATUSES.includes(d.status) && (
                  <Badge variant="outline" className="text-warning">Under review — not yet approved</Badge>
                )}
              </div>
              <Button size="icon-sm" variant="ghost" className="text-danger" onClick={() => unlink(d.id)} aria-label="Unlink">
                <TrashIcon className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
