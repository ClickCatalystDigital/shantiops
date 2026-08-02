'use client';

// Operations' Procurement pipeline glance (§2 of the redesign) — a small flowchart, not a data
// chart, so per the dataviz skill it doesn't need a validated categorical palette: every node uses
// the same neutral shape and border, Cancelled included — "should be black and same as others," per
// feedback on an earlier pass that gave it a full red border/text treatment and looked heavier than
// the rest. The only signal that it's a different outcome is a faint red wash and a red label word.
//
// Redesigned three times: v1 was flat boxed tiles + arrow glyphs with Cancelled as an unconnected
// header badge. v2 was a dot-spine with dashed diagonal drop-lines. v3 gave Cancelled a full red
// border/number, sat it under Selection, and had no arrowheads. This version: rectangle nodes,
// **Cancelled positioned under Closed** (both are terminal states, so the diagram reads left-to-right
// as one flow instead of branching off the middle), and small chevron arrowheads on every segment —
// the CSS-grid spine (`grid-cols-5` fixes each node's center at an exact 10/30/50/70/90% column
// position, shared by the branch connectors below so nothing needs pixel measurement) plus
// right-angle elbow connectors (SVG paths, `strokeLinejoin="round"` rounds the corners) merging
// Sourcing/Selection/PO issued into the same x=90 column Closed and Cancelled share.
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from './ui/card';
import { Button } from './ui/button';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';
import { InfoIcon, ChevronRightIcon, ChevronDownIcon } from 'lucide-react';

const STAGES = [
  { key: 'requests', label: 'Requests', help: 'New-item and cancel requests from other departments, waiting for Procurement to accept them.' },
  { key: 'sourcing', label: 'Sourcing', help: 'Accepted items with no quote logged yet — Procurement still needs to contact suppliers.' },
  { key: 'selection', label: 'Selection', help: 'At least one quote is in, but no supplier has been picked yet.' },
  { key: 'po_issued', label: 'PO issued', help: 'A supplier is selected and a purchase order has been drafted or issued.' },
  { key: 'closed', label: 'Closed', help: 'Delivered and closed out (or received by Stores).' },
];
const CANCELLED_HELP = 'Cancelled from Sourcing, Selection, or after a PO was issued — a request never reaches this from Requests or Closed.';
// Shared x-positions (% of the diagram's width) — the single source of truth every piece below
// (node columns, the spine arrows, the branch elbows) positions itself against.
const X = { requests: 10, sourcing: 30, selection: 50, po_issued: 70, closed: 90 };

function InfoButton({ label, help, tone }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`What is ${label}?`}
          className={tone === 'danger' ? 'text-danger/60 hover:text-danger' : 'text-muted-foreground/70 hover:text-foreground'}>
          <InfoIcon className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-64 text-xs text-muted-foreground">{help}</PopoverContent>
    </Popover>
  );
}

// The one node shape, reused for every stage including Cancelled — same border, same black value
// text as a normal stage. Only a faint background wash and the label word itself carry the "this is
// the cancelled outcome" signal, so it reads as a sibling of Closed, not a heavier/alarming box.
function StageBox({ value, label, help, tone = 'neutral' }) {
  const boxTone = tone === 'danger' ? 'border-border bg-danger/5' : 'border-border bg-card';
  const labelTone = tone === 'danger' ? 'text-danger/90' : 'text-muted-foreground';
  return (
    <div className={`relative z-10 flex min-w-[6.5rem] flex-col items-center gap-1 rounded-lg border px-4 py-2.5 shadow-sm ${boxTone}`}>
      <div className="flex items-center gap-1">
        <span className="text-lg font-semibold tnum leading-none text-foreground">{value}</span>
        <InfoButton label={label} help={help} tone={tone} />
      </div>
      <span className={`text-xs ${labelTone}`}>{label}</span>
    </div>
  );
}

// A mini arrowhead on the spine, at the midpoint between two node centers — its own small square
// viewBox (not the diagram's stretched one) so it never gets skewed by the connector SVG's
// non-uniform x/y scaling below.
function FlowArrow({ atPercent }) {
  return (
    <ChevronRightIcon className="absolute top-1/2 z-10 size-3.5 -translate-x-1/2 -translate-y-1/2 text-muted-foreground/50"
      style={{ left: `${atPercent}%` }} />
  );
}

export default function ProcurementFlow({ counts }) {
  const midpoints = [
    (X.requests + X.sourcing) / 2, (X.sourcing + X.selection) / 2,
    (X.selection + X.po_issued) / 2, (X.po_issued + X.closed) / 2,
  ];

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
        {/* Nodes have a min-width (StageBox) that would otherwise get crushed into truncated
            labels on a narrow screen once 5 of them share one row — scroll horizontally instead
            of squeezing, same trade-off any dashboard makes for a wide stat row on mobile. */}
        <div className="overflow-x-auto">
          <div className="mx-auto flex min-w-[34rem] flex-col items-center">
            {/* Row 1 — grid-cols-5 fixes each node's center at 10/30/50/70/90%, so the spine
                arrows and the branch connectors below can share those exact x-positions without
                measuring anything. */}
            <div className="relative grid w-full grid-cols-5">
              <div className="absolute inset-x-[10%] top-1/2 h-px -translate-y-1/2 bg-border" />
              {midpoints.map(x => <FlowArrow key={x} atPercent={x} />)}
              {STAGES.map(s => (
                <div key={s.key} className="flex items-center justify-center">
                  <StageBox value={counts[s.key]} label={s.label} help={s.help} />
                </div>
              ))}
            </div>

            {/* Branch connectors — Sourcing/Selection/PO issued all elbow over to the x=90 column,
                the same one Closed sits in above and Cancelled sits in below, then one shared trunk
                drops into Cancelled. Right-aligning Cancelled under Closed (both terminal states)
                reads as one flow continuing right, not a branch off the middle. Three lines in, one
                out — same "several sources, one target" shape as an org chart;
                strokeLinejoin="round" is the whole trick for the rounded 90° corners. */}
            <div className="relative w-full">
              <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-8 w-full">
                <path d={`M${X.sourcing},0 L${X.sourcing},16 L${X.closed},16`} className="fill-none stroke-danger/30"
                  strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d={`M${X.selection},0 L${X.selection},16 L${X.closed},16`} className="fill-none stroke-danger/30"
                  strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d={`M${X.po_issued},0 L${X.po_issued},16 L${X.closed},16`} className="fill-none stroke-danger/30"
                  strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d={`M${X.closed},16 L${X.closed},32`} className="fill-none stroke-danger/30"
                  strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <ChevronDownIcon className="absolute bottom-0 z-10 size-3.5 -translate-x-1/2 translate-y-1/2 text-danger/50"
                style={{ left: `${X.closed}%` }} />
            </div>

            <div className="grid w-full grid-cols-5">
              <div className="col-start-5 flex items-center justify-center">
                <StageBox value={counts.cancelled} label="Cancelled" help={CANCELLED_HELP} tone="danger" />
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
