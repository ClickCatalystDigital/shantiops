'use client';

// components/OrderManagementReports.jsx — Sales → Reports → Sales Order / AMC Order group.
// Dispatch Sales Order Report: every sale order and where it stands in dispatch (packing lists made,
// dispatched, last dispatch date, days from order to dispatch). Data comes from getSaleOrders()
// (already narrowed by the company selector + member visibility in app/reports/page.js).
import { useMemo, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ReportShell, StatRow } from '@/components/ReportKit';
import { formatMoney, formatDate } from '@/lib/format';
import { todayISO } from '@/lib/date';
import { financialYear } from '@/lib/gst-calc.mjs';

// One state per order, from its packing lists: none made / some made / part sent / all sent.
export function dispatchState(o) {
  const total = Number(o.packing_total || 0), done = Number(o.packing_dispatched || 0);
  if (total === 0) return 'not_started';
  if (done === 0) return 'pending';
  return done >= total ? 'dispatched' : 'partial';
}
const LABEL = { not_started: 'Not started', pending: 'Packing — not dispatched', partial: 'Partly dispatched', dispatched: 'Dispatched' };
const TONE = { not_started: 'outline', pending: 'secondary', partial: 'secondary', dispatched: 'default' };

export function DispatchSalesOrderReport({ saleOrders = [] }) {
  const today = todayISO();
  const [fy, setFy] = useState('all');
  const [state, setState] = useState('all');
  const [q, setQ] = useState('');
  const years = useMemo(() => [...new Set(saleOrders.map(o => o.order_date && financialYear(o.order_date)).filter(Boolean))].sort().reverse(), [saleOrders]);
  const rows = useMemo(() => saleOrders
    .filter(o => o.status !== 'cancelled' && (fy === 'all' || (o.order_date && financialYear(o.order_date) === fy)))
    .map(o => ({ ...o, _state: dispatchState(o) }))
    .filter(o => (state === 'all' || o._state === state)
      && (!q.trim() || `${o.so_no} ${o.customer_name || ''}`.toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => String(b.order_date || '').localeCompare(String(a.order_date || ''))), [saleOrders, fy, state, q]);
  const count = s => rows.filter(r => r._state === s).length;
  const days = o => (o.dispatched_at && o.order_date ? Math.max(0, Math.round((new Date(String(o.dispatched_at).slice(0, 10)) - new Date(o.order_date)) / 86400000)) : null);
  const value = rows.reduce((a, o) => a + (Number(o.total) || 0), 0);

  return (
    <ReportShell title="Dispatch Sales Order Report"
      description="Every sale order and where it stands in dispatch: packing lists made, how many are dispatched, and the days from order to dispatch. Follows the company selector at the top."
      action={
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1"><Label className="text-xs">Financial year</Label>
            <Select value={fy} onValueChange={setFy}>
              <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All years</SelectItem>{[...new Set([financialYear(today), ...years])].map(y => <SelectItem key={y} value={y}>FY {y}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1"><Label className="text-xs">Dispatch status</Label>
            <Select value={state} onValueChange={setState}>
              <SelectTrigger className="h-8 w-48"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All</SelectItem>{Object.entries(LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Input className="h-8 w-44" placeholder="Search order / customer" value={q} onChange={e => setQ(e.target.value)} />
        </div>
      }>
      <div className="flex flex-col gap-4">
        <StatRow stats={[
          { label: 'Orders', value: rows.length }, { label: 'Order value', value: formatMoney(value) },
          { label: 'Dispatched', value: count('dispatched') }, { label: 'Partly', value: count('partial') },
          { label: 'In packing', value: count('pending') }, { label: 'Not started', value: count('not_started'), warn: count('not_started') > 0 },
        ]} />
        {rows.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No orders match.</p> : (
          <div className="overflow-x-auto rounded-lg border">
            <Table className="min-w-[860px]">
              <TableHeader><TableRow>
                <TableHead>Order</TableHead><TableHead>Customer</TableHead><TableHead>Order date</TableHead><TableHead className="text-right">Value</TableHead>
                <TableHead>Dispatch</TableHead><TableHead>Packing lists</TableHead><TableHead>Last dispatched</TableHead><TableHead className="text-right">Days to dispatch</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.slice(0, 500).map(o => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">{o.so_no}</TableCell>
                    <TableCell className="max-w-56 truncate" title={o.customer_name || ''}>{o.customer_name || '—'}</TableCell>
                    <TableCell className="whitespace-nowrap">{o.order_date ? formatDate(o.order_date) : '—'}</TableCell>
                    <TableCell className="text-right tnum" data-raw={o.total || 0}>{formatMoney(o.total || 0)}</TableCell>
                    <TableCell><Badge variant={TONE[o._state]}>{LABEL[o._state]}</Badge></TableCell>
                    <TableCell className="tnum">{Number(o.packing_total) ? `${o.packing_dispatched || 0} of ${o.packing_total}` : '—'}</TableCell>
                    <TableCell className="whitespace-nowrap">{o.dispatched_at ? formatDate(o.dispatched_at) : '—'}</TableCell>
                    <TableCell className="text-right tnum">{days(o) ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {rows.length > 500 && <p className="text-xs text-muted-foreground">Showing the latest 500 of {rows.length}. Narrow by year or status for the rest.</p>}
        <p className="text-xs text-muted-foreground">Dispatch is read from the packing lists of the project made from the order. An order with no project yet shows "Not started". Older dispatches with no recorded date use the date the list was last updated.</p>
      </div>
    </ReportShell>
  );
}
