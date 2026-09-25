'use client';

// components/SalesInsightReports.jsx — Sales CRM plan 3c (Employee Performance 360) and 3e (Sales
// Overview). Same hasOwnControls/crmData shape as the other Sales reports; all counting lives in
// lib/sales-insights.mjs so the two reports can't disagree. Layout per plan 3a: filters → KPI
// tiles → charts → details table (CSV/Excel from ReportShell).
import { useMemo, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import SearchableSelect from '@/components/SearchableSelect';
import { formatMoney } from '@/lib/format';
import { todayMonth, todayISO } from '@/lib/date';
import { personLabel } from '@/lib/sales-people.mjs';
import { funnelRows } from '@/lib/lead-stage.mjs';
import { quotationFollowupReason } from '@/lib/quotation-reminders.mjs';
import { employeeMetrics, monthlySeries, weeklyActivity, addMonths, owners } from '@/lib/sales-insights.mjs';
import { BarList, ReportShell } from '@/components/ReportKit';

function Kpis({ items }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map(([label, value, hint]) => (
        <div key={label} className="rounded-lg border p-3" title={hint}>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-lg font-semibold tnum">{value}</div>
        </div>
      ))}
    </div>
  );
}

function Chart({ title, children }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 text-sm font-medium">{title}</div>
      {children}
    </div>
  );
}

