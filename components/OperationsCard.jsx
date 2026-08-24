// components/OperationsCard.jsx
'use client';

// The shared unified Operations card (operations-tab-changes.md) — generalizes
// DesignOperationsCard.jsx into one component every department's Operations view uses. Renders,
// same three rows Design's card originated:
//   Row 1: flow chart (bare), full width
//   Row 2: Outgoing / Incoming Incidents, two columns — or one full-width column when a
//           department has no direction split (pass only `outgoing`)
//   Row 3: MasterWorkTable, full width
// Pure/filtered-input: this component owns no FilterPills or filter state of its own — that lives
// once, at the page level, in OperationsFilterBar.jsx, which is what actually renders this.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import MasterWorkTable from './MasterWorkTable';
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

export default function OperationsCard({
  dept, flow, outgoing, incoming = null, work, columns, sourcingItems = [], emptyMessage,
  href, linkLabel, filterProjectIds = null,
}) {
  const router = useRouter();

  const filteredOutgoing = filterProjectIds ? outgoing.filter(t => filterProjectIds.has(t.project_id)) : outgoing;
  const filteredIncoming = incoming && filterProjectIds ? incoming.filter(t => filterProjectIds.has(t.project_id)) : incoming;
  const filteredWork = filterProjectIds ? work.filter(w => filterProjectIds.has(w.id)) : work;
  const isFiltered = filterProjectIds !== null;

  return (
    <Card>
      <CardHeader>
        <CardAction>
          <Button asChild size="sm" variant="outline">
            <Link href={href}>{linkLabel}</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {/* Row 1 — flow chart, full width. */}
        {flow}

        {/* Row 2 — Outgoing / Incoming, or one full-width column when there's no split. */}
        <div className={`grid gap-6 border-t pt-6 ${incoming ? 'sm:grid-cols-2' : ''}`}>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{incoming ? 'Outgoing Incidents' : 'Incidents'}</span>
                <CountBadge count={filteredOutgoing.length} />
              </div>
              <RaiseDialog department={dept} milestones={[]} router={router} />
            </div>
            <TicketsPanel department={dept} showDepartment={!!incoming} tasks={filteredOutgoing} bom={sourcingItems} bare hideTitle />
          </div>
          {incoming && (
            <div className="flex flex-col gap-2 sm:border-l sm:pl-6">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Incoming Incidents</span>
                <CountBadge count={filteredIncoming.length} />
              </div>
              <TicketsPanel department={dept} tasks={filteredIncoming} bare hideTitle />
            </div>
          )}
        </div>

        {/* Row 3 — projects table. */}
        <div className="border-t pt-6">
          {isFiltered && filteredWork.length === 0 ? (
            <p className="text-sm text-muted-foreground">No projects match the selected filter.</p>
          ) : (
            <MasterWorkTable work={filteredWork} columns={columns} emptyMessage={emptyMessage} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
