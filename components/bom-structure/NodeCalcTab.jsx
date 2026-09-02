'use client';

// components/bom-structure/NodeCalcTab.jsx — a node's linked calc sheets. Same junction shape as
// NodeDrawingsTab, no approval-state concept (calc sheets have no equivalent ladder). Linked rows
// render through EntityCode (real CS-#### code), not a hand-rolled link.
import { useEffect, useState } from 'react';
import { api, showToast } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EntityCode } from '@/components/EntityRefLink';
import { TrashIcon, CalculatorIcon } from 'lucide-react';

export default function NodeCalcTab({ projectId, node, onLinkChange }) {
  const [links, setLinks] = useState(null);
  const [candidates, setCandidates] = useState(null);
  const [pickerValue, setPickerValue] = useState('');

  function loadLinks() {
    api(`/api/bom-assemblies/${node.id}/calc-sheets`).then(setLinks).catch(err => showToast(err.message, 'error'));
  }
  useEffect(loadLinks, [node.id]);
  useEffect(() => {
    api(`/api/calc-sheets?project_id=${projectId}`).then(d => setCandidates(d.sheets)).catch(err => showToast(err.message, 'error'));
  }, [projectId]);

  async function link(calcSheetId) {
    setPickerValue('');
    try {
      await api(`/api/bom-assemblies/${node.id}/calc-sheets`, { method: 'POST', body: { calc_sheet_id: Number(calcSheetId) } });
      loadLinks();
      onLinkChange?.();
    } catch (err) { showToast(err.message, 'error'); }
  }
  async function unlink(calcSheetId) {
    try {
      await api(`/api/bom-assemblies/${node.id}/calc-sheets?calc_sheet_id=${calcSheetId}`, { method: 'DELETE' });
      loadLinks();
      onLinkChange?.();
    } catch (err) { showToast(err.message, 'error'); }
  }

  const linkedIds = new Set((links || []).map(l => l.id));
  const options = (candidates || []).filter(s => !linkedIds.has(s.id));

  return (
    <div className="flex flex-col gap-3">
      <Select value={pickerValue} onValueChange={link}>
        <SelectTrigger className="h-8 w-72"><SelectValue placeholder="Link a calculation sheet…" /></SelectTrigger>
        <SelectContent>
          {options.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No matching calc sheets</div>}
          {options.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.cs_no || 'CS'} · {s.name}</SelectItem>)}
        </SelectContent>
      </Select>

      {links === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : links.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-md border border-dashed py-8 text-center">
          <CalculatorIcon className="size-5 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">No calculation sheets linked to this node yet.</p>
        </div>
      ) : (
        <div className="flex flex-col divide-y rounded-md border">
          {links.map(s => (
            <div key={s.id} className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm transition-colors hover:bg-muted/40">
              <div className="flex items-center gap-2">
                <CalculatorIcon className="size-4 shrink-0 text-muted-foreground" />
                <EntityCode code={s.cs_no} fallback={s.name} />
              </div>
              <Button size="icon-sm" variant="ghost" className="text-danger" onClick={() => unlink(s.id)} aria-label="Unlink">
                <TrashIcon className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
