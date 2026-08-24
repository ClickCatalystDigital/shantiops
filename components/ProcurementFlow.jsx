// components/ProcurementFlow.jsx

'use client';

// Operations' Procurement pipeline glance (§2 of the redesign) — a small flowchart, every node the
// same neutral shape/border/size (no per-stage resizing or heavier boxes) so the shapes themselves
// stay boring — the signal is carried by the value number's color only. Uses the real D4 stage
// names now (§ Phase 5.0b polish, client-confirmed 2026-08-04) — Enquiry/Comparison/Ordered/
// Transit/Received — instead of the coarser Sourcing/Selection/PO-issued buckets, so this diagram,
// the Milestone Tracker (`PortfolioDelayTimeline.jsx`), and the Master BOM stage bar
// (`BomStageBar.jsx`) all read as one system: same names, same tones (Enquiry muted, Comparison
// pale-info, Ordered info, Transit warning, Received success).
//
// Cancelled's earlier "should be black and same as others" feedback (a full red border/text
// treatment looked heavier than the rest) is honored literally here — its value number stays
// neutral, only a faint wash + the label word + small per-source badges carry the signal. Those
// badges answer "which stage did a cancelled item actually come from" (D10: cancellation is only
// reachable from Enquiry/Comparison/Ordered/Transit, never Requests or Received) — cancelling
// never clears po_ref/selected_quote_id/the logged quotes, so lib/data.js's
// `deriveCancelledOrigin` can reconstruct it from those same signals after the fact
// (getProcurementFlowCounts's `cancelledFrom`).
//
// Redesigned five times: v1 was flat boxed tiles + arrow glyphs with Cancelled as an unconnected
// header badge. v2 was a dot-spine with dashed diagonal drop-lines. v3 gave Cancelled a full red
// border/number, sat it under Selection, and had no arrowheads. v4 was rectangle nodes with
// Cancelled under Closed and chevron arrowheads, still fully neutral. v5 (this version) fixed a
// real rendering bug found in v4: the branch-connector SVG uses `viewBox="0 0 100 32"
// preserveAspectRatio="none"` stretched non-uniformly to the diagram's actual pixel width (an
// ~11.8x horizontal scale at typical widths, 1x vertical) — SVG stroke width scales with that same
// transform, so v4's *vertical* connector segments rendered at roughly stroke-width × 11.8 ≈ 18px
// thick (confirmed via `getCTM()`), reading as fat overlapping blocks sitting on/under the stage
// boxes instead of thin lines. Fixed with `vectorEffect="non-scaling-stroke"` on every path, which
// keeps stroke width constant regardless of the surrounding non-uniform transform — the standard
// fix for exactly this SVG gotcha, no restructuring needed.
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from './ui/card';
import { Button } from './ui/button';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';
import { InfoIcon, ChevronRightIcon, ChevronDownIcon } from 'lucide-react';

// Tone per stage mirrors lib/bom-fields.mjs's STAGE_BAR_COLORS exactly, so this diagram, the
// Master BOM stage bar, and the Milestone Tracker share one color vocabulary. Requests sits before
// any of this even becomes a bom_item, so it stays plain/neutral — there's no D4 status to echo
// yet.
const STAGES = [
  // { key: 'requests', label: 'Requests', tone: 'plain', help: 'New-item and cancel requests from other departments, waiting for Procurement to accept them.' },
  { key: 'enquiry', label: 'Enquiry', tone: 'enquiry', help: 'Accepted items with no quote logged yet — Procurement still needs to contact suppliers.' },
  { key: 'comparison', label: 'Comparison', tone: 'comparison', help: 'At least one quote is in, but no supplier has been picked yet.' },
  { key: 'ordered', label: 'Ordered', tone: 'ordered', help: 'A supplier is selected and a purchase order has been drafted, not yet issued.' },
  { key: 'transit', label: 'Transit', tone: 'transit', help: 'The purchase order has been issued — on its way from the supplier.' },
  { key: 'received', label: 'Received', tone: 'received', help: 'Delivered and closed out (or received by Stores).' },
];
// Which STAGES (by key) a cancellation can come from — Requests and Received are excluded on
// purpose (cancelling never reaches this from either end, see CANCELLED_HELP).
const CANCEL_SOURCE_KEYS = ['enquiry', 'comparison', 'ordered', 'transit'];
const CANCELLED_HELP = 'Cancelled from Enquiry, Comparison, Ordered, or Transit — a request never reaches this from Requests or Received. The small red numbers below show how many came from each.';
const IN_STOCK_HELP = 'Fulfilled from existing inventory instead of being procured (D6) — always 0 until Group 6 ships the fulfil-from-stock action.';

