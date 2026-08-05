'use client';

// Procurement's own worklist, above the raw BOM table: a per-project D4 stage bar (§ Phase 5.0b).
// The cancel-requests card that used to live here (tasks.bom_item_id + accept-cancellations) is
// retired — Group 5 Bundle B's D10 direct-cancel action (Eng/Design's BomTable Cancel button)
// replaces it; there's nothing left for Procurement to accept, cancelling just happens. The
// accept-cancellations route is left in place but dead, same "don't drop" precedent as Bundle A's
// procurement_requests.
import { Card, CardAction, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import Link from 'next/link';
import BomStageBar, { BomStageLegend } from './BomStageBar';
import { bomStageCounts } from '@/lib/bom-fields.mjs';

export default function ProcurementQueue({ bom = [] }) {
  // § Phase 5.0b — stage bar replaces the old 3-tile Sourcing/PO-placed/In-transit split.
  const stages = bomStageCounts(bom);
  const openCount = bom.length - stages.Received - stages.Cancelled - stages['In-Stock'];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Procurement queue</CardTitle>
        <CardAction>
          <Button asChild size="sm" variant="outline">
            {/* Sourcing/quotes/POs are cross-project — that workspace lives at /procurement, not
                scoped to this one project (§5a). */}
            <Link href="/procurement">Open Procurement workspace →</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground tnum">{bom.length}</span> item{bom.length !== 1 ? 's' : ''}
            {openCount > 0 && <> · <span className="font-medium text-foreground tnum">{openCount}</span> moving</>}
          </p>
          <BomStageBar counts={stages} size="full" />
          <BomStageLegend />
        </div>
      </CardContent>
    </Card>
  );
}
