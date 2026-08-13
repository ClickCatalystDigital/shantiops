// // components/DesignFlow.jsx
// 'use client';

// // Operations' Design pipeline glance — CALC-CHANGES2.md §E, mirrored off ProcurementFlow.jsx's
// // node/spine/tone shapes (copied, not abstracted — that file doesn't export its pieces, and a
// // shared abstraction over two five-ish-stage pipelines isn't worth it for the size of either).
// // Simpler than Procurement's: Design has no cancellation/terminal-exit concept, so this is a
// // straight spine, no branch connectors or terminal row.
// import Link from 'next/link';
// import { Card, CardContent, CardHeader, CardTitle, CardAction } from './ui/card';
// import { Button } from './ui/button';
// import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';
// import { InfoIcon, ChevronRightIcon } from 'lucide-react';

// const STAGES = [
//   { key: 'concept', label: 'Concept', tone: 'plain', help: 'A calc sheet exists but has no saved snapshot yet — inputs are still being worked out.' },
//   { key: 'calculation', label: 'Calculation', tone: 'enquiry', help: 'At least one snapshot has been saved, but the methodology it used isn’t fully approved yet.' },
//   { key: 'review', label: 'Review', tone: 'comparison', help: 'Every formula the latest snapshot used is approved, but a drawing on this project is still in progress or under review.' },
//   { key: 'approved', label: 'Approved', tone: 'ordered', help: 'Calculations are on approved methodology and every drawing is approved.' },
//   { key: 'released', label: 'Released', tone: 'received', help: 'At least one drawing is marked As-built — released to the shop floor.' },
// ];

// const TONE_CLASSES = {
//   plain:       { box: 'bg-card border-border', value: 'text-foreground', label: 'text-muted-foreground', info: 'text-muted-foreground/70 hover:text-foreground' },
//   enquiry:     { box: 'bg-card border-border', value: 'text-muted-foreground', label: 'text-muted-foreground', info: 'text-muted-foreground/70 hover:text-foreground' },
//   comparison:  { box: 'bg-comparison-surface border-comparison/30', value: 'text-comparison', label: 'text-muted-foreground', info: 'text-comparison/70 hover:text-comparison' },
//   ordered:     { box: 'bg-ordered-surface border-ordered/20', value: 'text-ordered', label: 'text-muted-foreground', info: 'text-ordered/70 hover:text-ordered' },
//   received:    { box: 'bg-success-surface border-success/20', value: 'text-success', label: 'text-muted-foreground', info: 'text-success/60 hover:text-success' },
// };

// function InfoButton({ label, help, tone }) {
//   return (
//     <Popover>
//       <PopoverTrigger asChild>
//         <button type="button" aria-label={`What is ${label}?`} className={TONE_CLASSES[tone].info}>
//           <InfoIcon className="size-3" />
//         </button>
//       </PopoverTrigger>
//       <PopoverContent align="center" className="w-64 text-xs text-muted-foreground">{help}</PopoverContent>
//     </Popover>
//   );
// }

// function StageBox({ value, label, help, tone = 'plain' }) {
//   const t = TONE_CLASSES[tone];
//   return (
//     <div className={`relative z-10 flex min-w-[6.5rem] flex-col items-center gap-1 rounded-lg border px-4 py-2.5 shadow-sm ${t.box}`}>
//       <div className="flex items-center gap-1">
//         <span className={`text-lg font-semibold tnum leading-none ${t.value}`}>{value}</span>
//         <InfoButton label={label} help={help} tone={tone} />
//       </div>
//       <span className={`text-xs ${t.label}`}>{label}</span>
//     </div>
//   );
// }

// function FlowArrow({ atPercent }) {
//   return (
//     <ChevronRightIcon className="absolute top-1/2 z-10 size-3.5 -translate-x-1/2 -translate-y-1/2 text-muted-foreground/50"
//       style={{ left: `${atPercent}%` }} />
//   );
// }

// function StageRowVertical({ value, label, help, tone, isLast }) {
//   const t = TONE_CLASSES[tone];
//   return (
//     <div className="relative flex gap-3 pb-6 last:pb-0">
//       {!isLast && <div className="absolute left-[11px] top-6 bottom-0 w-px bg-border" />}
//       <div className={`z-10 flex size-6 shrink-0 items-center justify-center rounded-full border ${t.box}`}>
//         <span className={`text-[10px] font-semibold tnum ${t.value}`}>{value}</span>
//       </div>
//       <div className="flex flex-1 items-center gap-2 pt-0.5">
//         <span className={`text-sm ${t.label}`}>{label}</span>
//         <InfoButton label={label} help={help} tone={tone} />
//       </div>
//     </div>
//   );
// }

// function DesignFlowVertical({ counts }) {
//   return (
//     <div className="flex flex-col">
//       {STAGES.map((s, i) => (
//         <StageRowVertical key={s.key} value={counts[s.key] || 0} label={s.label} help={s.help} tone={s.tone} isLast={i === STAGES.length - 1} />
//       ))}
//     </div>
//   );
// }

