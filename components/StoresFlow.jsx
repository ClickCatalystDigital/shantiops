// components/StoresFlow.jsx
'use client';

// Operations' Stores pipeline glance — same node/spine shapes as SalesFlow.jsx/DesignFlow.jsx
// (copied, not abstracted, same precedent those files already state). Two real shapes layered:
//   1. A small "Sources" row — the two entry points the user asked for (SAS/Trade from Sales, BOM
//      Released from Design/Engineering) plus Stores' own Build stock requests, a third minor
//      source — feeding into the main spine below. Deliberately not drawn with literal merge
//      lines (the exact multi-source-converging SVG geometry ProcurementFlow's branch-connector
//      does in reverse) — a labeled row + a down-chevron says the same thing without the risk of
//      getting that geometry wrong.
//   2. The main spine: Requests → Stores Review → Reserved → In-Stock, plus one side terminal,
//      Received (via Procurement) — deliberately not the full Enquiry→...→Received chain,
//      ProcurementFlow already owns that pipeline; this only shows the one terminal Stores itself
//      cares about (matches the Notifications page: Stores hears about Received either way).
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from './ui/card';
import { Button } from './ui/button';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';
import { InfoIcon, ChevronRightIcon, ChevronDownIcon } from 'lucide-react';

const SOURCES = [
  { key: 'sas', label: 'SAS / Trade (Sales)', help: 'Open trade requests Sales has raised against their own Sale Orders.' },
  { key: 'bom', label: 'BOM Released (Design)', help: 'Open project material lines from a BOM import, a single item add, or a project-material PR line.' },
  { key: 'stock', label: 'Build Stock (Stores)', help: 'Open Build stock requests Stores raised on itself, to add new inventory.' },
];

const STAGES = [
  { key: 'requests', label: 'Requests', tone: 'plain', help: 'Every open line, from all three sources combined — not yet resolved one way or another.' },
  { key: 'storesReview', label: 'Stores Review', tone: 'warning', help: 'Manual mode’s gate: a fresh bom/SAS line stays invisible to Procurement until Stores clicks Reserve or Procure. Build stock requests skip this — Stores raising one on itself needs no second review.' },
  { key: 'reserved', label: 'Reserved', tone: 'ordered', help: 'Active reservations against existing inventory — committed but not yet handed out (Issue is the next step).' },
  { key: 'inStock', label: 'In-Stock', tone: 'received', help: 'Fulfilled from existing inventory via Reserve → Issue — never went through Procurement at all.' },
];

const TONE_CLASSES = {
  plain:    { box: 'bg-card border-border', value: 'text-foreground', label: 'text-muted-foreground', info: 'text-muted-foreground/70 hover:text-foreground' },
  warning:  { box: 'bg-warning-surface border-warning/20', value: 'text-warning', label: 'text-muted-foreground', info: 'text-warning/60 hover:text-warning' },
  ordered:  { box: 'bg-ordered-surface border-ordered/20', value: 'text-ordered', label: 'text-muted-foreground', info: 'text-ordered/70 hover:text-ordered' },
  received: { box: 'bg-success-surface border-success/20', value: 'text-success', label: 'text-muted-foreground', info: 'text-success/60 hover:text-success' },
};
const RECEIVED_HELP = 'Procured fresh through Procurement’s own Enquiry → ... → Received pipeline (see the Procurement flow above) instead of fulfilled from stock. Stores gets notified either way.';

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

function StoresFlowVertical({ counts }) {
  return (
    <div className="flex flex-col">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Sources</p>
      {SOURCES.map((s, i) => (
        <StageRowVertical key={s.key} value={counts[s.key] || 0} label={s.label} help={s.help}
          tone="plain" isLast={i === SOURCES.length - 1} />
      ))}
      <p className="mb-2 mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">Pipeline</p>
      {STAGES.map((s, i) => (
        <StageRowVertical key={s.key} value={counts[s.key] || 0} label={s.label} help={s.help}
          tone={s.tone} isLast={i === STAGES.length - 1} />
      ))}
      <StageRowVertical value={counts.received || 0} label="Received (via Procurement)" help={RECEIVED_HELP} tone="received" isLast />
    </div>
  );
}

export default function StoresFlow({ counts }) {
  const nodeX = STAGES.map((_, i) => (i + 0.5) * (100 / STAGES.length));
  const midpoints = nodeX.slice(0, -1).map((x, i) => (x + nodeX[i + 1]) / 2);
  const firstX = nodeX[0];
  const lastX = nodeX[nodeX.length - 1];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stores</CardTitle>
        <CardAction>
          <Button asChild size="sm" variant="outline">
            <Link href="/stores">Open Stores workspace →</Link>
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

            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span>Not reserved from stock? Continues through</span>
              <Link href="/procurement" className="underline hover:text-foreground">Procurement's own pipeline</Link>
              <span>to:</span>
            </div>
            <StageBox value={counts.received || 0} label="Received (via Procurement)" help={RECEIVED_HELP} tone="received" small />
          </div>
        </div>
        <div className="sm:hidden">
          <StoresFlowVertical counts={counts} />
        </div>
      </CardContent>
    </Card>
  );
}
