'use client';

// components/ProductionBatchJobCardPanel.jsx — Multi-unit split Phase 5 UI: the actual entry point
// for POST /api/job-cards/batch-children. Shown on a MASTER project's own page, only when it has
// real children (same gating as AllocationPanel). Picks several units + one milestone, creates one
// job card per unit (each its own record, per the guiding principle).
import { useEffect, useState } from 'react';
import { showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Same set of Production milestone_keys the single-item job-card creation flow already allows —
// no new restriction invented.
const PRODUCTION_MILESTONES = [
  ['marking_cutting', 'Marking, Cutting, Rolling Shell'], ['drilling', 'Drilling'],
  ['shell_welding', 'Shell Welding'], ['site_marking', 'Site Marking'],
  ['welding_fura', 'Welding (FURA-B / RC / AR)'], ['box_up', 'Box Up'],
  ['box_up_welding', 'Box Up Welding (OS / IS / G)'], ['tube_stay_welding', 'Tubes & Stay Rods'],
  ['pad_plates', 'Pad Plates / Saddles / Nozzles'], ['smoke_box', 'Smoke Box / Feed Line'],
  ['refractory', 'Refractory'], ['painting', 'Painting'],
];

export default function ProductionBatchJobCardPanel({ projectId }) {
  const [children, setChildren] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [milestoneKey, setMilestoneKey] = useState('');
  const [qty, setQty] = useState('1');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/split`).then(r => r.json())
      .then(j => setChildren(j.children || [])).catch(() => {});
  }, [projectId]);

  function toggle(id) {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  async function submit() {
    if (!milestoneKey) return showToast('Pick a milestone', 'error');
    if (!selected.size) return showToast('Pick at least one unit', 'error');
    setBusy(true);
    try {
      const res = await fetch('/api/job-cards/batch-children', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ milestone_key: milestoneKey, child_project_ids: [...selected], qty_planned: Number(qty) || 1 }),
      }).then(r => r.json().then(j => ({ ok: r.ok, ...j })));
      if (!res.ok) throw new Error(res.error || 'Failed');
      showToast(`Created ${res.created.length} job cards`);
      setSelected(new Set());
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  if (!children.length) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Raise job cards across units</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={milestoneKey} onValueChange={setMilestoneKey}>
            <SelectTrigger className="h-9 w-64"><SelectValue placeholder="Milestone…" /></SelectTrigger>
            <SelectContent>
              {PRODUCTION_MILESTONES.map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input className="h-9 w-24" placeholder="Qty" value={qty} onChange={e => setQty(e.target.value)} />
          <Button size="sm" disabled={busy} onClick={submit}>{busy ? '…' : `Create ${selected.size || ''} job card(s)`}</Button>
        </div>
        <div className="flex flex-wrap gap-3">
          {children.map(c => (
            <label key={c.id} className="flex items-center gap-1.5 text-sm">
              <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} />
              {c.project_no}
            </label>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