// Target vs achieved per month — two thin bars per month, same bar idiom as BarList.
function TargetBars({ series }) {
  const max = Math.max(1, ...series.flatMap(s => [s.target, s.orderValue]));
  if (!series.length) return <p className="text-sm text-muted-foreground">No data yet.</p>;
  return (
    <div className="flex flex-col gap-2">
      {series.map(s => (
        <div key={s.month} className="flex items-center gap-3 text-sm">
          <span className="w-16 shrink-0 text-muted-foreground tnum">{s.month}</span>
          <div className="flex flex-1 flex-col gap-1">
            <div className="h-2 overflow-hidden rounded-full bg-muted" title={`Target ${formatMoney(s.target)}`}><div className="h-full rounded-full bg-muted-foreground/40" style={{ width: `${(s.target / max) * 100}%` }} /></div>
            <div className="h-2 overflow-hidden rounded-full bg-muted" title={`Achieved ${formatMoney(s.orderValue)}`}><div className="h-full rounded-full bg-chart-1" style={{ width: `${(s.orderValue / max) * 100}%` }} /></div>
          </div>
          <span className="w-28 shrink-0 text-right text-xs tnum text-muted-foreground">{formatMoney(s.orderValue)} / {formatMoney(s.target)}</span>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">Grey = target, colour = orders booked.</p>
    </div>
  );
}

function PeriodPicker({ from, to, setFrom, setTo }) {
  return (
    <>
      <div className="grid gap-1.5"><Label>From</Label><Input type="month" value={from} onChange={e => setFrom(e.target.value)} className="w-40" /></div>
      <div className="grid gap-1.5"><Label>To</Label><Input type="month" value={to} onChange={e => setTo(e.target.value)} className="w-40" /></div>
    </>
  );
}

const pct = v => (v == null ? '—' : `${v}%`);

export function EmployeePerformance360Report(props) {
  const { users = [], leads = [], stages = [] } = props;
  const [from, setFrom] = useState(addMonths(todayMonth(), -2));
  const [to, setTo] = useState(todayMonth());
  const [person, setPerson] = useState('');
  const range = from <= to ? [from, to] : [to, from];

  const metrics = useMemo(() => employeeMetrics(props, ...range), [props, range[0], range[1]]);
  const people = [...metrics.keys()].sort((a, b) => personLabel(a, users).localeCompare(personLabel(b, users)));
  const one = person ? metrics.get(person) : null;
  const total = useMemo(() => {
    const t = { enquiries: 0, salesCalls: 0, plannedFollowups: 0, actualFollowups: 0, quotations: 0, quotationValue: 0, orders: 0, orderValue: 0, won: 0, lost: 0, target: 0, expenses: 0 };
    for (const m of metrics.values()) for (const k of Object.keys(t)) t[k] += m[k];
    return t;
  }, [metrics]);
  const k = one || total;
  const winRate = k.won + k.lost ? Math.round((k.won / (k.won + k.lost)) * 100) : null;
  const achievement = k.target > 0 ? Math.round((k.orderValue / k.target) * 100) : null;
  const series = useMemo(() => monthlySeries(props, ...range, person || null), [props, range[0], range[1], person]);
  const weeks = useMemo(() => weeklyActivity(props, ...range, person || null), [props, range[0], range[1], person]);
  const leadOwner = useMemo(() => owners(props).lead, [props]);
  const ownLeads = person ? leads.filter(l => leadOwner(l) === person) : leads;
  const funnel = funnelRows(ownLeads, stages).filter(r => r.count);

  return (
    <ReportShell title="Employee Performance 360" description="One A/C manager, or the whole team: enquiries, Diary activity, quotations, orders, target achievement, time per stage and expenses for the chosen months. Actual follow-ups are matched by date (a later Diary entry on the same enquiry), not a hard link.">
      <div className="flex flex-wrap items-end gap-3">
        <PeriodPicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <div className="grid gap-1.5"><Label>A/C manager</Label>
          <SearchableSelect value={person} onChange={v => setPerson(v || '')} placeholder="Whole team"
            options={[{ value: '', label: 'Whole team' }, ...people.map(p => ({ value: p, label: personLabel(p, users) }))]} />
        </div>
      </div>
      <Kpis items={[
        ['Enquiries', k.enquiries], ['Sales calls', k.salesCalls],
        ['Follow-ups (actual / planned)', `${k.actualFollowups} / ${k.plannedFollowups}`],
        ['Quotations sent', `${k.quotations} · ${formatMoney(k.quotationValue)}`],
        ['Orders won', `${k.orders} · ${formatMoney(k.orderValue)}`],
        ['Win rate', pct(winRate), 'Won ÷ (won + lost) of enquiries raised in the period'],
        ['Target', formatMoney(k.target)], ['Achievement', pct(achievement)],
        ['Avg days per stage', one?.avgDaysPerStage ?? '—', 'Average time an enquiry spent in each stage before moving on'],
        ['Expenses', formatMoney(k.expenses)], ['Cost per order', k.orders ? formatMoney(Math.round(k.expenses / k.orders)) : '—'],
      ]} />
      <div className="grid gap-3 lg:grid-cols-2">
        <Chart title="Target vs achieved by month"><TargetBars series={series} /></Chart>
        <Chart title="Enquiries by stage (now)"><BarList items={funnel.map(r => ({ label: r.stage, value: r.count }))} /></Chart>
        <Chart title="Diary activity per week"><BarList items={weeks.map(w => ({ label: `w/c ${w.week}`, value: w.value }))} /></Chart>
        {!person && <Chart title="Team comparison — order value"><BarList items={people.map(p => ({ label: personLabel(p, users), value: metrics.get(p).orderValue })).filter(i => i.value > 0).sort((a, b) => b.value - a.value)} valueFmt={formatMoney} /></Chart>}
      </div>
      <div data-export-title={person ? 'Enquiries' : 'Team'}>
        {person ? (
          <Table>
            <TableHeader><TableRow>{['Enquiry', 'Date', 'Stage', 'Expected value', 'Expected in'].map(h => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader>
            <TableBody>
              {ownLeads.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No enquiries.</TableCell></TableRow> : ownLeads.map(l => (
                <TableRow key={l.id}>
                  <TableCell><a className="text-primary hover:underline" href={`/sales?tab=leads&highlight=LD-${l.id}`}>{l.company_name || l.lead_name}</a></TableCell>
                  <TableCell className="tnum">{l.enquiry_date || l.created_at?.slice(0, 10) || '—'}</TableCell>
                  <TableCell>{l.sales_call_status}</TableCell>
                  <TableCell className="tnum" data-raw={Number(l.expected_value) || 0}>{formatMoney(Number(l.expected_value) || 0)}</TableCell>
                  <TableCell>{l.order_expected_in || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Table>
            <TableHeader><TableRow>{['A/C manager', 'Enquiries', 'Sales calls', 'Planned F/U', 'Actual F/U', 'Quotations', 'Quote value', 'Orders', 'Order value', 'Win rate', 'Target', 'Achievement', 'Avg days/stage', 'Expenses', 'Cost/order'].map(h => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader>
            <TableBody>
              {people.length === 0 ? <TableRow><TableCell colSpan={15} className="text-center text-muted-foreground">No activity in this period.</TableCell></TableRow> : people.map(p => {
                const m = metrics.get(p);
                return (
                  <TableRow key={p} className="cursor-pointer" onClick={() => setPerson(p)}>
                    <TableCell className="font-medium">{personLabel(p, users)}</TableCell>
                    <TableCell className="tnum">{m.enquiries}</TableCell>
                    <TableCell className="tnum">{m.salesCalls}</TableCell>
                    <TableCell className="tnum">{m.plannedFollowups}</TableCell>
                    <TableCell className="tnum">{m.actualFollowups}</TableCell>
                    <TableCell className="tnum">{m.quotations}</TableCell>
                    <TableCell className="tnum" data-raw={m.quotationValue}>{formatMoney(m.quotationValue)}</TableCell>
                    <TableCell className="tnum">{m.orders}</TableCell>
                    <TableCell className="tnum" data-raw={m.orderValue}>{formatMoney(m.orderValue)}</TableCell>
                    <TableCell className="tnum">{pct(m.winRate)}</TableCell>
                    <TableCell className="tnum" data-raw={m.target}>{formatMoney(m.target)}</TableCell>
                    <TableCell className="tnum">{pct(m.achievement)}</TableCell>
                    <TableCell className="tnum">{m.avgDaysPerStage ?? '—'}</TableCell>
                    <TableCell className="tnum" data-raw={m.expenses}>{formatMoney(m.expenses)}</TableCell>
                    <TableCell className="tnum" data-raw={m.costPerOrder ?? ''}>{m.costPerOrder == null ? '—' : formatMoney(m.costPerOrder)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </ReportShell>
  );
}

export function SalesOverviewReport(props) {
  const { leads = [], stages = [], quotations = [] } = props;
  const [month, setMonth] = useState(todayMonth());
  const series = useMemo(() => monthlySeries(props, addMonths(month, -5), month), [props, month]);
  const cur = series[series.length - 1] || { orders: 0, orderValue: 0, target: 0, enquiries: 0, quotations: 0 };
  const funnel = useMemo(() => funnelRows(leads, stages), [leads, stages]);
  const open = funnel.filter(r => !r.isWon && !r.isLost);
  const today = todayISO();
  const needFollowup = quotations.filter(q => quotationFollowupReason(q, today)).length;

  return (
    <ReportShell title="Sales Overview" description="This month's orders against target, the open funnel and its weighted forecast, quotations waiting on a follow-up, and the last six months' trend.">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5"><Label>Month</Label><Input type="month" value={month} onChange={e => setMonth(e.target.value || todayMonth())} className="w-40" /></div>
      </div>
      <Kpis items={[
        ['Orders this month', `${cur.orders} · ${formatMoney(cur.orderValue)}`],
        ['Target', formatMoney(cur.target)],
        ['Achievement', cur.target > 0 ? `${Math.round((cur.orderValue / cur.target) * 100)}%` : '—'],
        ['Open funnel value', formatMoney(open.reduce((s, r) => s + r.value, 0)), `${open.reduce((s, r) => s + r.count, 0)} open enquiries`],
        ['Weighted forecast', formatMoney(open.reduce((s, r) => s + r.weighted, 0)), 'Open value × each stage’s win probability'],
        ['Quotations to follow up', needFollowup, 'Sent quotations expiring, expired with no order, or 7+ days with no Diary activity'],
      ]} />
      <div className="grid gap-3 lg:grid-cols-2">
        <Chart title="Orders vs target (6 months)"><TargetBars series={series} /></Chart>
        <Chart title="Open funnel value by stage"><BarList items={open.filter(r => r.value > 0).map(r => ({ label: r.stage, value: r.value }))} valueFmt={formatMoney} /></Chart>
        <Chart title="Enquiries per month"><BarList items={series.map(s => ({ label: s.month, value: s.enquiries }))} /></Chart>
        <Chart title="Quotations sent per month"><BarList items={series.map(s => ({ label: s.month, value: s.quotations }))} /></Chart>
      </div>
      <div data-export-title="Last 6 months">
        <Table>
          <TableHeader><TableRow>{['Month', 'Enquiries', 'Quotations', 'Orders', 'Order value', 'Target', 'Achievement'].map(h => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {series.map(s => (
              <TableRow key={s.month}>
                <TableCell className="tnum">{s.month}</TableCell>
                <TableCell className="tnum">{s.enquiries}</TableCell>
                <TableCell className="tnum">{s.quotations}</TableCell>
                <TableCell className="tnum">{s.orders}</TableCell>
                <TableCell className="tnum" data-raw={s.orderValue}>{formatMoney(s.orderValue)}</TableCell>
                <TableCell className="tnum" data-raw={s.target}>{formatMoney(s.target)}</TableCell>
                <TableCell className="tnum">{s.target > 0 ? `${Math.round((s.orderValue / s.target) * 100)}%` : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </ReportShell>
  );
}

// Plan 4 — who we compete with: how often each competitor shows up, how many orders we lost to
// them, and the prices they quoted. Entries come from Order Lost and Customer 360.
export function CompetitorAnalysisReport({ competitors = [] }) {
  const rows = useMemo(() => {
    const m = new Map();
    for (const c of competitors) {
      const key = c.competitor.trim().toLowerCase();
      if (!m.has(key)) m.set(key, { name: c.competitor.trim(), seen: 0, lost: 0, prices: [], products: new Set(), customers: new Set() });
      const r = m.get(key);
      r.seen++; if (c.lost_to) r.lost++;
      if (c.price != null) r.prices.push(Number(c.price));
      if (c.product) r.products.add(c.product);
      if (c.customer_name || c.lead_name) r.customers.add(c.customer_name || c.lead_name);
    }
    return [...m.values()].map(r => ({ ...r, avgPrice: r.prices.length ? Math.round(r.prices.reduce((a, b) => a + b, 0) / r.prices.length) : null }))
      .sort((a, b) => b.lost - a.lost || b.seen - a.seen);
  }, [competitors]);
  return (
    <ReportShell title="Competitor Analysis" description="Competitors recorded on enquiries (Order Lost → Lost to competitor) and on customers (Customer 360). Names are grouped regardless of capitals.">
      <Kpis items={[['Competitors', rows.length], ['Entries', competitors.length], ['Orders lost to a competitor', competitors.filter(c => c.lost_to).length]]} />
      <Chart title="Orders lost, by competitor"><BarList items={rows.filter(r => r.lost).map(r => ({ label: r.name, value: r.lost }))} /></Chart>
      <div data-export-title="Competitors">
        <Table>
          <TableHeader><TableRow>{['Competitor', 'Times seen', 'Orders lost to them', 'Average price', 'Products', 'Customers'].map(h => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No competitors recorded yet.</TableCell></TableRow> : rows.map(r => (
              <TableRow key={r.name}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="tnum">{r.seen}</TableCell>
                <TableCell className="tnum">{r.lost}</TableCell>
                <TableCell className="tnum" data-raw={r.avgPrice ?? ''}>{r.avgPrice == null ? '—' : formatMoney(r.avgPrice)}</TableCell>
                <TableCell>{[...r.products].join(', ') || '—'}</TableCell>
                <TableCell>{[...r.customers].join(', ') || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </ReportShell>
  );
}