// Restrained by design (client feedback, see file header): a faint background wash is the only
// per-tone box treatment — border/size/shape never changes. Cancelled's value number stays neutral
// (text-foreground, same as every other node) on purpose — only its label word, wash, and the
// small per-source badges below carry the "different outcome" signal.
const TONE_CLASSES = {
  plain:      { box: 'bg-card border-border', value: 'text-foreground', label: 'text-muted-foreground', info: 'text-muted-foreground/70 hover:text-foreground' },
  enquiry:    { box: 'bg-card border-border', value: 'text-muted-foreground', label: 'text-muted-foreground', info: 'text-muted-foreground/70 hover:text-foreground' },
  comparison: { box: 'bg-comparison-surface border-comparison/30', value: 'text-comparison', label: 'text-muted-foreground', info: 'text-comparison/70 hover:text-comparison' },
  ordered:    { box: 'bg-ordered-surface border-ordered/20', value: 'text-ordered', label: 'text-muted-foreground', info: 'text-ordered/70 hover:text-ordered' },
  transit:    { box: 'bg-warning-surface border-warning/20', value: 'text-warning', label: 'text-muted-foreground', info: 'text-warning/60 hover:text-warning' },
  received:   { box: 'bg-success-surface border-success/20', value: 'text-success', label: 'text-muted-foreground', info: 'text-success/60 hover:text-success' },
  in_stock:   { box: 'bg-info-surface border-info/20', value: 'text-info', label: 'text-muted-foreground', info: 'text-info/60 hover:text-info' },
  danger:     { box: 'bg-danger-surface border-danger/20', value: 'text-foreground', label: 'text-danger/90', info: 'text-danger/60 hover:text-danger' },
};

function InfoButton({ label, help, tone }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`What is ${label}?`} className={TONE_CLASSES[tone].info}>
          <InfoIcon className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-64 text-xs text-muted-foreground">{help}</PopoverContent>
    </Popover>
  );
}