// export default function DesignFlow({ counts, bare = false }) {
//   const nodeX = STAGES.map((_, i) => (i + 0.5) * (100 / STAGES.length));
//   const midpoints = nodeX.slice(0, -1).map((x, i) => (x + nodeX[i + 1]) / 2);
//   const firstX = nodeX[0];
//   const lastX = nodeX[nodeX.length - 1];

//   // Shared between the standalone Card (default) and the bare content used inside
//   // DesignOperationsCard's Row 1 left column (Operations page unified card).
//   const content = (
//     <>
//       {/* w-full + a generous max-width (not a fixed/centered min-width) so this actually stretches
//           to fill its row on wide screens instead of sitting centered with dead space on both
//           sides — the old min-w-[36rem]/items-center combo was tuned for sharing a 50% column,
//           not owning a full row. overflow-x-auto still protects narrow viewports below ~36rem. */}
//       <div className="hidden overflow-x-auto sm:block">
//         <div className="mx-auto w-full max-w-4xl">
//           <div className="relative grid w-full" style={{ gridTemplateColumns: `repeat(${STAGES.length}, minmax(0, 1fr))` }}>
//             <div className="absolute top-1/2 h-px -translate-y-1/2 bg-border" style={{ left: `${firstX}%`, right: `${100 - lastX}%` }} />
//             {midpoints.map((x) => <FlowArrow key={x} atPercent={x} />)}
//               {STAGES.map((s) => (
//                 <div key={s.key} className="flex items-center justify-center">
//                   <StageBox value={counts[s.key] || 0} label={s.label} help={s.help} tone={s.tone} />
//                 </div>
//               ))}
//           </div>
//         </div>
//       </div>
//       <div className="sm:hidden">
//         <DesignFlowVertical counts={counts} />
//       </div>
//     </>
//   );

//   if (bare) return content;

//   return (
//     <Card>
//       <CardHeader>
//         <CardTitle>Design</CardTitle>
//         <CardAction>
//           <Button asChild size="sm" variant="outline">
//             <Link href="/calc">Open Calc Sheets →</Link>
//           </Button>
//         </CardAction>
//       </CardHeader>
//       <CardContent>{content}</CardContent>
//     </Card>
//   );
// }




// components/DesignFlow.jsx
'use client';

// Operations' Design pipeline glance — CALC-CHANGES2.md §E, mirrored off ProcurementFlow.jsx's
// node/spine/tone shapes (copied, not abstracted — that file doesn't export its pieces, and a
// shared abstraction over two five-ish-stage pipelines isn't worth it for the size of either).
// Simpler than Procurement's: Design has no cancellation/terminal-exit concept, so this is a
// straight spine, no branch connectors or terminal row.
//
// Two render modes, chosen by which prop is passed:
//  - counts (Operations, cross-project): each stage box shows its per-stage total, plain — the
//    original/only mode before DESIGN-OPS-REDESIGN.md's Project page pass.
//  - activeStage (Project page, single-project): no numbers — stages before the project's current
//    one show a check, the current one is ring-highlighted, later ones are dimmed. Passing
//    neither renders every box in its plain/undone state.
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from './ui/card';
import { Button } from './ui/button';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';
import { InfoIcon, ChevronRightIcon, CheckIcon } from 'lucide-react';

const STAGES = [
  { key: 'concept', label: 'Concept', tone: 'plain', help: 'A calc sheet exists but has no saved snapshot yet — inputs are still being worked out.' },
  { key: 'calculation', label: 'Calculation', tone: 'enquiry', help: 'At least one snapshot has been saved, but the methodology it used isn’t fully approved yet.' },
  { key: 'review', label: 'Review', tone: 'comparison', help: 'Every formula the latest snapshot used is approved, but a drawing on this project is still in progress or under review.' },
  { key: 'approved', label: 'Approved', tone: 'ordered', help: 'Calculations are on approved methodology and every drawing is approved.' },
  { key: 'released', label: 'Released', tone: 'received', help: 'At least one drawing is marked As-built — released to the shop floor.' },
];

