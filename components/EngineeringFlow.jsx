// components/EngineeringFlow.jsx
'use client';

// Operations' Engineering pipeline glance (SYSTEM.md §3d) — same node/spine shapes as SalesFlow.jsx/
// DesignFlow.jsx (copied, not abstracted, same precedent those files already state). Deliberately
// the smallest of all six flow diagrams: bom_change_notes.status (ECN) is Engineering's only real
// state machine — pending decides into approved/rejected, a 3-way split, not a multi-stage spine.
// BOM structure building, Where-Used, and Common/Uncommon are tree/classification views with no
// forward-progressing status column, so they're excluded here rather than turned into invented
// stages (see SYSTEM.md §3d's ground rule and §5o). Calc Sheets stays entirely DesignFlow's — this
// card only covers Engineering's own ECN data, on the shared /engineering tab.
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from './ui/card';
import { Button } from './ui/button';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';
import { InfoIcon, ChevronRightIcon } from 'lucide-react';

const STAGES = [
  { key: 'pending', label: 'Pending', tone: 'plain', help: 'Engineering Change Notes raised, awaiting a decision.' },
  { key: 'approved', label: 'Approved', tone: 'received', help: 'Decided and applied — the change is now the effective BOM revision.' },
  { key: 'rejected', label: 'Rejected', tone: 'danger', help: 'Decided against — no change applied.' },
];

const TONE_CLASSES = {
  plain:    { box: 'bg-card border-border', value: 'text-foreground', label: 'text-muted-foreground', info: 'text-muted-foreground/70 hover:text-foreground' },
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

function EngineeringFlowVertical({ counts }) {
  return (
    <div className="flex flex-col">
      {STAGES.map((s, i) => (
        <StageRowVertical key={s.key} value={counts[s.key] || 0} label={s.label} help={s.help}
          tone={s.tone} isLast={i === STAGES.length - 1} />
      ))}
    </div>
  );
}

export default function EngineeringFlow({ counts }) {
  const nodeX = STAGES.map((_, i) => (i + 0.5) * (100 / STAGES.length));
  const midpoints = nodeX.slice(0, -1).map((x, i) => (x + nodeX[i + 1]) / 2);
  const firstX = nodeX[0];
  const lastX = nodeX[nodeX.length - 1];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Engineering — Change Notes</CardTitle>
        <CardAction>
          <Button asChild size="sm" variant="outline">
            <Link href="/engineering">Open Engineering workspace →</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="hidden overflow-x-auto sm:block">
          <div className="mx-auto flex min-w-[24rem] flex-col items-center">
            <div className="relative grid w-full" style={{ gridTemplateColumns: `repeat(${STAGES.length}, minmax(0, 1fr))` }}>
              <div className="absolute top-1/2 h-px -translate-y-1/2 bg-border" style={{ left: `${firstX}%`, right: `${100 - lastX}%` }} />
              {midpoints.map(x => <FlowArrow key={x} atPercent={x} />)}
              {STAGES.map(s => (
                <div key={s.key} className="flex items-center justify-center">
                  <StageBox value={counts[s.key] || 0} label={s.label} help={s.help} tone={s.tone} />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="sm:hidden">
          <EngineeringFlowVertical counts={counts} />
        </div>
      </CardContent>
    </Card>
  );
}
