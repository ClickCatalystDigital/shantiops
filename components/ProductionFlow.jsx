// components/ProductionFlow.jsx
'use client';

// Operations' Production pipeline glance — same node/spine shapes as ProcurementFlow.jsx/
// StoresFlow.jsx (copied, not abstracted, same precedent those files already state). Two spines:
//   1. The primary lifecycle (2026-08-19 upgrade) — the real factory-wide, aggregate WO-driven
//      flow: BOM Released → Work Order Created → Route/Operations → Work Order Released →
//      Job Cards → Material Issued/Cut → Production Execution → QC/Testing/Rework → Job Cards
//      Completed → Work Order Completed. Every count and every stage's `href` comes straight from
//      getProductionFlowCounts() (lib/data.js) — each stage links into the real filtered view
//      behind its number (Work Orders' own status filter, the Job Card board, or the BOM tab), so
//      a head can click through to the actual projects/Work Orders a count represents instead of
//      just reading a number.
//   2. The secondary Job Card status spine (unchanged from the original pipeline) — every Job
//      Card, work-order-linked or ad hoc, by status — since ad hoc cards skip the lifecycle above
//      entirely and still need to be visible somewhere.
// Forecast/Costing/Change Notes are supporting indicators (small linked chips), not sequence
// nodes — Work Order Costing and Change Notes are inherently per-Work-Order, not a single
// aggregate stage, and Forecast is a look-ahead, not a stage anything sits "in."
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from './ui/card';
import { Button } from './ui/button';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';
import { InfoIcon, ChevronRightIcon, ChevronDownIcon } from 'lucide-react';

const LIFECYCLE = [
  { key: 'bomReleased', label: 'BOM Released', tone: 'plain', help: 'Active projects with a released BOM baseline — the precondition for raising a Work Order against an order.' },
  { key: 'workOrderCreated', label: 'Work Order Created', tone: 'plain', help: 'Work Orders in draft — created, not yet released.' },
  { key: 'route', label: 'Route/Operations', tone: 'enquiry', help: 'Draft Work Orders whose Process Route Card already has at least one step defined.' },
  { key: 'workOrderReleased', label: 'Work Order Released', tone: 'comparison', help: 'Work Orders released — the route and materials are locked as the baseline.' },
  { key: 'jobCards', label: 'Job Cards', tone: 'ordered', help: 'Work-Order-generated Job Cards not yet started.' },
  { key: 'materialIssued', label: 'Material Issued/Cut', tone: 'ordered', help: 'Material issued from Stores to WIP, plus plate/section pieces actually cut, across active projects.' },
  { key: 'execution', label: 'Production Execution', tone: 'warning', help: 'Work Orders in progress — hours currently being logged against their Job Cards.' },
  { key: 'qc', label: 'QC/Testing/Rework', tone: 'warning', help: 'Open Hydro Tests awaiting a result, plus open rework cards spawned from a failed test or rejected quantity.' },
  { key: 'jobCardsCompleted', label: 'Job Cards Completed', tone: 'received', help: 'Work-Order-generated Job Cards marked Done.' },
  { key: 'workOrderCompleted', label: 'Work Order Completed', tone: 'received', help: 'Work Orders marked Completed.' },
];

const SECONDARY_STAGES = [
  { key: 'pending', label: 'Pending', tone: 'plain', help: 'Job Cards raised but not yet started.' },
  { key: 'progress', label: 'In Progress', tone: 'warning', help: 'Job Cards with hours currently being logged against them.' },
  { key: 'done', label: 'Done', tone: 'received', help: 'Job Cards closed out with a real quantity done — this is what completes a milestone once every card against it reaches here.' },
];
const REWORK_HELP = 'Open rework cards — spawned from a failed Hydro Test or a rejected quantity, still Pending or In Progress. A rework card is its own Job Card, linked back to the original, not a status the original moved through.';

