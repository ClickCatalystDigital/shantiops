'use client';

// Read-only view of one Service expense request (cash or travel) + the Manager → Executive →
// Accounts progress strip. Shared by the Service page, Approvals and Accounts.
import { CheckIcon, XIcon, CircleDotIcon, DownloadIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { STATUS_LABEL, amountInWords, sumRows, tourSummary } from '@/lib/service-expense.mjs';
import { cn } from '@/lib/utils';

export const inr = n => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const TONE = {
  pending_manager: 'bg-warning/10 text-warning ring-warning/20',
  pending_executive: 'bg-info/10 text-info ring-info/20',
  with_accounts: 'bg-info/10 text-info ring-info/20',
  settled: 'bg-success/10 text-success ring-success/20',
  rejected: 'bg-destructive/10 text-destructive ring-destructive/20',
};
export const StatusBadge = ({ status }) => <Badge variant="outline" className={cn('ring-1', TONE[status])}>{STATUS_LABEL[status] || status}</Badge>;

// Three steps; each shows who acted and when once done.
export function Stepper({ r }) {
  const rej = r.status === 'rejected';
  const steps = [
    { label: 'Manager', by: r.manager_by, at: r.manager_at, done: !!r.manager_at && !(rej && r.rejected_stage === 'manager'), bad: rej && r.rejected_stage === 'manager' },
    { label: 'Executive', by: r.executive_by, at: r.executive_at, done: !!r.executive_at && !(rej && r.rejected_stage === 'executive'), bad: rej && r.rejected_stage === 'executive' },
    { label: 'Accounts', by: r.accounted_by, at: r.settled_on, done: r.status === 'settled', bad: false },
  ];
  const current = rej ? -1 : steps.findIndex(s => !s.done);
  return (
    <div className="grid grid-cols-3 gap-2">
      {steps.map((s, i) => (
        <div key={s.label} className={cn('rounded-lg border p-2.5', s.done && 'border-success/30 bg-success/5', s.bad && 'border-destructive/30 bg-destructive/5', i === current && 'border-primary/40 bg-primary/5')}>
          <div className="flex items-center gap-1.5 text-xs font-medium">
            {s.done ? <CheckIcon className="size-3.5 text-success" /> : s.bad ? <XIcon className="size-3.5 text-destructive" /> : <CircleDotIcon className={cn('size-3.5', i === current ? 'text-primary' : 'text-muted-foreground/50')} />}
            {s.label}
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">{s.by ? `${s.by}${s.at ? ` · ${formatDate(String(s.at).slice(0, 10))}` : ''}` : i === current ? 'Waiting…' : '—'}</div>
        </div>
      ))}
    </div>
  );
}

const Field = ({ label, children }) => (
  <div className="grid gap-0.5"><span className="text-xs text-muted-foreground">{label}</span><span className="text-sm">{children || '—'}</span></div>
);

function MiniTable({ title, cols, rows }) {
  return (
    <div className="rounded-lg border">
      <div className="border-b bg-muted/30 px-3 py-1.5 text-sm font-medium">{title}</div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow>{cols.map(([k, l]) => <TableHead key={k} className={k === 'amount' ? 'text-right' : ''}>{l}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={cols.length} className="text-center text-muted-foreground">None</TableCell></TableRow>}
            {rows.map((r, i) => <TableRow key={i}>{cols.map(([k]) => <TableCell key={k} className={k === 'amount' ? 'text-right tabular-nums' : ''}>{k === 'amount' ? inr(r[k]) : (/date$|^date$/.test(k) && r[k] ? formatDate(r[k]) : r[k]) || '—'}</TableCell>)}</TableRow>)}
            <TableRow className="bg-muted/20 font-medium"><TableCell colSpan={cols.length - 1} className="text-right">Total</TableCell><TableCell className="text-right tabular-nums">{inr(sumRows(rows))}</TableCell></TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function SummaryTable({ summary }) {
  return (
    <div className="rounded-lg border">
      <div className="border-b bg-muted/30 px-3 py-1.5 text-sm font-medium">Tour Summary</div>
      <Table>
        <TableBody>
          {summary.lines.map(([l, a], i) => <TableRow key={l}><TableCell className="w-8 text-muted-foreground">{i + 1}</TableCell><TableCell>{l}</TableCell><TableCell className="text-right tabular-nums">{inr(a)}</TableCell></TableRow>)}
          <TableRow className="font-medium"><TableCell /><TableCell className="text-right">Total</TableCell><TableCell className="text-right tabular-nums">{inr(summary.total)}</TableCell></TableRow>
          <TableRow><TableCell /><TableCell className="text-right">Advance taken</TableCell><TableCell className="text-right tabular-nums">{inr(summary.advance)}</TableCell></TableRow>
          <TableRow className="bg-muted/20 font-semibold"><TableCell /><TableCell className="text-right">Balance {summary.balance < 0 ? '(payable to company)' : '(payable to employee)'}</TableCell><TableCell className="text-right tabular-nums">{inr(Math.abs(summary.balance))}</TableCell></TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

export default function RequestView({ r }) {
  const d = r.data;
  const authorizedBy = [r.manager_by && `${r.manager_by} (Manager)`, r.executive_by && `${r.executive_by} (Executive)`].filter(Boolean).join(', ');
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><div className="text-lg font-semibold">{r.req_no}</div><div className="text-xs text-muted-foreground">{r.kind === 'cash' ? 'Cash requisition for sundry expenses' : 'Travelling expenses bill'} · {formatDate(r.form_date)}</div></div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline"><a href={`/api/service-expenses/${r.id}/pdf`} target="_blank" rel="noreferrer"><DownloadIcon data-icon="inline-start" />PDF</a></Button>
          <StatusBadge status={r.status} />
        </div>
      </div>
      <Stepper r={r} />
      {r.status === 'rejected' && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"><b>Rejected by {r.rejected_stage}:</b> {r.rejected_note}</div>}
      {r.kind === 'cash' ? (
        <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
          <Field label="Amount">{inr(r.amount)}</Field>
          <Field label="In words">{amountInWords(r.amount)}</Field>
          <Field label="Requested by">{r.requester_name}</Field>
          <Field label="Authorized by">{authorizedBy}</Field>
          <div className="sm:col-span-2"><Field label="Purpose">{d.purpose}</Field></div>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-1.5"><span className="text-xs text-muted-foreground">Customers</span>{r.customers.map(c => <Badge key={c.name} variant="secondary">{c.name}{c.type === 'other' ? ' (other)' : ''}</Badge>)}</div>
          {r.used_by && <div className="sm:col-span-2 text-xs text-muted-foreground">Taken as advance on a travel claim.</div>}
        </div>
      ) : (
        <>
          <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
            <Field label="Name">{r.requester_name}</Field>
            <Field label="Place of visit">{r.customers[0]?.name}</Field>
            <div className="sm:col-span-2"><Field label="Purpose of visit">{d.purpose}</Field></div>
            <Field label="Chargeable">{d.chargeable === 'no' ? 'Not chargeable' : 'Chargeable'}</Field>
            <Field label="Party name">{d.party_name}</Field>
            <Field label="Authorized by">{authorizedBy}</Field>
            <Field label="Remarks">{d.remarks}</Field>
          </div>
          <MiniTable title="1. Travel details" rows={d.travel} cols={[['dep_date', 'Dep. date'], ['dep_time', 'Time'], ['dep_place', 'From'], ['arr_date', 'Arr. date'], ['arr_time', 'Time'], ['arr_place', 'To'], ['mode', 'Mode'], ['class', 'Class'], ['amount', 'Amount']]} />
          <MiniTable title="2. Lodging" rows={d.lodging} cols={[['date', 'Date'], ['amount', 'Amount']]} />
          <MiniTable title="3. Boarding / journey allowance" rows={d.boarding} cols={[['date', 'Date'], ['place', 'Place'], ['amount', 'Amount']]} />
          <MiniTable title="4. Conveyance" rows={d.conveyance} cols={[['date', 'Date'], ['from', 'From'], ['to', 'To'], ['mode', 'Mode'], ['km', 'Km'], ['amount', 'Amount']]} />
          <MiniTable title="5. Other expenses" rows={d.other} cols={[['date', 'Date'], ['type', 'Type'], ['particulars', 'Particulars'], ['amount', 'Amount']]} />
          {r.advances?.length > 0 && <div className="text-xs text-muted-foreground">Advance from {r.advances.map(a => `${a.req_no} (${inr(a.amount)})`).join(', ')}</div>}
          <SummaryTable summary={tourSummary(d, r.advance_taken)} />
        </>
      )}
      {(r.settled_on || r.status === 'settled') && (
        <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-3">
          <div className="sm:col-span-3 text-sm font-medium">For Accounts department use only</div>
          <Field label="Accounts settled on">{r.settled_on && formatDate(r.settled_on)}</Field>
          <Field label="Accounted by">{r.accounted_by}</Field>
          <Field label="Checked">{r.checked_by}</Field>
        </div>
      )}
    </div>
  );
}
