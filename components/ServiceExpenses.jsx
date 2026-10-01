'use client';

// Service → Expenses. Two tabs (Cash Requests / Travel Allowance), each: my requests + a "New" form.
import { useCallback, useEffect, useState } from 'react';
import { BanknoteIcon, PlaneIcon, PlusIcon, ReceiptIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { formatDate } from '@/lib/format';
import WorkspaceSidebar from '@/components/WorkspaceSidebar';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { CashForm, TravelForm } from '@/components/ServiceExpenseForms';
import RequestView, { StatusBadge, inr } from '@/components/ServiceExpenseDetail';

const ITEMS = [
  { key: 'cash', label: 'Cash Requests', icon: BanknoteIcon },
  { key: 'travel', label: 'Travel Allowance', icon: PlaneIcon },
];

// Shared by the inbox screens too: a clickable list of requests.
export function RequestList({ rows, onOpen, empty = 'Nothing here yet.', showWho }) {
  if (rows == null) return <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>;
  if (!rows.length) return <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="divide-y rounded-lg border">
      {rows.map(r => (
        <button key={r.id} type="button" onClick={() => onOpen(r)} className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/40">
          <div className="w-20 shrink-0"><div className="font-medium">{r.req_no}</div><div className="text-xs text-muted-foreground">{formatDate(r.form_date)}</div></div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm">{showWho && <b className="mr-2">{r.requester_name}</b>}{r.customers.map(c => c.name).join(', ')}</div>
            <div className="truncate text-xs text-muted-foreground">{r.kind === 'cash' ? 'Cash' : 'Travel'} · {r.purpose}</div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1"><span className="text-sm font-medium tabular-nums">{inr(r.amount)}</span><StatusBadge status={r.status} /></div>
        </button>
      ))}
    </div>
  );
}

export function RequestSheet({ r, onClose, footer }) {
  return (
    <Sheet open onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full data-[side=right]:sm:max-w-3xl">
        <SheetHeader><SheetTitle>{r.req_no}</SheetTitle></SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4"><RequestView r={r} /></div>
        {footer}
      </SheetContent>
    </Sheet>
  );
}

function Tab({ kind, user }) {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(false);
  const [open, setOpen] = useState(null);
  const load = useCallback(() => api(`/api/service-expenses?scope=mine&kind=${kind}`).then(setRows).catch(err => showToast(err.message, 'error')), [kind]);
  useEffect(() => { setRows(null); load(); }, [load]);
  const Form = kind === 'cash' ? CashForm : TravelForm;
  const total = (rows || []).filter(r => r.status !== 'rejected').reduce((s, r) => s + Number(r.amount), 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ReceiptIcon className="size-4" />{kind === 'cash' ? 'My cash requests' : 'My travel allowance claims'}</CardTitle>
        <CardAction><Button onClick={() => setForm(true)}><PlusIcon data-icon="inline-start" />New {kind === 'cash' ? 'cash request' : 'claim'}</Button></CardAction>
      </CardHeader>
      <CardContent className="grid gap-3">
        {rows?.length > 0 && <p className="text-xs text-muted-foreground">{rows.length} request{rows.length > 1 ? 's' : ''} · {inr(total)} (excluding rejected)</p>}
        <RequestList rows={rows} onOpen={setOpen} empty={`No ${kind === 'cash' ? 'cash requests' : 'travel claims'} yet — start one with the button above.`} />
      </CardContent>
      {form && <Form user={user} onClose={() => setForm(false)} onSaved={() => { setForm(false); load(); }} />}
      {open && <RequestSheet r={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

export default function ServiceExpenses({ user }) {
  const [tab, setTab] = useState('cash');
  return (
    <WorkspaceSidebar title="Expenses" icon={ReceiptIcon} items={ITEMS} activeKey={tab} onChange={setTab}>
      <Tab key={tab} kind={tab} user={user} />
    </WorkspaceSidebar>
  );
}