const TONE_CLASSES = {
  plain:      { box: 'bg-card border-border', value: 'text-foreground', label: 'text-muted-foreground', info: 'text-muted-foreground/70 hover:text-foreground' },
  enquiry:    { box: 'bg-card border-border', value: 'text-muted-foreground', label: 'text-muted-foreground', info: 'text-muted-foreground/70 hover:text-foreground' },
  comparison: { box: 'bg-comparison-surface border-comparison/30', value: 'text-comparison', label: 'text-muted-foreground', info: 'text-comparison/70 hover:text-comparison' },
  ordered:    { box: 'bg-ordered-surface border-ordered/20', value: 'text-ordered', label: 'text-muted-foreground', info: 'text-ordered/70 hover:text-ordered' },
  warning:    { box: 'bg-warning-surface border-warning/20', value: 'text-warning', label: 'text-muted-foreground', info: 'text-warning/60 hover:text-warning' },
  received:   { box: 'bg-success-surface border-success/20', value: 'text-success', label: 'text-muted-foreground', info: 'text-success/60 hover:text-success' },
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

// href turns the node into a real drill-through link. The box itself stays a plain div (not an
// anchor) — InfoButton renders an actual <button> for its Popover trigger, and nesting a button
// inside an <a> is invalid HTML (and fights click handling); the value and label individually
// become links instead, sitting beside the info button rather than wrapping it.
function StageBox({ value, label, help, tone = 'plain', small = false, href }) {
  const t = TONE_CLASSES[tone];
  const valueEl = <span className={`${small ? 'text-base' : 'text-lg'} font-semibold tnum leading-none ${t.value}`}>{value}</span>;
  const labelEl = <span className={`text-xs text-center ${t.label}`}>{label}</span>;
  return (
    <div className={`relative z-10 flex ${small ? 'min-w-[7.5rem]' : 'min-w-[6.5rem]'} flex-col items-center gap-1 rounded-lg border px-4 py-2.5 shadow-sm ${t.box} ${href ? 'transition-colors hover:border-primary/50 hover:shadow-md' : ''}`}>
      <div className="flex items-center gap-1">
        {href ? <Link href={href}>{valueEl}</Link> : valueEl}
        <InfoButton label={label} help={help} tone={tone} />
      </div>
      {href ? <Link href={href} className="hover:underline">{labelEl}</Link> : labelEl}
    </div>
  );
}

function FlowArrow({ atPercent }) {
  return (
    <ChevronRightIcon className="absolute top-1/2 z-10 size-3.5 -translate-x-1/2 -translate-y-1/2 text-muted-foreground/50"
      style={{ left: `${atPercent}%` }} />
  );
}

function StageRowVertical({ value, label, help, tone, isLast, href }) {
  const t = TONE_CLASSES[tone];
  const Wrapper = href ? Link : 'div';
  return (
    <div className="relative flex gap-3 pb-6 last:pb-0">
      {!isLast && <div className="absolute left-[11px] top-6 bottom-0 w-px bg-border" />}
      <Wrapper href={href} className={`z-10 flex size-6 shrink-0 items-center justify-center rounded-full border ${t.box}`}>
        <span className={`text-[10px] font-semibold tnum ${t.value}`}>{value}</span>
      </Wrapper>
      <div className="flex flex-1 items-center gap-2 pt-0.5">
        <span className={`text-sm ${t.label}`}>{href ? <Link href={href} className="hover:underline">{label}</Link> : label}</span>
        <InfoButton label={label} help={help} tone={tone} />
      </div>
    </div>
  );
}

// The info popover sits outside the Link (not nested inside it) — an interactive trigger nested
// inside an anchor is exactly the a11y/click-conflict trap StageBox's own InfoButton avoids by
// living beside its box's Link, not inside one.
function IndicatorChip({ label, value, help, href }) {
  return (
    <div className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs shadow-sm">
      <Link href={href} className="flex items-center gap-2 hover:underline">
        {value != null && <span className="font-semibold tnum text-foreground">{value}</span>}
        <span className="text-muted-foreground">{label}</span>
      </Link>
      {help && (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" aria-label={`What is ${label}?`} className="text-muted-foreground/70 hover:text-foreground">
              <InfoIcon className="size-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="center" className="w-64 text-xs text-muted-foreground">{help}</PopoverContent>
        </Popover>
      )}
    </div>
  );
}

export default function ProductionFlow({ counts }) {
  const lc = counts.lifecycle || {};
  const secNodeX = SECONDARY_STAGES.map((_, i) => (i + 0.5) * (100 / SECONDARY_STAGES.length));
  const secMidpoints = secNodeX.slice(0, -1).map((x, i) => (x + secNodeX[i + 1]) / 2);
  const secFirstX = secNodeX[0];
  const secLastX = secNodeX[secNodeX.length - 1];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Production</CardTitle>
        <CardAction>
          <Button asChild size="sm" variant="outline">
            <Link href="/production/workers">Open Job Card workspace →</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {/* Supporting control/intelligence indicators — not sequence nodes, see file header. */}
        <div className="flex flex-wrap items-center gap-2">
          <IndicatorChip label="Forecast" href="/production/workers?tab=forecast"
            help="Upcoming Work Orders, workstation load, and outstanding material demand for the next 30 days." />
          <IndicatorChip label="Costing" href="/production/workers?tab=workorders"
            help="Planned vs. actual material and labor — open a Work Order and Load Costing." />
          <IndicatorChip label="Change Notes" value={counts.changeNotes ?? 0} href="/production/workers?tab=workorders"
            help="Controlled baseline changes logged against released Work Orders (quantity, dates, product description)." />
        </div>

        <div>
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Production lifecycle</p>
          {/* Wraps left-to-right at any width instead of horizontal scroll — each box+arrow pair
              is one flex item, so a box that no longer fits drops to the next row on its own and
              the arrow travels with it, same left-to-right reading order continued. */}
          <div className="flex flex-wrap items-center gap-y-4">
            {LIFECYCLE.map((s, i) => (
              <div key={s.key} className="flex items-center">
                <StageBox value={lc[s.key]?.value ?? 0} label={s.label} help={s.help} tone={s.tone} href={lc[s.key]?.href} />
                {i < LIFECYCLE.length - 1 && <ChevronRightIcon className="mx-1.5 size-4 shrink-0 text-muted-foreground/40" />}
              </div>
            ))}
          </div>
        </div>

        {/* Secondary metric — every Job Card by status, work-order-linked or ad hoc (unchanged
            from the original pipeline; ad hoc cards skip the lifecycle above entirely). */}
        <div className="border-t pt-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Job Card status (secondary)</p>
          <div className="hidden overflow-x-auto sm:block">
            <div className="mx-auto flex min-w-[36rem] flex-col items-center gap-3">
              <div className="relative grid w-full" style={{ gridTemplateColumns: `repeat(${SECONDARY_STAGES.length}, minmax(0, 1fr))` }}>
                <div className="absolute top-1/2 h-px -translate-y-1/2 bg-border" style={{ left: `${secFirstX}%`, right: `${100 - secLastX}%` }} />
                {secMidpoints.map(x => <FlowArrow key={x} atPercent={x} />)}
                {SECONDARY_STAGES.map(s => (
                  <div key={s.key} className="flex items-center justify-center">
                    <StageBox value={counts[s.key] || 0} label={s.label} help={s.help} tone={s.tone} href="/production/workers?tab=jobcards" />
                  </div>
                ))}
              </div>
              <div className="relative h-10 w-full">
                <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
                  <path d={`M${secLastX},0 L${secLastX},40`} vectorEffect="non-scaling-stroke"
                    className="fill-none stroke-danger/30" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <ChevronDownIcon className="absolute bottom-0 z-10 size-3.5 -translate-x-1/2 translate-y-1/2 text-danger/50"
                  style={{ left: `${secLastX}%` }} />
              </div>
              <div className="relative h-16 w-full">
                <div className="absolute top-0 -translate-x-1/2" style={{ left: `${secLastX}%` }}>
                  <StageBox value={counts.rework || 0} label="Rework (open)" help={REWORK_HELP} tone="danger" small href="/production/workers?tab=jobcards" />
                </div>
              </div>
            </div>
          </div>
          <div className="sm:hidden">
            <div className="flex flex-col">
              {SECONDARY_STAGES.map((s, i) => (
                <StageRowVertical key={s.key} value={counts[s.key] || 0} label={s.label} help={s.help}
                  tone={s.tone} isLast={false} href="/production/workers?tab=jobcards" />
              ))}
              <StageRowVertical value={counts.rework || 0} label="Rework (open)" help={REWORK_HELP} tone="danger" isLast href="/production/workers?tab=jobcards" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
