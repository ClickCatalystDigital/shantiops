'use client';

// Operations' Procurement pipeline glance (§2 of the redesign) — replaces the old plain
// Sourcing/PO-placed/In-transit KPI tiles with a left-to-right flow diagram plus a separate
// Cancelled tile (an item can drop out at any stage, not just the end). Counts are a strict
// partition (lib/data.js getProcurementFlowCounts) so they read as a real pipeline, not just
// unrelated numbers — a Sankey was considered and rejected for this: one branch (Cancelled) isn't
// enough crossing structure to justify it, and with sparse data it reads as broken rather than
// informative, the way the old segmented Sourcing counts did before real quotes existed.
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from './ui/card';
import { Button } from './ui/button';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';
import { InfoIcon, ArrowRightIcon } from 'lucide-react';

const STAGES = [
  { key: 'requests', label: 'Requests', help: 'New-item and cancel requests from other departments, waiting for Procurement to accept them.' },
  { key: 'sourcing', label: 'Sourcing', help: 'Accepted items with no quote logged yet — Procurement still needs to contact suppliers.' },
  { key: 'selection', label: 'Selection', help: 'At least one quote is in, but no supplier has been picked yet.' },
  { key: 'po_issued', label: 'PO issued', help: 'A supplier is selected and a purchase order has been drafted or issued.' },
  { key: 'closed', label: 'Closed', help: 'Delivered and closed out (or received by Stores).' },
];

function Stage({ stage, value, last }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-col items-center gap-1 rounded-md bg-muted/40 px-4 py-3 text-center">
        <div className="flex items-center gap-1">
          <span className="text-xl font-semibold tnum">{value}</span>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" aria-label={`What is ${stage.label}?`} className="text-muted-foreground hover:text-foreground">
                <InfoIcon className="size-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="center" className="w-64 text-xs text-muted-foreground">{stage.help}</PopoverContent>
          </Popover>
        </div>
        <p className="text-xs text-muted-foreground">{stage.label}</p>
      </div>
      {!last && <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" />}
    </div>
  );
}

export default function ProcurementFlow({ counts }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Procurement</CardTitle>
        <CardAction className="flex items-center gap-2">
          <span className="rounded-full bg-danger/10 px-2.5 py-1 text-xs font-medium text-danger ring-1 ring-inset ring-danger/20">
            {counts.cancelled} cancelled
          </span>
          <Button asChild size="sm" variant="outline">
            <Link href="/procurement">Open Procurement workspace →</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-2">
          {STAGES.map((s, i) => (
            <Stage key={s.key} stage={s} value={counts[s.key]} last={i === STAGES.length - 1} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
