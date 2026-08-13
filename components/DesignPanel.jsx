// CALC-CHANGES2.md §D — Design's dedicated project-page panel. Now a client component: Calc
// Sheets + Drawings sit side by side (DESIGN-OPS-REDESIGN.md, Project page) and Activity collapses
// behind a toggle instead of always rendering.
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { ChevronDownIcon } from 'lucide-react';
import ScopeOfSupplyPanel from './ScopeOfSupplyPanel';

const SHEET_STATUS_STYLE = {
  pass: { label: 'Pass', cls: 'text-success bg-success/10 ring-1 ring-inset ring-success/20' },
  warn: { label: 'Warning', cls: 'text-warning bg-warning/10 ring-1 ring-inset ring-warning/20' },
  fail: { label: 'Fail', cls: 'text-destructive bg-destructive/10 ring-1 ring-inset ring-destructive/20' },
  no_data: { label: 'No snapshot yet', cls: 'text-muted-foreground bg-muted ring-1 ring-inset ring-border' },
};
const DRAWING_STATUS_LABEL = {
  not_started: 'Not started', in_progress: 'In progress', under_review: 'Under review', approved: 'Approved', as_built: 'As built',
};

export default function DesignPanel({ projectId, designSummary, scopeOfSupply = [], canEditScope = false }) {
  const { calcSheets = [], drawings = [], activity = [] } = designSummary || {};
  const drawingsComplete = drawings.filter((d) => d.status === 'approved' || d.status === 'as_built').length;
  const [activityOpen, setActivityOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
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
                <span className="text-sm font-medium">{s.name}</span>
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
              <div key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="text-sm font-medium">{d.name}</span>
                <span className="text-xs text-muted-foreground">{DRAWING_STATUS_LABEL[d.status]}</span>
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