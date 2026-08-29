// CALC-CHANGES2.md §D — Design's dedicated project-page panel. Now a client component: Calc
// Sheets + Drawings sit side by side (DESIGN-OPS-REDESIGN.md, Project page) and Activity collapses
// behind a toggle instead of always rendering.
'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useEntityHighlight } from '@/lib/use-entity-highlight';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { ChevronDownIcon, CheckIcon } from 'lucide-react';
import ScopeOfSupplyPanel from './ScopeOfSupplyPanel';
import { api, showToast } from '@/lib/client';

import { TONE_CLASS } from '@/lib/status-styles';

const SHEET_STATUS_STYLE = {
  pass: { label: 'Pass', cls: TONE_CLASS.success },
  warn: { label: 'Warning', cls: TONE_CLASS.warning },
  fail: { label: 'Fail', cls: TONE_CLASS.destructive },
  no_data: { label: 'No snapshot yet', cls: TONE_CLASS.neutral },
};
const DRAWING_STATUS_STYLE = {
  not_started: { label: 'Not started', cls: TONE_CLASS.neutral },
  in_progress: { label: 'In progress', cls: TONE_CLASS.info },
  under_review: { label: 'Under review', cls: TONE_CLASS.warning },
  approved: { label: 'Approved', cls: TONE_CLASS.success },
  as_built: { label: 'As built', cls: TONE_CLASS.success },
};

export default function DesignPanel({ projectId, designSummary, scopeOfSupply = [], canEditScope = false, milestones = [], canApprove = false }) {
  useEntityHighlight(useSearchParams().get('highlight'));
  const { calcSheets = [], drawings = [], activity = [] } = designSummary || {};
  const drawingsComplete = drawings.filter((d) => d.status === 'approved' || d.status === 'as_built').length;
  const [activityOpen, setActivityOpen] = useState(false);
  const router = useRouter();
  const [approving, setApproving] = useState(false);
  const designMilestone = milestones.find(m => m.milestone_key === 'design');
  const designDone = !!(designMilestone?.actual_end || designMilestone?.status === 'done');

  async function approveDesign() {
    setApproving(true);
    try {
      await api(`/api/milestones/${designMilestone.id}`, { method: 'PATCH', body: { status: 'done' } });
      showToast('Design approved');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setApproving(false); }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Design = the head's own internal sign-off that the design is ready — no other data in the
          app can infer this (unlike Design Approval, which aggregates the customer's per-drawing
          approvals), so it's a real, explicit action instead of the generic milestone drawer. */}
      {designMilestone && (
        <Card>
          <CardContent className="flex items-center justify-between gap-3 py-4">
            <div>
              <p className="text-sm font-medium">Internal design sign-off</p>
              <p className="text-xs text-muted-foreground">Marks the Design milestone complete once the head is satisfied it's ready to proceed.</p>
            </div>
            {designDone ? (
              <span className="flex items-center gap-1 text-sm text-success"><CheckIcon className="size-4" />Approved</span>
            ) : canApprove ? (
              <Button size="sm" disabled={approving} onClick={approveDesign}>{approving ? 'Approving…' : 'Approve Design'}</Button>
            ) : (
              <span className="text-xs text-muted-foreground">Awaiting Design head</span>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Calculation Sheets</CardTitle>
            <CardAction>
              <Button asChild size="sm" variant="outline"><Link href={`/calc/project/${projectId}`}>Open Calc Sheet</Link></Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col divide-y p-0">
            {calcSheets.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="text-sm font-medium">{s.csNo && <span className="text-muted-foreground">{s.csNo} · </span>}{s.name}</span>
                <div className="flex items-center gap-2">
                  <Badge className={SHEET_STATUS_STYLE[s.status].cls} variant="outline">{SHEET_STATUS_STYLE[s.status].label}</Badge>
                  <Button asChild size="sm" variant="ghost"><Link href={`/calc/project/${projectId}/${s.id}`}>Open</Link></Button>
                </div>
              </div>
            ))}
            {calcSheets.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">No calculation sheets yet.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Drawings</CardTitle>
            <CardAction className="text-xs text-muted-foreground">{drawingsComplete} of {drawings.length} complete</CardAction>
          </CardHeader>
          <CardContent className="flex flex-col divide-y p-0">
            {drawings.map((d) => (
              <div key={d.id} data-entity-code={d.dgNo} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="text-sm font-medium">{d.dgNo && <span className="text-muted-foreground">{d.dgNo} · </span>}{d.name}</span>
                <Badge className={DRAWING_STATUS_STYLE[d.status].cls} variant="outline">{DRAWING_STATUS_STYLE[d.status].label}</Badge>
              </div>
            ))}
            {drawings.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">No drawings yet.</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardAction>
            <button
              type="button" onClick={() => setActivityOpen(o => !o)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Recent activity ({activity.length})
              <ChevronDownIcon className={`size-3.5 transition-transform ${activityOpen ? 'rotate-180' : ''}`} />
            </button>
          </CardAction>
        </CardHeader>
        {activityOpen && (
          <CardContent className="flex flex-col divide-y p-0">
            {activity.map((a, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-4 py-2 text-xs">
                <span>{a.label}</span>
                <span className="shrink-0 text-muted-foreground">{a.ts}</span>
              </div>
            ))}
            {activity.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">No recent activity.</p>}
          </CardContent>
        )}
      </Card>

      <ScopeOfSupplyPanel projectId={projectId} scopeOfSupply={scopeOfSupply} canEdit={canEditScope} />
    </div>
  );
}