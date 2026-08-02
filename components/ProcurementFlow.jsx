'use client';

// Operations' Procurement pipeline glance (§2 of the redesign) — replaces the old plain
// Sourcing/PO-placed/In-transit KPI tiles with a connected flow diagram. Counts are a strict
// partition (lib/data.js getProcurementFlowCounts) so they read as a real pipeline, not just
// unrelated numbers — a Sankey was considered and rejected for this: one branch (Cancelled) isn't
// enough crossing structure to justify it, and with sparse data it reads as broken rather than
// informative, the way the old segmented Sourcing counts did before real quotes existed.
//
// Phase 4 polish pass: the first version (separate boxed tiles + arrow glyphs, Cancelled as an
// unconnected header badge) read flat. Redesigned as one continuous spine with Cancelled as a real,
// visually connected branch off the three stages an item can actually be cancelled from (Sourcing,
// Selection, PO issued — not Requests, before it's even a BOM item, and not Closed, already done).
// Per the dataviz skill: this isn't a data chart needing a validated categorical palette — it's a
// sequential process, so the spine stays neutral (border/muted tokens) and only Cancelled gets a
// real status color (danger), shipped with both an icon and a label, never color alone.
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from './ui/card';
import { Button } from './ui/button';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';
import { InfoIcon, XCircleIcon } from 'lucide-react';

// x = horizontal position (%) along the spine — shared by the SVG connector lines and the HTML node
// labels below, so they always align regardless of container width (no flex/grid guessing).
const STAGES = [
  { key: 'requests', label: 'Requests', x: 8, help: 'New-item and cancel requests from other departments, waiting for Procurement to accept them.' },
  { key: 'sourcing', label: 'Sourcing', x: 29, help: 'Accepted items with no quote logged yet — Procurement still needs to contact suppliers.', branches: true },
  { key: 'selection', label: 'Selection', x: 50, help: 'At least one quote is in, but no supplier has been picked yet.', branches: true },
  { key: 'po_issued', label: 'PO issued', x: 71, help: 'A supplier is selected and a purchase order has been drafted or issued.', branches: true },
  { key: 'closed', label: 'Closed', x: 92, help: 'Delivered and closed out (or received by Stores).' },
];
const CANCELLED_HELP = 'Cancelled from Sourcing, Selection, or after a PO was issued — a request never reaches this from Requests or Closed.';
const SPINE_Y = 10;
const BRANCH_Y = 34;

function InfoButton({ label, help }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`What is ${label}?`} className="text-muted-foreground/70 hover:text-foreground">
          <InfoIcon className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-64 text-xs text-muted-foreground">{help}</PopoverContent>
    </Popover>
  );
}

export default function ProcurementFlow({ counts }) {
  const branchStages = STAGES.filter(s => s.branches);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Procurement</CardTitle>
        <CardAction>
          <Button asChild size="sm" variant="outline">
            <Link href="/procurement">Open Procurement workspace →</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="relative" style={{ height: 108 }}>
          {/* Connector layer — one coordinate system (0-100 x, 0-44 y) shared with the HTML node
              positions below, so the spine and branch lines always meet the dots exactly. */}
          <svg viewBox="0 0 100 44" preserveAspectRatio="none" className="absolute inset-0 size-full">
            <line x1={STAGES[0].x} y1={SPINE_Y} x2={STAGES[STAGES.length - 1].x} y2={SPINE_Y}
              className="stroke-border" strokeWidth="0.6" />
            {branchStages.map(s => (
              <line key={s.key} x1={s.x} y1={SPINE_Y} x2="50" y2={BRANCH_Y}
                className="stroke-danger/35" strokeWidth="0.5" strokeDasharray="2 2" />
            ))}
          </svg>

          {/* Spine nodes */}
          {STAGES.map(s => (
            <div key={s.key} className="absolute top-0 flex -translate-x-1/2 flex-col items-center gap-1.5"
              style={{ left: `${s.x}%` }}>
              <span className="size-2.5 rounded-full border-2 border-background bg-foreground/70 ring-1 ring-border" />
              <span className="text-xl font-semibold tnum leading-none">{counts[s.key]}</span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {s.label}
                <InfoButton label={s.label} help={s.help} />
              </span>
            </div>
          ))}

          {/* Cancelled branch node */}
          <div className="absolute flex -translate-x-1/2 flex-col items-center gap-1.5"
            style={{ left: '50%', top: `${(BRANCH_Y / 44) * 100}%` }}>
            <span className="flex items-center gap-1.5 rounded-full bg-danger/10 px-2.5 py-1 text-xs font-medium text-danger ring-1 ring-inset ring-danger/20">
              <XCircleIcon className="size-3.5" />
              {counts.cancelled} cancelled
              <InfoButton label="Cancelled" help={CANCELLED_HELP} />
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
