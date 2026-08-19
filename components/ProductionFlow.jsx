// components/ProductionFlow.jsx
'use client';

// Operations' Production pipeline glance — same node/spine shapes as ProcurementFlow.jsx/
// StoresFlow.jsx (copied, not abstracted, same precedent those files already state). Two real
// shapes layered, same as StoresFlow's:
//   1. A small "Sources" row — Work Orders (§5l, released/in_progress) and Ad hoc cards (created
//      directly, no Work Order behind them) — feeding into the main spine below.
//   2. The main spine: Job Card status — Pending → In Progress → Done — because the Job Card, not
//      the Work Order, is Production's real moving unit (same role Stores' Requests plays: the
//      Work Order only has 4 coarse states and sits upstream as a source). Rework branches off the
//      end as a terminal sibling to Done, same geometry precedent as ProcurementFlow's Cancelled
//      branch, simplified to one source since a rework card doesn't carry "which stage it came
//      from" the way a cancelled BOM item does.
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from './ui/card';
import { Button } from './ui/button';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';
import { InfoIcon, ChevronRightIcon, ChevronDownIcon } from 'lucide-react';

const SOURCES = [
  { key: 'workOrders', label: 'Active Work Orders', help: 'Work Orders currently released or in progress — each one generates a batch of Job Cards via its Process Route Card.' },
  { key: 'adhoc', label: 'Ad hoc cards', help: 'Open Job Cards created directly from the board, with no Work Order behind them.' },
];

const STAGES = [
  { key: 'pending', label: 'Pending', tone: 'plain', help: 'Job Cards raised but not yet started.' },
  { key: 'progress', label: 'In Progress', tone: 'warning', help: 'Job Cards with hours currently being logged against them.' },
  { key: 'done', label: 'Done', tone: 'received', help: 'Job Cards closed out with a real quantity done — this is what completes a milestone once every card against it reaches here.' },
];

const REWORK_HELP = 'Open rework cards — spawned from a failed Hydro Test or a rejected quantity, still Pending or In Progress. A rework card is its own Job Card, linked back to the original, not a status the original moved through.';

const TONE_CLASSES = {
  plain:    { box: 'bg-card border-border', value: 'text-foreground', label: 'text-muted-foreground', info: 'text-muted-foreground/70 hover:text-foreground' },
  warning:  { box: 'bg-warning-surface border-warning/20', value: 'text-warning', label: 'text-muted-foreground', info: 'text-warning/60 hover:text-warning' },
  received: { box: 'bg-success-surface border-success/20', value: 'text-success', label: 'text-muted-foreground', info: 'text-success/60 hover:text-success' },
  danger:   { box: 'bg-danger-surface border-danger/20', value: 'text-foreground', label: 'text-danger/90', info: 'text-danger/60 hover:text-danger' },
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

function StageBox({ value, label, help, tone = 'plain', small = false }) {
  const t = TONE_CLASSES[tone];
  return (
    <div className={`relative z-10 flex ${small ? 'min-w-[7.5rem]' : 'min-w-[6.5rem]'} flex-col items-center gap-1 rounded-lg border px-4 py-2.5 shadow-sm ${t.box}`}>
      <div className="flex items-center gap-1">
        <span className={`${small ? 'text-base' : 'text-lg'} font-semibold tnum leading-none ${t.value}`}>{value}</span>
        <InfoButton label={label} help={help} tone={tone} />
      </div>
      <span className={`text-xs text-center ${t.label}`}>{label}</span>
    </div>
  );
}

function FlowArrow({ atPercent }) {
  return (
    <ChevronRightIcon className="absolute top-1/2 z-10 size-3.5 -translate-x-1/2 -translate-y-1/2 text-muted-foreground/50"
      style={{ left: `${atPercent}%` }} />
  );
}

function StageRowVertical({ value, label, help, tone, isLast }) {
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
      </div>
    </div>
  );
}

function ProductionFlowVertical({ counts }) {
  return (
    <div className="flex flex-col">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Sources</p>
      {SOURCES.map((s, i) => (
        <StageRowVertical key={s.key} value={counts[s.key] || 0} label={s.label} help={s.help}
          tone="plain" isLast={i === SOURCES.length - 1} />
      ))}
      <p className="mb-2 mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">Job Card status</p>
      {STAGES.map((s, i) => (
        <StageRowVertical key={s.key} value={counts[s.key] || 0} label={s.label} help={s.help}
          tone={s.tone} isLast={i === STAGES.length - 1} />
      ))}
      <StageRowVertical value={counts.rework || 0} label="Rework (open)" help={REWORK_HELP} tone="danger" isLast />
    </div>
  );
}

export default function ProductionFlow({ counts }) {
  const nodeX = STAGES.map((_, i) => (i + 0.5) * (100 / STAGES.length));
  const midpoints = nodeX.slice(0, -1).map((x, i) => (x + nodeX[i + 1]) / 2);
  const firstX = nodeX[0];
  const lastX = nodeX[nodeX.length - 1];

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
      <CardContent>
        <div className="hidden sm:block">
          <div className="mx-auto flex min-w-[36rem] flex-col items-center gap-3">
            <div className="flex flex-wrap items-center justify-center gap-3">
              {SOURCES.map(s => <StageBox key={s.key} value={counts[s.key] || 0} label={s.label} help={s.help} tone="plain" small />)}
            </div>
            <ChevronDownIcon className="size-4 text-muted-foreground/50" />

            <div className="relative grid w-full" style={{ gridTemplateColumns: `repeat(${STAGES.length}, minmax(0, 1fr))` }}>
              <div className="absolute top-1/2 h-px -translate-y-1/2 bg-border" style={{ left: `${firstX}%`, right: `${100 - lastX}%` }} />
              {midpoints.map(x => <FlowArrow key={x} atPercent={x} />)}
              {STAGES.map(s => (
                <div key={s.key} className="flex items-center justify-center">
                  <StageBox value={counts[s.key] || 0} label={s.label} help={s.help} tone={s.tone} />
                </div>
              ))}
            </div>

            {/* Rework branches off Done — the one real exit-with-a-catch this pipeline has, same
                geometry precedent as ProcurementFlow's Cancelled branch, simplified to a single
                source since a rework card doesn't carry "which stage it came from." */}
            <div className="relative h-10 w-full">
              <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
                <path d={`M${lastX},0 L${lastX},40`} vectorEffect="non-scaling-stroke"
                  className="fill-none stroke-danger/30" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <ChevronDownIcon className="absolute bottom-0 z-10 size-3.5 -translate-x-1/2 translate-y-1/2 text-danger/50"
                style={{ left: `${lastX}%` }} />
            </div>
            <div className="relative h-16 w-full">
              <div className="absolute top-0 -translate-x-1/2" style={{ left: `${lastX}%` }}>
                <StageBox value={counts.rework || 0} label="Rework (open)" help={REWORK_HELP} tone="danger" small />
              </div>
            </div>
          </div>
        </div>
        <div className="sm:hidden">
          <ProductionFlowVertical counts={counts} />
        </div>
      </CardContent>
    </Card>
  );
}
