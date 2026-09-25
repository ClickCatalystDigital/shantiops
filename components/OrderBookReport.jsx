'use client';

// components/OrderBookReport.jsx — Sales → Reports → Order Book & Collections. The Sales Head's view
// of the real order book (imported trackers + new orders) and the payment log: what was booked,
// collected, still owed, how old it is, and who/which customers it sits with. Math in
// lib/order-book.mjs; data already scoped by company selector + member visibility (app/reports/page.js).
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, Legend } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { moneyTooltipFormatter } from '@/components/executive/charts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { BarList, ReportShell } from '@/components/ReportKit';
import { formatMoney } from '@/lib/format';
import { todayISO } from '@/lib/date';
import { financialYear } from '@/lib/gst-calc.mjs';
import { orderBook, financialYears, AGING_BUCKETS } from '@/lib/order-book.mjs';

const COMPANY_COLORS = { 'Shanti Boilers': 'var(--color-chart-1)', 'Shanti Techno Fab': 'var(--color-chart-2)' };
// chart config keys become CSS variables (--color-<key>), so they must not contain spaces
const safeKey = c => `co_${c.replace(/[^A-Za-z0-9]/g, '_')}`;
const monthLabel = ym => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });

function Tile({ label, value, hint, warn }) {
  return (
    <div className="rounded-lg border p-3" title={hint}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tnum ${warn ? 'text-destructive' : ''}`}>{value}</div>
    </div>
  );
}
function Panel({ title, children }) {
  return <div className="rounded-lg border p-3"><div className="mb-2 text-sm font-medium">{title}</div>{children}</div>;
}

function GroupTable({ title, rows, keyLabel }) {
  return (
    <div data-export-title={title}>
      <div className="mb-1 text-sm font-medium">{title}</div>
      <Table>
        <TableHeader><TableRow><TableHead>{keyLabel}</TableHead><TableHead className="text-right">Orders</TableHead>
          <TableHead className="text-right">Order value</TableHead><TableHead className="text-right">Received</TableHead>
          <TableHead className="text-right">Outstanding</TableHead><TableHead className="text-right">Collected %</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map(r => (
            <TableRow key={r.key}>
              <TableCell>{r.key}</TableCell>
              <TableCell className="text-right tnum">{r.orders}</TableCell>
              <TableCell className="text-right tnum" data-raw={r.value}>{formatMoney(r.value)}</TableCell>
              <TableCell className="text-right tnum" data-raw={r.received}>{formatMoney(r.received)}</TableCell>
              <TableCell className="text-right tnum" data-raw={r.outstanding}>{formatMoney(r.outstanding)}</TableCell>
              <TableCell className="text-right tnum" data-raw={r.value ? Math.round((r.received / r.value) * 1000) / 10 : 0}>{r.value ? `${Math.round((r.received / r.value) * 100)}%` : '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function OrderBookReport({ saleOrders = [], salePayments = [] }) {
  const today = todayISO();
  const years = useMemo(() => financialYears(saleOrders), [saleOrders]);
  const [fy, setFy] = useState(() => financialYear(today));
  const [view, setView] = useState('customer');
  const b = useMemo(() => orderBook({ saleOrders, payments: salePayments, fy, today }), [saleOrders, salePayments, fy, today]);
  const companies = [...new Set(b.monthly.flatMap(m => Object.keys(m.booked)))].sort();
  const chartData = b.monthly.map(m => ({ month: monthLabel(m.month), ...Object.fromEntries(Object.entries(m.booked).map(([c, v]) => [safeKey(c), v])), collected: m.collected }));
  const config = Object.fromEntries([...companies.map(c => [safeKey(c), { label: c, color: COMPANY_COLORS[c] || 'var(--color-chart-3)' }]),
    ['collected', { label: 'Collected', color: 'var(--color-success)' }]]);
  const k = b.kpis;
  const groups = { customer: ['By customer', 'Customer', b.byCustomer], person: ['By sales person', 'Sales person', b.bySalesPerson],
    status: ['By order status', 'Status', b.byStatus], company: ['By company', 'Company', b.byCompany] };
  const [gTitle, gKey, gRows] = groups[view];

  return (
    <ReportShell title="Order Book & Collections"
      description="Orders booked, money collected and what is still owed — from the Sale Orders and the payment log. Follows the company selector at the top."
      action={
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1"><Label className="text-xs">Financial year</Label>
            <Select value={fy} onValueChange={setFy}>
              <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All years</SelectItem>
                {[...new Set([financialYear(today), ...years])].map(y => <SelectItem key={y} value={y}>FY {y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      }>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Tile label="Orders booked" value={k.orders} />
          <Tile label="Order value" value={formatMoney(k.value)} />
          <Tile label="Received on these orders" value={formatMoney(k.receivedOnBooked)} />
          <Tile label="Outstanding" value={formatMoney(k.outstanding)} warn={k.outstanding > 0} />
          <Tile label="Collected %" value={`${Math.round(k.collectionPct)}%`} hint="Received ÷ order value, for orders booked in the period" />
          <Tile label="Collected in period" value={formatMoney(k.collectedInPeriod)} hint="All money received in the period, including against older orders" />
        </div>

        <Panel title="Booked and collected per month">
          {chartData.length ? (
            <ChartContainer config={config} className="aspect-auto h-64 w-full">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                <YAxis hide />
                <ChartTooltip content={<ChartTooltipContent formatter={moneyTooltipFormatter} />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {companies.map(c => <Bar key={c} dataKey={safeKey(c)} name={c} stackId="booked" fill={config[safeKey(c)].color} />)}
                <Bar dataKey="collected" name="Collected" fill="var(--color-success)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          ) : <p className="text-sm text-muted-foreground">No orders in this period.</p>}
        </Panel>

        <div className="grid gap-3 md:grid-cols-2">
          <Panel title="Outstanding by age (from order date)">
            <BarList items={AGING_BUCKETS.map(a => ({ label: a, value: b.aging[a] })).filter(i => i.value > 0)} valueFmt={formatMoney}
              colorFor={i => (i.label === '180+ days' ? 'bg-destructive' : 'bg-chart-1')} />
          </Panel>
          <Panel title="Top 10 customers — outstanding">
            <BarList items={[...b.byCustomer].sort((x, y) => y.outstanding - x.outstanding).filter(r => r.outstanding > 0).slice(0, 10).map(r => ({ label: r.key, value: r.outstanding }))} valueFmt={formatMoney} />
          </Panel>
          <Panel title="Order value by sales person">
            <BarList items={b.bySalesPerson.filter(r => r.value > 0).slice(0, 10).map(r => ({ label: r.key, value: r.value }))} valueFmt={formatMoney} />
          </Panel>
          <Panel title="Orders by status">
            <BarList items={b.byStatus.map(r => ({ label: `${r.key} (${r.orders})`, value: r.value }))} valueFmt={formatMoney} />
          </Panel>
        </div>

        <div className="flex items-center gap-2">
          <Label className="text-xs">Details</Label>
          <Select value={view} onValueChange={setView}>
            <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(groups).map(([key, [t]]) => <SelectItem key={key} value={key}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <GroupTable title={gTitle} keyLabel={gKey} rows={gRows} />
      </div>
    </ReportShell>
  );
}
