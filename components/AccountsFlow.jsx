// components/AccountsFlow.jsx
'use client';

// Accounts' Operations tab glance — same node/spine shapes as StoresFlow.jsx/DispatchFlow.jsx
// (copied, not abstracted, same precedent those files already state). Accounts isn't one pipeline
// like Dispatch or Sales — it's three independent document flows (Purchase-to-Pay, Order-to-Cash,
// Period Close) that all terminate at the General Ledger tab, so this renders three small spines
// instead of one long one, each with a side stat for its "exception" document (debit/credit note,
// GST filed) that doesn't sit on the main spine.
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from './ui/card';
import { Button } from './ui/button';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';
import { InfoIcon, ChevronRightIcon } from 'lucide-react';

const TONE_CLASSES = {
  plain:   { box: 'bg-card border-border', value: 'text-foreground', label: 'text-muted-foreground', info: 'text-muted-foreground/70 hover:text-foreground' },
  ordered: { box: 'bg-ordered-surface border-ordered/20', value: 'text-ordered', label: 'text-muted-foreground', info: 'text-ordered/70 hover:text-ordered' },
  received:{ box: 'bg-success-surface border-success/20', value: 'text-success', label: 'text-muted-foreground', info: 'text-success/60 hover:text-success' },
};

const PIPELINES = [
  {
    key: 'p2p',
    title: 'Purchase → Pay',
    stages: [
      { key: 'billsDraft', label: 'Bill Draft', tone: 'plain', help: 'Vendor bills recorded against a received PO, not yet approved.' },
      { key: 'billsApproved', label: 'Approved', tone: 'ordered', help: 'Approved and posted to the ledger — awaiting payment.' },
      { key: 'billsPaid', label: 'Paid', tone: 'received', help: 'Fully settled via one or more vendor payments.' },
    ],
    side: { key: 'debitNotes', label: 'Debit notes', help: 'Purchase debit notes raised against a vendor bill (returns/shortages/price adjustments).' },
  },
  {
    key: 'o2c',
    title: 'Order → Cash',
    stages: [
      { key: 'invoicesDraft', label: 'Invoice Draft', tone: 'plain', help: 'Sales invoices raised against a Sale Order, not yet issued.' },
      { key: 'invoicesIssued', label: 'Issued', tone: 'ordered', help: 'Issued to the customer and posted to the ledger — awaiting receipt.' },
      { key: 'invoicesPaid', label: 'Paid', tone: 'received', help: 'Fully settled via one or more customer receipts.' },
    ],
    side: { key: 'creditNotes', label: 'Credit notes', help: 'Sales credit notes raised against an invoice (returns/adjustments).' },
  },
  {
    key: 'close',
    title: 'Period Close',
    stages: [
      { key: 'jeDraft', label: 'JE Draft', tone: 'plain', help: 'Manual journal entries not yet posted — invisible to the General Ledger until then.' },
      { key: 'jePosted', label: 'Posted', tone: 'ordered', help: 'Posted entries, from every source: bills, invoices, payments, receipts, material issues, freight, and manual entries.' },
      { key: 'reconciled', label: 'Reconciled', tone: 'received', help: 'Posted Bank & Cash (1001) lines ticked off against the real bank statement.' },
    ],
    side: { key: 'gstFilings', label: 'GST returns filed', help: 'GSTR-1/IFF/GSTR-3B filings recorded on the GST Returns tab, across all periods.' },
  },
];

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

function Pipeline({ pipeline, counts }) {
  const { stages, side } = pipeline;
  const nodeX = stages.map((_, i) => (i + 0.5) * (100 / stages.length));
  const midpoints = nodeX.slice(0, -1).map((x, i) => (x + nodeX[i + 1]) / 2);
  const firstX = nodeX[0];
  const lastX = nodeX[nodeX.length - 1];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{pipeline.title}</p>
      <div className="hidden overflow-x-auto sm:block">
        <div className="mx-auto flex min-w-[24rem] flex-col items-center gap-2">
          <div className="relative grid w-full" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
            <div className="absolute top-1/2 h-px -translate-y-1/2 bg-border" style={{ left: `${firstX}%`, right: `${100 - lastX}%` }} />
            {midpoints.map(x => <FlowArrow key={x} atPercent={x} />)}
            {stages.map(s => (
              <div key={s.key} className="flex items-center justify-center">
                <StageBox value={counts[s.key] || 0} label={s.label} help={s.help} tone={s.tone} />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>{side.label}:</span>
            <span className="font-medium tnum text-foreground">{counts[side.key] || 0}</span>
            <InfoButton label={side.label} help={side.help} tone="plain" />
          </div>
        </div>
      </div>
      <div className="sm:hidden">
        {stages.map((s, i) => (
          <StageRowVertical key={s.key} value={counts[s.key] || 0} label={s.label} help={s.help}
            tone={s.tone} isLast={false} />
        ))}
        <StageRowVertical value={counts[side.key] || 0} label={side.label} help={side.help} tone="plain" isLast />
      </div>
    </div>
  );
}

export default function AccountsFlow({ counts }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Accounts</CardTitle>
        <CardAction>
          <Button asChild size="sm" variant="outline">
            <Link href="/accounts">Open Accounts workspace →</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {PIPELINES.map(p => <Pipeline key={p.key} pipeline={p} counts={counts} />)}
        <p className="text-xs text-muted-foreground">All three post to the General Ledger.</p>
      </CardContent>
    </Card>
  );
}
