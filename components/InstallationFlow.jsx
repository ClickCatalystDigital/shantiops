// components/InstallationFlow.jsx
'use client';

// Operations' Installation pipeline glance (SYSTEM.md §3d) — same node/spine shapes as
// SalesFlow.jsx/DesignFlow.jsx (copied, not abstracted, same precedent those files already state).
// service_calls.status is a real enforced 5-state machine (app/api/service-calls/[id]/route.js's
// STATUSES array) — the only genuine sequential lifecycle Installation owns, so it's the spine.
// Service Contracts is deliberately NOT a second spine (same "Non-stage indicator chips" precedent
// as ProductionFlow's Route/Material/Labour row): a contract's real states are terminal outcomes
// (active -> expired/renewed/cancelled), not forward progress, and 'renewed' inserts a brand-new
// contract row instead of advancing the same one (§5n) — so it surfaces as small count chips above
// the spine instead of a fake second pipeline.
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from './ui/card';
import { Button } from './ui/button';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';
import { InfoIcon, ChevronRightIcon } from 'lucide-react';

const STAGES = [
  { key: 'open', label: 'Open', tone: 'plain', help: 'Raised, not yet assigned to an engineer.' },
  { key: 'assigned', label: 'Assigned', tone: 'enquiry', help: 'An engineer is assigned, work hasn’t started.' },
  { key: 'in_progress', label: 'In Progress', tone: 'warning', help: 'Being worked on at site.' },
  { key: 'resolved', label: 'Resolved', tone: 'comparison', help: 'The issue is fixed — awaiting closure/sign-off.' },
  { key: 'closed', label: 'Closed', tone: 'received', help: 'Closed out, with closure evidence on file.' },
];

const TONE_CLASSES = {
  plain:      { box: 'bg-card border-border', value: 'text-foreground', label: 'text-muted-foreground', info: 'text-muted-foreground/70 hover:text-foreground' },
  enquiry:    { box: 'bg-card border-border', value: 'text-muted-foreground', label: 'text-muted-foreground', info: 'text-muted-foreground/70 hover:text-foreground' },
  warning:    { box: 'bg-warning-surface border-warning/20', value: 'text-warning', label: 'text-muted-foreground', info: 'text-warning/60 hover:text-warning' },
  comparison: { box: 'bg-comparison-surface border-comparison/30', value: 'text-comparison', label: 'text-muted-foreground', info: 'text-comparison/70 hover:text-comparison' },
  received:   { box: 'bg-success-surface border-success/20', value: 'text-success', label: 'text-muted-foreground', info: 'text-success/60 hover:text-success' },
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

function InstallationFlowVertical({ counts }) {
  return (
    <div className="flex flex-col">
      {STAGES.map((s, i) => (
        <StageRowVertical key={s.key} value={counts[s.key] || 0} label={s.label} help={s.help}
          tone={s.tone} isLast={i === STAGES.length - 1} />
      ))}
    </div>
  );
}

function ContractChip({ label, value, help }) {
  return (
    <div className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs shadow-sm">
      <span className="font-semibold tnum text-foreground">{value}</span>
      <span className="text-muted-foreground">{label}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label={`What is ${label}?`} className="text-muted-foreground/70 hover:text-foreground">
            <InfoIcon className="size-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="center" className="w-64 text-xs text-muted-foreground">{help}</PopoverContent>
      </Popover>
    </div>
  );
}

export default function InstallationFlow({ counts }) {
  const nodeX = STAGES.map((_, i) => (i + 0.5) * (100 / STAGES.length));
  const midpoints = nodeX.slice(0, -1).map((x, i) => (x + nodeX[i + 1]) / 2);
  const firstX = nodeX[0];
  const lastX = nodeX[nodeX.length - 1];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Installation</CardTitle>
        <CardAction>
          <Button asChild size="sm" variant="outline">
            <Link href="/installation">Open Installation workspace →</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <ContractChip label="Contracts active" value={counts.contractsActive || 0} help="Service contracts currently active, not expiring within 30 days." />
          <ContractChip label="Expiring soon" value={counts.contractsExpiringSoon || 0} help="Active contracts ending within the next 30 days." />
          <ContractChip label="Renewed" value={counts.contractsRenewed || 0} help="Contracts renewed into a new contract row." />
          <ContractChip label="Expired / Cancelled" value={counts.contractsClosedOut || 0} help="Contracts that ended without renewal, or were cancelled." />
        </div>

        <div>
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Service calls</p>
          <div className="hidden overflow-x-auto sm:block">
            <div className="mx-auto flex min-w-[36rem] flex-col items-center">
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
            <InstallationFlowVertical counts={counts} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
