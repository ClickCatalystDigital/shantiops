// components/QcFlow.jsx
'use client';

// Operations' QC pipeline glance (SYSTEM.md §3d) — same node/spine shapes as ProcurementFlow.jsx/
// StoresFlow.jsx (copied, not abstracted, same precedent those files already state). The statutory-
// document pipeline (test_certificates -> certificate_projects allocation -> qc_document_parts
// linking -> finalized) is the one QC pipeline with real sequential depth, read cross-project
// (matches /qc's own scope, not project-scoped like QcPanel). qc_records (hydro test/NDE/MTC
// results) is a flat pending/pass/fail tally, not a multi-stage lifecycle — it rides as a secondary
// row, same precedent as ProductionFlow's secondary Job Card spine, instead of being stretched into
// fake "stages" on the main one.
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from './ui/card';
import { Button } from './ui/button';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';
import { InfoIcon, ChevronRightIcon } from 'lucide-react';

const STAGES = [
  { key: 'uploaded', label: 'Uploaded', tone: 'plain', help: 'Test certificates in the bank, not yet allocated to any project.' },
  { key: 'allocated', label: 'Allocated', tone: 'enquiry', help: 'Certificates used on at least one project’s statutory document.' },
  { key: 'inProgress', label: 'Documents In Progress', tone: 'warning', help: 'Statutory documents (Form IV A etc) with at least one part still unlinked to a certificate.' },
  { key: 'finalized', label: 'Finalized', tone: 'received', help: 'Every part on the document is linked to a certificate — ready to preview/print.' },
];

const SECONDARY_STAGES = [
  { key: 'recordsPending', label: 'Pending', tone: 'plain', help: 'QC test records (hydro test, NDE, MTC, freeform) awaiting a result.' },
  { key: 'recordsPassed', label: 'Passed', tone: 'received', help: 'QC test records that passed.' },
  { key: 'recordsFailed', label: 'Failed', tone: 'danger', help: 'QC test records that failed.' },
];

const TONE_CLASSES = {
  plain:    { box: 'bg-card border-border', value: 'text-foreground', label: 'text-muted-foreground', info: 'text-muted-foreground/70 hover:text-foreground' },
  enquiry:  { box: 'bg-card border-border', value: 'text-muted-foreground', label: 'text-muted-foreground', info: 'text-muted-foreground/70 hover:text-foreground' },
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

function StageBox({ value, label, help, tone = 'plain' }) {
  const t = TONE_CLASSES[tone];
  return (
    <div className={`relative z-10 flex min-w-[6.5rem] flex-col items-center gap-1 rounded-lg border px-4 py-2.5 shadow-sm ${t.box}`}>
      <div className="flex items-center gap-1">
        <span className={`text-lg font-semibold tnum leading-none ${t.value}`}>{value}</span>
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

function StagesVertical({ stages, counts }) {
  return (
    <div className="flex flex-col">
      {stages.map((s, i) => (
        <StageRowVertical key={s.key} value={counts[s.key] || 0} label={s.label} help={s.help}
          tone={s.tone} isLast={i === stages.length - 1} />
      ))}
    </div>
  );
}

function Spine({ stages, counts, minWidth }) {
  const nodeX = stages.map((_, i) => (i + 0.5) * (100 / stages.length));
  const midpoints = nodeX.slice(0, -1).map((x, i) => (x + nodeX[i + 1]) / 2);
  const firstX = nodeX[0];
  const lastX = nodeX[nodeX.length - 1];
  return (
    <div className="hidden overflow-x-auto sm:block">
      <div className={`mx-auto flex ${minWidth} flex-col items-center`}>
        <div className="relative grid w-full" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
          <div className="absolute top-1/2 h-px -translate-y-1/2 bg-border" style={{ left: `${firstX}%`, right: `${100 - lastX}%` }} />
          {midpoints.map(x => <FlowArrow key={x} atPercent={x} />)}
          {stages.map(s => (
            <div key={s.key} className="flex items-center justify-center">
              <StageBox value={counts[s.key] || 0} label={s.label} help={s.help} tone={s.tone} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function QcFlow({ counts }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>QC</CardTitle>
        <CardAction>
          <Button asChild size="sm" variant="outline">
            <Link href="/qc">Open QC workspace →</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div>
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Statutory documents</p>
          <Spine stages={STAGES} counts={counts} minWidth="min-w-[40rem]" />
          <div className="sm:hidden">
            <StagesVertical stages={STAGES} counts={counts} />
          </div>
        </div>

        <div className="border-t pt-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Test records (secondary)</p>
          <Spine stages={SECONDARY_STAGES} counts={counts} minWidth="min-w-[24rem]" />
          <div className="sm:hidden">
            <StagesVertical stages={SECONDARY_STAGES} counts={counts} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
