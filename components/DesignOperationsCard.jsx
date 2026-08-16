// components/DesignOperationsCard.jsx

// Operations page — Design's unified card (DESIGN-OPS-REDESIGN.md, "Operations page (Design;
// pattern reused per department)"). Replaces the old four-Card stack — flow chart → master table →
// per-project needs-attention cards → outgoing/incoming incidents — with one Card:
//   Row 1: flow chart, full width
//   Row 2: Outgoing Incidents / Incoming Incidents, two columns
//   Row 3: master table, full width
// Per-project "needs attention" cards are deliberately not reproduced here — the master table's
// Bottleneck column plus the project page's own Open Actions card already cover that ground
// (decided, doesn't need design_head confirmation — see decisions log).
//
// No card-level title and no per-row section titles beyond the Outgoing/Incoming labels
// (design_head only ever sees this card in a Design-scoped view, so "Design" as a heading was
// redundant there) — worth revisiting with a subtle eyebrow label if this card ever appears
// alongside sibling department cards on a multi-department Operations view.
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import DesignFlow from './DesignFlow';
import DesignMasterTable from './DesignMasterTable';
import TicketsPanel, { RaiseDialog } from './TicketsPanel';
import { Card, CardContent, CardHeader, CardAction } from './ui/card';
import { Button } from './ui/button';

function CountBadge({ count }) {
  return (
    <span className="flex size-5 items-center justify-center rounded-full bg-muted text-xs font-semibold tnum text-foreground">
      {count}
    </span>
  );
}

export default function DesignOperationsCard({ counts, designWork, outgoing, incoming, sourcingItems, filterProjectIds = null }) {
  const router = useRouter();

  // filterProjectIds is null when no pills are selected (show everything, unfiltered). When set,
  // only keep incidents/table rows belonging to a project that matched the pill filter — see
  // DesignOperationsSection for how that project set is derived. Flow chart counts (`counts`) are
  // untouched — those are totals, not a per-project list, so filtering doesn't apply the same way.
  const filteredOutgoing = filterProjectIds ? outgoing.filter(t => filterProjectIds.has(t.project_id)) : outgoing;
  const filteredIncoming = filterProjectIds ? incoming.filter(t => filterProjectIds.has(t.project_id)) : incoming;
  const filteredDesignWork = filterProjectIds ? designWork.filter(w => filterProjectIds.has(w.id)) : designWork;
  const isFiltered = filterProjectIds !== null;

  return (
    <Card>
      <CardHeader>
        <CardAction>
          <Button asChild size="sm" variant="outline">
            <Link href="/calc">Open Calc Sheets →</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {/* Row 1 — flow chart, full width. */}
        <DesignFlow counts={counts} bare />

        {/* Row 2 — Outgoing / Incoming, two real columns. Each owns its own header: label + a
            circular count badge, with the Raise trigger sitting inline next to Outgoing's (the
            only side that can raise). */}
        <div className="grid gap-6 border-t pt-6 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Outgoing Incidents</span>
                <CountBadge count={filteredOutgoing.length} />
              </div>
              <RaiseDialog department="Design" milestones={[]} router={router} />
            </div>
            <TicketsPanel department="Design" showDepartment tasks={filteredOutgoing} bom={sourcingItems} bare hideTitle />
          </div>
          <div className="flex flex-col gap-2 sm:border-l sm:pl-6">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Incoming Incidents</span>
              <CountBadge count={filteredIncoming.length} />
            </div>
            <TicketsPanel department="Design" tasks={filteredIncoming} bare hideTitle />
          </div>
        </div>

        {/* Row 3 — projects table. */}
        <div className="border-t pt-6">
          {isFiltered && filteredDesignWork.length === 0 ? (
            <p className="text-sm text-muted-foreground">No projects match the selected filter.</p>
          ) : (
            <DesignMasterTable designWork={filteredDesignWork} bare />
          )}
        </div>
      </CardContent>
    </Card>
  );
}