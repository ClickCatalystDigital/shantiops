'use client';

// components/DispatchBatchPackingPanel.jsx — Multi-unit split Phase 7 UI: the entry point for
// POST /api/packing/batch-children. Pick units, get one packing list per unit pre-filled from the
// master's own ready-to-pack BOM lines at the per-unit quantity. Safely re-runnable — a unit with
// nothing new to add is silently skipped, not duplicated.
import { useEffect, useState } from 'react';
import { showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

export default function DispatchBatchPackingPanel({ projectId }) {
  const [children, setChildren] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/split`).then(r => r.json())
      .then(j => setChildren(j.children || [])).catch(() => {});
  }, [projectId]);

  function toggle(id) {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  async function submit() {
    if (!selected.size) return showToast('Pick at least one unit', 'error');
    setBusy(true);
    try {
      const res = await fetch('/api/packing/batch-children', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ master_project_id: Number(projectId), child_project_ids: [...selected] }),
      }).then(r => r.json().then(j => ({ ok: r.ok, ...j })));
      if (!res.ok) throw new Error(res.error || 'Failed');
      showToast(`Created ${res.created.length} packing lists${res.skipped.length ? ` (${res.skipped.length} already up to date)` : ''}`);
      setSelected(new Set());
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(false);
  }

  if (!children.length) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Generate packing lists across units</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          {children.map(c => (
            <label key={c.id} className="flex items-center gap-1.5 text-sm">
              <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} />
              {c.project_no}
            </label>
          ))}
        </div>
        <Button size="sm" className="w-fit" disabled={busy} onClick={submit}>
          {busy ? '…' : `Generate for ${selected.size || ''} unit(s)`}
        </Button>
      </CardContent>
    </Card>
  );
}
