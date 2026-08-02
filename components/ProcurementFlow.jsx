'use client';

// Operations' Procurement pipeline glance (§2 of the redesign) — a small flowchart, not a data
// chart, so per the dataviz skill it doesn't need a validated categorical palette: the spine stays
// neutral (border/card tokens, matching every other stage box), only Cancelled gets a real status
// color (danger), applied to the exact same box shape every other stage uses rather than a
// different treatment — "looks like Closed, just in light red," not a special pill or badge.
//
// Redesigned twice: v1 was flat boxed tiles + arrow glyphs with Cancelled as an unconnected header
// badge. v2 was a dot-spine with dashed diagonal drop-lines — still read as busy/decorative rather
// than a real flowchart. This version: rectangle nodes on a CSS-grid spine (grid-cols-5 guarantees
// each node's center sits at an exact 10/30/50/70/90% column position, shared by the branch
// connectors below so nothing needs pixel measurement or a ResizeObserver to stay aligned), the
// horizontal spine drawn as one line *behind* the nodes so they visually break it into segments, and
// the three sources that can actually be cancelled (Sourcing/Selection/PO issued — not Requests,
// before it's even a BOM item, and not Closed, already done) merge into Cancelled via right-angle
// elbow connectors with rounded corners (SVG paths, `strokeLinejoin="round"` is what rounds a sharp
// L-turn — no arc math needed).
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from './ui/card';
import { Button } from './ui/button';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';
import { InfoIcon } from 'lucide-react';

const STAGES = [
  { key: 'requests', label: 'Requests', help: 'New-item and cancel requests from other departments, waiting for Procurement to accept them.' },
  { key: 'sourcing', label: 'Sourcing', help: 'Accepted items with no quote logged yet — Procurement still needs to contact suppliers.' },
  { key: 'selection', label: 'Selection', help: 'At least one quote is in, but no supplier has been picked yet.' },
  { key: 'po_issued', label: 'PO issued', help: 'A supplier is selected and a purchase order has been drafted or issued.' },
  { key: 'closed', label: 'Closed', help: 'Delivered and closed out (or received by Stores).' },
];
const CANCELLED_HELP = 'Cancelled from Sourcing, Selection, or after a PO was issued — a request never reaches this from Requests or Closed.';

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

// The one node shape, reused for every stage including Cancelled — a rounded rectangle "card",
// only the tone changes. This is the literal answer to "Cancelled should look similar to Closed,
// just in light red": same component, same size, same layout, tone='danger' instead of 'neutral'.
function StageBox({ value, label, help, tone = 'neutral' }) {
  const boxTone = tone === 'danger'
    ? 'border-danger/25 bg-danger/5'
    : 'border-border bg-card';
  const valueTone = tone === 'danger' ? 'text-danger' : 'text-foreground';
  const labelTone = tone === 'danger' ? 'text-danger/80' : 'text-muted-foreground';
  return (
    <div className={`relative z-10 flex min-w-[6.5rem] flex-col items-center gap-1 rounded-lg border px-4 py-2.5 shadow-sm ${boxTone}`}>
      <div className="flex items-center gap-1">
        <span className={`text-lg font-semibold tnum leading-none ${valueTone}`}>{value}</span>
        <InfoButton label={label} help={help} tone={tone} />
      </div>
      <span className={`text-xs ${labelTone}`}>{label}</span>
    </div>
  );
}

export default function ProcurementFlow({ counts }) {
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
          {/* Row 1 — grid-cols-5 fixes each node's center at 10/30/50/70/90%, so the spine line
              (behind the nodes) and the branch connectors below can share those exact x-positions
              without measuring anything. */}
          <div className="relative grid w-full grid-cols-5">
            <div className="absolute inset-x-[10%] top-1/2 h-px -translate-y-1/2 bg-border" />
            {STAGES.map(s => (
              <div key={s.key} className="flex items-center justify-center">
                <StageBox value={counts[s.key]} label={s.label} help={s.help} />
              </div>
            ))}
          </div>

          {/* Branch connectors — Sourcing(30) and PO issued(70) elbow inward to meet Selection's
              straight drop(50) at a shared merge point, then one trunk continues down into
              Cancelled. Three lines in, one out — same "several sources, one target" shape as an
              org chart. strokeLinejoin="round" is the whole trick for the rounded 90° corners. */}
          <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-8 w-full">
            <path d="M30,0 L30,16 L50,16" className="fill-none stroke-danger/30"
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M50,0 L50,16" className="fill-none stroke-danger/30"
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M70,0 L70,16 L50,16" className="fill-none stroke-danger/30"
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M50,16 L50,32" className="fill-none stroke-danger/30"
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>

          <StageBox value={counts.cancelled} label="Cancelled" help={CANCELLED_HELP} tone="danger" />
        </div>
        </div>
      </CardContent>
    </Card>
  );
}