// The one node shape, reused for every stage including Cancelled/In-Stock — same border, same
// size, regardless of tone. Only the value number's color + a faint background wash carry the
// signal, so a "hot" stage reads as a sibling of the others, not a heavier/alarming box.
function StageBox({ value, label, help, tone = 'plain' }) {
  const t = TONE_CLASSES[tone];
  return (
    <div className={`relative z-10 flex min-w-[6.5rem] flex-col items-center gap-1 rounded-lg border px-4 py-2.5 shadow-sm ${t.box}`}>
      <div className="flex items-center gap-1">
        <span className={`text-lg font-semibold tnum leading-none ${t.value}`}>{value}</span>
        <InfoButton label={label} help={help} tone={tone} />
      </div>
      <span className={`text-xs ${t.label}`}>{label}</span>
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

function StageRowVertical({ value, label, help, tone, isLast, cancelledCount }) {
  const t = TONE_CLASSES[tone];
  return (
    <div className="relative flex gap-3 pb-6 last:pb-0">
      {!isLast && <div className="absolute left-[11px] top-6 bottom-0 w-px bg-border" />}
      <div className={`z-10 flex size-6 shrink-0 items-center justify-center rounded-full border ${t.box}`}>
        <span className={`text-[10px] font-semibold tnum ${t.value}`}>{value}</span>
      </div>
      <div className="flex flex-1 items-center gap-2 pt-0.5">
        <span className={`text-sm ${t.label}`}>{label}</span>
        <InfoButton label={label} help={help} tone={tone} />
        {cancelledCount > 0 && (
          <span className="rounded-full bg-danger/10 px-1.5 py-0 text-[10px] font-semibold tnum text-danger">
            {cancelledCount} cancelled
          </span>
        )}
      </div>
    </div>
  );
}

function ProcurementFlowVertical({ counts }) {
  const cancelledByKey = Object.fromEntries(
    CANCEL_SOURCE_KEYS.map(key => [key, counts.cancelledFrom?.[key] || 0])
  );
  return (
    <div className="flex flex-col">
      {STAGES.map((s, i) => (
        <StageRowVertical key={s.key} value={counts[s.key]} label={s.label} help={s.help}
          tone={s.tone} isLast={i === STAGES.length - 1} cancelledCount={cancelledByKey[s.key] || 0} />
      ))}
      <div className="mt-2 grid grid-cols-2 gap-3 border-t border-border pt-4">
        <div className="flex items-center gap-2">
          <div className={`flex size-6 shrink-0 items-center justify-center rounded-full border ${TONE_CLASSES.in_stock.box}`}>
            <span className={`text-[10px] font-semibold tnum ${TONE_CLASSES.in_stock.value}`}>{counts.in_stock}</span>
          </div>
          <span className={`text-sm ${TONE_CLASSES.in_stock.label}`}>In-Stock</span>
          <InfoButton label="In-Stock" help={IN_STOCK_HELP} tone="in_stock" />
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex size-6 shrink-0 items-center justify-center rounded-full border ${TONE_CLASSES.danger.box}`}>
            <span className={`text-[10px] font-semibold tnum ${TONE_CLASSES.danger.value}`}>{counts.cancelled}</span>
          </div>
          <span className={`text-sm ${TONE_CLASSES.danger.label}`}>Cancelled</span>
          <InfoButton label="Cancelled" help={CANCELLED_HELP} tone="danger" />
        </div>
      </div>
    </div>
  );
}

export default function ProcurementFlow({ counts, bare = false }) {
  // Evenly spaced column centers for the N main-spine nodes — generalized so the layout doesn't
  // need a hand-maintained position per stage key.
  const nodeX = STAGES.map((_, i) => (i + 0.5) * (100 / STAGES.length));
  const midpoints = nodeX.slice(0, -1).map((x, i) => (x + nodeX[i + 1]) / 2);
  const receivedX = nodeX[nodeX.length - 1];
  const requestsX = nodeX[0];
  const cancelSources = CANCEL_SOURCE_KEYS.map(key => ({
    key, x: nodeX[STAGES.findIndex(s => s.key === key)], count: counts.cancelledFrom?.[key] || 0,
  }));

  // Shared between the standalone Card (default) and the bare content used inside
  // OperationsCard's Row 1 (Operations page unified card).
  const content = (
    <>
        {/* Nodes have a min-width (StageBox) that would otherwise get crushed into truncated
            labels on a narrow screen once 6 of them share one row — scroll horizontally instead
            of squeezing, same trade-off any dashboard makes for a wide stat row on mobile. */}
        <div className="hidden overflow-x-auto sm:block">
          {/* gap-2 between the three rows (spine / connectors / terminal row) matters: the boxes
              and the connector lines are geometrically adjacent, never actually overlapping (a box
              row's bottom edge and the connector strip's top edge sit at the exact same y with no
              built-in spacing) — but flush-touching at zero gap reads visually as the line piercing
              the box, since there's no whitespace to signal "these are two separate layers." The
              gap makes the boxes unambiguously float above the lines instead of merging into them. */}
          <div className="mx-auto flex min-w-[42rem] flex-col items-center">
            {/* Row 1 — nodeX fixes each node's center at an even 1/(2N), 3/(2N)... spacing, so the
                spine arrows and the branch connectors below can share those exact x-positions
                without measuring anything. */}
            <div className="relative grid w-full" style={{ gridTemplateColumns: `repeat(${STAGES.length}, minmax(0, 1fr))` }}>
              <div className="absolute top-1/2 h-px -translate-y-1/2 bg-border" style={{ left: `${requestsX}%`, right: `${100 - receivedX}%` }} />
              {midpoints.map(x => <FlowArrow key={x} atPercent={x} />)}
              {STAGES.map(s => (
                <div key={s.key} className="flex items-center justify-center">
                  <StageBox value={counts[s.key]} label={s.label} help={s.help} tone={s.tone} />
                </div>
              ))}
            </div>

            {/* Branch connectors — Enquiry/Comparison/Ordered/Transit all elbow over to Received's
                column, the same one Cancelled sits in below, then one shared trunk drops into
                Cancelled. Right-aligning Cancelled under Received (both terminal states) reads as
                one flow continuing right, not a branch off the middle. A small badge near the top
                of each source's vertical drop shows how many of *that* stage's cancellations
                happened — only rendered when non-zero, so a stage that's never lost an item adds
                no clutter. `vectorEffect="non-scaling-stroke"` is what keeps every stroke a real
                1.5px regardless of the SVG's non-uniform x/y scale (see file header). */}
            <div className="relative h-12 w-full">
              <svg viewBox="0 0 100 48" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
                {cancelSources.map(({ key, x }) => (
                  <path key={key} d={`M${x},0 L${x},24 L${receivedX},24`} vectorEffect="non-scaling-stroke"
                    className="fill-none stroke-danger/30" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                ))}
                <path d={`M${receivedX},24 L${receivedX},48`} vectorEffect="non-scaling-stroke"
                  className="fill-none stroke-danger/30" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {cancelSources.filter(s => s.count > 0).map(({ key, x, count }) => (
                <span key={key}
                  className="absolute top-1.5 z-10 -translate-x-1/2 rounded-full bg-danger/10 px-1.5 py-0 text-[10px] font-semibold tnum leading-[1.15rem] text-danger"
                  style={{ left: `${x}%` }} title={`${count} cancelled from ${STAGES.find(s => s.key === key).label}`}>
                  {count}
                </span>
              ))}
              <ChevronDownIcon className="absolute bottom-0 z-10 size-3.5 -translate-x-1/2 translate-y-1/2 text-danger/50"
                style={{ left: `${receivedX}%` }} />
            </div>

            <div className="relative h-20 w-full">
              <div className="absolute top-0 -translate-x-1/2" style={{ left: `${requestsX}%` }}>
                <StageBox value={counts.in_stock} label="In-Stock" help={IN_STOCK_HELP} tone="in_stock" />
              </div>
              <div className="absolute top-0 -translate-x-1/2" style={{ left: `${receivedX}%` }}>
                <StageBox value={counts.cancelled} label="Cancelled" help={CANCELLED_HELP} tone="danger" />
              </div>
            </div>
          </div>
        </div>
        <div className="sm:hidden">
          <ProcurementFlowVertical counts={counts} />
        </div>
    </>
  );

  if (bare) return content;

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
      <CardContent>{content}</CardContent>
    </Card>
  );
}
