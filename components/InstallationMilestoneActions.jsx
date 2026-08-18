'use client';

// Site Installation and Commissioning have no data anywhere else in the app to auto-detect
// completion from (no site-visit log, no commissioning record) — unlike Production/QC/Dispatch's
// milestones, which lib/milestone-auto.js infers from job cards/QC records/packing status. This is
// the explicit substitute: a real, standardized action instead of the generic milestone-status
// drawer, same shortcut pattern as Design's "Approve Design" button (DesignPanel.jsx).
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { CheckIcon } from 'lucide-react';

export default function InstallationMilestoneActions({ projectId, milestones = [], canMark = false }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState(null);
  const targets = milestones.filter(m => m.milestone_key === 'site_installation' || m.milestone_key === 'commissioning');
  if (!targets.length) return null;

  async function markComplete(m) {
    setBusyId(m.id);
    try {
      await api(`/api/milestones/${m.id}`, { method: 'PATCH', body: { status: 'done' } });
      showToast(`${m.milestone_label} marked complete`);
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusyId(null); }
  }

  const isDone = m => !!(m.actual_end || m.status === 'done');

  return (
    <Card>
      <CardHeader><CardTitle>Installation Progress</CardTitle></CardHeader>
      <CardContent className="flex flex-col divide-y p-0">
        {targets.map(m => (
          <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="text-sm font-medium">{m.milestone_label}</span>
            {isDone(m) ? (
              <span className="flex items-center gap-1 text-xs text-success"><CheckIcon className="size-3.5" />Complete</span>
            ) : canMark ? (
              <Button size="sm" variant="outline" disabled={busyId === m.id} onClick={() => markComplete(m)}>
                {busyId === m.id ? 'Marking…' : 'Mark complete'}
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">Not yet complete</span>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