const TONE_CLASSES = {
  plain:       { box: 'bg-card border-border', value: 'text-foreground', label: 'text-muted-foreground', info: 'text-muted-foreground/70 hover:text-foreground' },
  enquiry:     { box: 'bg-card border-border', value: 'text-muted-foreground', label: 'text-muted-foreground', info: 'text-muted-foreground/70 hover:text-foreground' },
  comparison:  { box: 'bg-comparison-surface border-comparison/30', value: 'text-comparison', label: 'text-muted-foreground', info: 'text-comparison/70 hover:text-comparison' },
  ordered:     { box: 'bg-ordered-surface border-ordered/20', value: 'text-ordered', label: 'text-muted-foreground', info: 'text-ordered/70 hover:text-ordered' },
  received:    { box: 'bg-success-surface border-success/20', value: 'text-success', label: 'text-muted-foreground', info: 'text-success/60 hover:text-success' },
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

function StageBox({ label, help, tone = 'plain', value, state }) {
  const t = TONE_CLASSES[tone];
  const isCurrent = state === 'current';
  const isDone = state === 'done';
  return (
    <div className={`relative z-10 flex min-w-[6.5rem] flex-col items-center gap-1 rounded-lg border px-4 py-2.5 shadow-sm ${t.box} ${isCurrent ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}>
      <div className="flex items-center gap-1">
        {state ? (
          isDone
            ? <CheckIcon className={`size-4 ${t.value}`} />
            : <span className={`size-2 rounded-full ${isCurrent ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
        ) : (
          <span className={`text-lg font-semibold tnum leading-none ${t.value}`}>{value}</span>
        )}
        <InfoButton label={label} help={help} tone={tone} />
      </div>
      <span className={`text-xs ${isCurrent ? 'font-medium text-foreground' : t.label}`}>{label}</span>
    </div>
  );
}

function FlowArrow({ atPercent }) {
  return (
    <ChevronRightIcon className="absolute top-1/2 z-10 size-3.5 -translate-x-1/2 -translate-y-1/2 text-muted-foreground/50"
      style={{ left: `${atPercent}%` }} />
  );
}

function StageRowVertical({ label, help, tone, isLast, value, state }) {
  const t = TONE_CLASSES[tone];
  const isCurrent = state === 'current';
  const isDone = state === 'done';
  return (
    <div className="relative flex gap-3 pb-6 last:pb-0">
      {!isLast && <div className="absolute left-[11px] top-6 bottom-0 w-px bg-border" />}
      <div className={`z-10 flex size-6 shrink-0 items-center justify-center rounded-full border ${t.box} ${isCurrent ? 'ring-2 ring-primary' : ''}`}>
        {state ? (
          isDone
            ? <CheckIcon className={`size-3 ${t.value}`} />
            : <span className={`size-1.5 rounded-full ${isCurrent ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
        ) : (
          <span className={`text-[10px] font-semibold tnum ${t.value}`}>{value}</span>
        )}
      </div>
      <div className="flex flex-1 items-center gap-2 pt-0.5">
        <span className={`text-sm ${isCurrent ? 'font-medium text-foreground' : t.label}`}>{label}</span>
        <InfoButton label={label} help={help} tone={tone} />
      </div>
    </div>
  );
}

function DesignFlowVertical({ counts, activeIndex }) {
  return (
    <div className="flex flex-col">
      {STAGES.map((s, i) => (
        <StageRowVertical
          key={s.key} label={s.label} help={s.help} tone={s.tone} isLast={i === STAGES.length - 1}
          value={activeIndex < 0 ? (counts[s.key] || 0) : undefined}
          state={activeIndex < 0 ? undefined : (i < activeIndex ? 'done' : i === activeIndex ? 'current' : 'upcoming')}
        />
      ))}
    </div>
  );
}

export default function DesignFlow({ counts = {}, activeStage, bare = false, title = 'Design', href = '/calc', linkLabel = 'Open Calc Sheets →' }) {
  const nodeX = STAGES.map((_, i) => (i + 0.5) * (100 / STAGES.length));
  const midpoints = nodeX.slice(0, -1).map((x, i) => (x + nodeX[i + 1]) / 2);
  const firstX = nodeX[0];
  const lastX = nodeX[nodeX.length - 1];
  const activeIndex = activeStage ? STAGES.findIndex(s => s.key === activeStage) : -1;

  // Shared between the standalone Card (default) and the bare content used inside
  // DesignOperationsCard's Row 1 left column (Operations page unified card).
  const content = (
    <>
      <div className="hidden overflow-x-auto sm:block">
        <div className="mx-auto w-full max-w-4xl">
          <div className="relative grid w-full" style={{ gridTemplateColumns: `repeat(${STAGES.length}, minmax(0, 1fr))` }}>
            <div className="absolute top-1/2 h-px -translate-y-1/2 bg-border" style={{ left: `${firstX}%`, right: `${100 - lastX}%` }} />
            {midpoints.map((x) => <FlowArrow key={x} atPercent={x} />)}
              {STAGES.map((s, i) => (
                <div key={s.key} className="flex items-center justify-center">
                  <StageBox
                    label={s.label} help={s.help} tone={s.tone}
                    value={activeIndex < 0 ? (counts[s.key] || 0) : undefined}
                    state={activeIndex < 0 ? undefined : (i < activeIndex ? 'done' : i === activeIndex ? 'current' : 'upcoming')}
                  />
                </div>
              ))}
          </div>
        </div>
      </div>
      <div className="sm:hidden">
        <DesignFlowVertical counts={counts} activeIndex={activeIndex} />
      </div>
    </>
  );

  if (bare) return content;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardAction>
          <Button asChild size="sm" variant="outline">
            <Link href={href}>{linkLabel}</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}