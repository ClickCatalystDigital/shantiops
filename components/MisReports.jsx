'use client';

// components/MisReports.jsx — the Sales "MIS" report pack (Sales Mantra parity, SYSTEM.md §5dr).
// Same hasOwnControls/crmData shape as SalesInsightReports.jsx; all counting lives in lib/mis.mjs.
// Several report keys share one component (Order Analysis ×4, Daily Work / Movement). Reports that need
// data the Reports page doesn't preload (Selling vs Cost, New Customers, Usage) fetch /api/mis-data.
import { useEffect, useMemo, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { formatMoney, formatDate } from '@/lib/format';
import { todayISO } from '@/lib/date';
import { personLabel } from '@/lib/sales-people.mjs';
import { BarList, ReportShell } from '@/components/ReportKit';
import { Kpis, Chart } from '@/components/SalesInsightReports';
import { amcDue, amcReceived, amcByEngineer } from '@/lib/amc-reports.mjs';
import { ordersBy, winLoss, leadGeneration, callLog, dailyWork, lastContact, funnelAgeing, orderTimeCycle } from '@/lib/mis.mjs';

const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function useRange(days = 180) {
  const today = todayISO();
  const [from, setFrom] = useState(addDays(today, -days));
  const [to, setTo] = useState(today);
  const bar = (extra) => (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1"><Label className="text-xs">From</Label><Input type="date" className="h-8 w-40" value={from} onChange={e => setFrom(e.target.value)} /></div>
      <div className="flex flex-col gap-1"><Label className="text-xs">To</Label><Input type="date" className="h-8 w-40" value={to} onChange={e => setTo(e.target.value)} /></div>
      {extra}
    </div>
  );
  return { from, to, bar };
}

function Toggle({ value, onChange, options }) {
  return (
    <div className="flex gap-1">
      {options.map(([k, label]) => <Button key={k} size="sm" variant={value === k ? 'default' : 'outline'} onClick={() => onChange(k)}>{label}</Button>)}
    </div>
  );
}

function Grid({ title, heads, rows, empty = 'No data in this period.' }) {
  return (
    <div data-export-title={title}>
      <Table>
        <TableHeader><TableRow>{heads.map(h => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          {rows.length === 0 ? <TableRow><TableCell colSpan={heads.length} className="text-center text-muted-foreground">{empty}</TableCell></TableRow> : rows.map((cells, i) => (
            <TableRow key={i}>{cells.map((c, j) => {
              const raw = c && typeof c === 'object' && 'raw' in c;
              return <TableCell key={j} className={j === 0 ? 'font-medium' : 'tnum'} data-raw={raw ? c.raw ?? '' : undefined}>{raw ? c.text : c}</TableCell>;
            })}</TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
const money = v => ({ raw: v, text: formatMoney(v) });
const pct = v => (v == null ? '—' : `${v}%`);

// ── Orders by source / reference / branch / employee ──────────────────────────────────────────────
const BY = {
  source: ['Source Wise Order', 'Source', 'Where the enquiry came from (Enquiry → Source), against the orders that enquiry became. Orders with no enquiry show as "not recorded".'],
  reference: ['Reference Wise Order', 'Reference', 'Who referred the enquiry (Enquiry → Reference), against the orders it became.'],
  branch: ['Branch Wise Order', 'Branch', 'Enquiries and orders per branch.'],
  employee: ['Employee Wise Order', 'Employee', 'Enquiries and orders per account manager / sales person. Cancelled orders are left out.'],
};
function OrderAnalysis({ by, ...data }) {
  const { from, to, bar } = useRange();
  const rows = useMemo(() => ordersBy(by, data, from, to), [by, data.leads, data.saleOrders, data.branches, data.users, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const [title, head, desc] = BY[by];
  const total = rows.reduce((t, r) => ({ orders: t.orders + r.orders, value: t.value + r.value, enquiries: t.enquiries + r.enquiries }), { orders: 0, value: 0, enquiries: 0 });
  return (
    <ReportShell title={title} description={desc}>
      {bar()}
      <Kpis items={[['Enquiries', total.enquiries], ['Orders', total.orders], ['Order value', formatMoney(total.value)], ['Average order', formatMoney(total.orders ? Math.round(total.value / total.orders) : 0)]]} />
      <Chart title={`Order value, by ${head.toLowerCase()}`}><BarList items={rows.filter(r => r.value).slice(0, 10).map(r => ({ label: r.label, value: r.value }))} valueFmt={formatMoney} /></Chart>
      <Grid title={title} heads={[head, 'Enquiries', 'Orders', 'Enquiry → order', 'Order value', 'Average order']}
        rows={rows.map(r => [r.label, r.enquiries, r.orders, pct(r.conversion), money(r.value), money(r.avg)])} />
    </ReportShell>
  );
}
export const SourceWiseOrderReport = p => <OrderAnalysis by="source" {...p} />;
export const ReferenceWiseOrderReport = p => <OrderAnalysis by="reference" {...p} />;
export const BranchWiseOrderReport = p => <OrderAnalysis by="branch" {...p} />;
export const EmployeeWiseOrderReport = p => <OrderAnalysis by="employee" {...p} />;

// ── Win / loss + proposals ────────────────────────────────────────────────────────────────────────
export function WinLossReport(data) {
  const { from, to, bar } = useRange(365);
  const rows = useMemo(() => winLoss(data, from, to), [data.leads, data.stages, data.quotations, data.users, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = rows.reduce((a, r) => ({ won: a.won + r.won, lost: a.lost + r.lost, wv: a.wv + r.wonValue, lv: a.lv + r.lostValue, q: a.q + r.quotes, qa: a.qa + r.accepted }), { won: 0, lost: 0, wv: 0, lv: 0, q: 0, qa: 0 });
  return (
    <ReportShell title="Order Win/Loss Analysis" description="Enquiries won and lost per account manager (by the month the enquiry was logged), and how many sent quotations were accepted. Drafts are not counted as proposals.">
      {bar()}
      <Kpis items={[['Won', t.won], ['Lost', t.lost], ['Win rate', pct(t.won + t.lost ? Math.round((t.won / (t.won + t.lost)) * 100) : null)], ['Won value', formatMoney(t.wv)], ['Lost value', formatMoney(t.lv)], ['Proposals accepted', `${t.qa} of ${t.q}`]]} />
      <Chart title="Won value, by manager"><BarList items={rows.filter(r => r.wonValue).slice(0, 10).map(r => ({ label: r.label, value: r.wonValue }))} valueFmt={formatMoney} /></Chart>
      <Grid title="Win-loss" heads={['Manager', 'Won', 'Won value', 'Lost', 'Lost value', 'Win rate', 'Still open', 'Proposals sent', 'Accepted', 'Proposal rate']}
        rows={rows.map(r => [r.label, r.won, money(r.wonValue), r.lost, money(r.lostValue), pct(r.winRate), r.open, r.quotes, r.accepted, pct(r.quoteRate)])} />
    </ReportShell>
  );
}

// ── Funnel ageing ─────────────────────────────────────────────────────────────────────────────────
export function FunnelAgeingReport({ leads = [], stages = [], stageHistory = [], users = [] }) {
  const today = todayISO();
  const fa = useMemo(() => funnelAgeing(leads, stages, stageHistory, today), [leads, stages, stageHistory, today]);
  return (
    <ReportShell title="Funnel Ageing" description="How long open enquiries have been sitting in their current stage (since the last stage change; enquiries with no history count from when they were last touched). Closed sales calls are left out.">
      <Kpis items={[['Open enquiries', fa.rows.length], ['Over 30 days in a stage', fa.rows.filter(r => r.days > 30).length], ['Over 90 days', fa.rows.filter(r => r.days > 90).length]]} />
      <Grid title="Ageing by stage" heads={['Stage', 'Enquiries', 'Average days', ...fa.bucketLabels]} rows={fa.byStage.map(s => [s.stage, s.count, s.avgDays, ...s.buckets])} />
      <Grid title="Oldest in stage" heads={['Organisation', 'Stage', 'In stage since', 'Days', 'Expected value', 'Manager']}
        rows={fa.rows.slice(0, 200).map(r => [r.org, r.stage, formatDate(r.since), r.days, money(r.value), personLabel(r.manager, users)])} />
    </ReportShell>
  );
}

// ── Order time cycle ──────────────────────────────────────────────────────────────────────────────
export function OrderTimeCycleReport(data) {
  const { from, to, bar } = useRange(365);
  const tc = useMemo(() => orderTimeCycle(data, from, to), [data.leads, data.saleOrders, data.quotations, data.users, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = v => (v == null ? '—' : `${v} days`);
  return (
    <ReportShell title="Order Time Cycle" description="Days from the enquiry (and from the quotation) to the order. Only orders linked to an enquiry or quotation are measured.">
      {bar()}
      <Kpis items={[['Orders measured', tc.rows.length], ['Enquiry → order', d(tc.avgEnquiry)], ['Quotation → order', d(tc.avgQuote)]]} />
      <Grid title="By manager" heads={['Manager', 'Orders', 'Enquiry → order (avg)', 'Quotation → order (avg)']} rows={tc.people.map(p => [p.label, p.orders, d(p.avgEnquiry), d(p.avgQuote)])} />
      <Grid title="Orders" heads={['Order', 'Customer', 'Manager', 'Order date', 'Value', 'Enquiry → order', 'Quotation → order']}
        rows={tc.rows.slice(0, 300).map(r => [r.so_no || `#${r.id}`, r.customer, personLabel(r.manager, data.users), formatDate(r.orderDate), money(r.value), d(r.fromEnquiry), d(r.fromQuote)])} />
    </ReportShell>
  );
}

// ── Lead generation ───────────────────────────────────────────────────────────────────────────────
export function LeadGenerationReport(data) {
  const { from, to, bar } = useRange(180);
  const [by, setBy] = useState('month');
  const rows = useMemo(() => leadGeneration(data, from, to, by), [data.leads, data.users, from, to, by]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = rows.reduce((t, r) => t + r.count, 0);
  return (
    <ReportShell title="Lead Generation" description="New enquiries logged, grouped by month, day, source or who created them.">
      {bar(<Toggle value={by} onChange={setBy} options={[['month', 'Month'], ['day', 'Day'], ['source', 'Source'], ['creator', 'Created by']]} />)}
      <Kpis items={[['Enquiries', total], ['Expected value', formatMoney(rows.reduce((t, r) => t + r.value, 0))]]} />
      <Chart title="Enquiries"><BarList items={rows.slice(by === 'day' ? -30 : 0, by === 'day' ? undefined : 12).map(r => ({ label: r.label, value: r.count }))} /></Chart>
      <Grid title="Lead generation" heads={[by === 'creator' ? 'Created by' : by[0].toUpperCase() + by.slice(1), 'Enquiries', 'Expected value']} rows={rows.map(r => [r.label, r.count, money(r.value)])} />
    </ReportShell>
  );
}

// ── Call log / meetings ───────────────────────────────────────────────────────────────────────────
export function CallLogReport({ diaryNotes = [], users = [] }) {
  const { from, to, bar } = useRange(30);
  const [type, setType] = useState('call');
  const rows = useMemo(() => callLog(diaryNotes, from, to, type), [diaryNotes, from, to, type]);
  const mins = Math.round(rows.reduce((t, r) => t + r.seconds, 0) / 60);
  return (
    <ReportShell title="Call Log" description="Calls, meetings and emails logged in the Diary. Pick the type; 'All' lists every Diary entry. Duration is only there for calls that recorded it.">
      {bar(<Toggle value={type} onChange={setType} options={[['call', 'Calls'], ['meeting', 'Meetings'], ['email', 'Emails'], ['all', 'All']]} />)}
      <Kpis items={[['Entries', rows.length], ['Talk time', mins ? `${mins} min` : '—'], ['People', new Set(rows.map(r => r.by)).size]]} />
      <Grid title="Call log" heads={['Date', 'By', 'Organisation', 'Type', 'Direction', 'Minutes', 'In', 'Out', 'Action taken']}
        rows={rows.slice(0, 500).map(r => [formatDate(r.date), personLabel(r.by, users), r.org, r.kind, r.direction || '—', r.seconds ? Math.round(r.seconds / 60) : '—', r.inTime || '—', r.outTime || '—', r.action.slice(0, 120)])} />
    </ReportShell>
  );
}

// ── Last contact ──────────────────────────────────────────────────────────────────────────────────
export function LastContactReport({ diaryNotes = [], users = [] }) {
  const today = todayISO();
  const [min, setMin] = useState('30');
  const rows = useMemo(() => lastContact(diaryNotes, today).filter(r => r.daysAgo >= Number(min || 0)), [diaryNotes, today, min]);
  return (
    <ReportShell title="Last Contact" description="When each customer / enquiry was last contacted in the Diary, longest-ago first. Use the box to show only those quiet for at least N days.">
      <div className="flex items-end gap-3"><div className="flex flex-col gap-1"><Label className="text-xs">Quiet for at least (days)</Label><Input className="h-8 w-32" type="number" min="0" value={min} onChange={e => setMin(e.target.value)} /></div></div>
      <Kpis items={[['Customers / enquiries', rows.length]]} />
      <Grid title="Last contact" heads={['Organisation', 'Last contact', 'Days ago', 'By', 'What happened']}
        rows={rows.slice(0, 500).map(r => [r.org || '—', formatDate(r.date), r.daysAgo, personLabel(r.by, users), r.action.slice(0, 120)])} />
    </ReportShell>
  );
}

// ── Employee daily work / movement ────────────────────────────────────────────────────────────────
export function DailyWorkReport({ diaryNotes = [], users = [] }) {
  const { from, to, bar } = useRange(14);
  const rows = useMemo(() => dailyWork(diaryNotes, from, to, users), [diaryNotes, from, to, users]);
  return (
    <ReportShell title="Employee Daily Work" description="What each person logged in the Diary each day: entries, organisations covered, first and last time and places visited.">
      {bar()}
      <Kpis items={[['Employee-days', rows.length], ['Diary entries', rows.reduce((t, r) => t + r.entries, 0)]]} />
      <Grid title="Daily work" heads={['Date', 'Employee', 'Entries', 'Organisations', 'First in', 'Last out', 'Places']}
        rows={rows.slice(0, 500).map(r => [formatDate(r.date), r.label, r.entries, r.orgs.join(', ') || '—', r.first || '—', r.last || '—', r.places.join(', ') || '—'])} />
    </ReportShell>
  );
}

export function EmployeeMovementReport({ diaryNotes = [], users = [] }) {
  const { from, to, bar } = useRange(14);
  const rows = useMemo(() => callLog(diaryNotes, from, to, 'all').filter(r => r.location || r.inTime), [diaryNotes, from, to]);
  return (
    <ReportShell title="Employee Movement" description="Visits from the Diary: where each person was, with the in / out times they entered. This is a visit log, not GPS tracking.">
      {bar()}
      <Kpis items={[['Visits', rows.length], ['Places', new Set(rows.map(r => r.location).filter(Boolean)).size]]} />
      <Grid title="Movement" heads={['Date', 'Employee', 'Place', 'Organisation', 'In', 'Out']}
        rows={rows.slice(0, 500).map(r => [formatDate(r.date), personLabel(r.by, users), r.location || '—', r.org, r.inTime || '—', r.outTime || '—'])} />
    </ReportShell>
  );
}

// ── Reports that fetch their own data (/api/mis-data) ─────────────────────────────────────────────
function useMisData(what, query = '') {
  const [state, setState] = useState({ rows: null, error: null });
  useEffect(() => {
    let live = true;
    setState({ rows: null, error: null });
    fetch(`/api/mis-data?what=${what}${query}`).then(async r => { const j = await r.json(); if (live) setState(r.ok ? { rows: j, error: null } : { rows: [], error: j.error || 'Could not load' }); })
      .catch(() => live && setState({ rows: [], error: 'Could not load' }));
    return () => { live = false; };
  }, [what, query]);
  return state;
}
const Loading = ({ s }) => (s.rows === null ? <p className="text-sm text-muted-foreground">Loading…</p> : s.error ? <p className="text-sm text-destructive">{s.error}</p> : null);

export function SellingVsCostReport() {
  const s = useMisData('prices');
  const rows = (s.rows || []).map(p => {
    const base = p.sold_rate ?? p.quoted_rate ?? p.price;
    const margin = p.cost_price && base ? Math.round(((base - p.cost_price) / base) * 1000) / 10 : null;
    return { ...p, base, margin };
  });
  const withCost = rows.filter(r => r.cost_price).length;
  return (
    <ReportShell title="Selling vs Cost Price" description="List price, cost price and what the company has actually quoted and sold each product for. Margin uses the sold rate, else the quoted rate, else the list price. Sales Head only.">
      <Loading s={s} />
      <Kpis items={[['Products', rows.length], ['With a cost price', withCost], ['Sold at least once', rows.filter(r => r.sold_qty).length]]} />
      {rows.length > 0 && withCost === 0 && <p className="text-sm text-muted-foreground">No product has a cost price yet — add it under Masters → Products and margins appear here.</p>}
      <Grid title="Selling vs cost" heads={['Product', 'List price', 'Cost price', 'Avg quoted', 'Avg sold', 'Qty sold', 'Margin']}
        rows={rows.slice(0, 600).map(r => [`${r.product_name}${r.product_code ? ` (${r.product_code})` : ''}`, money(r.price), money(r.cost_price), money(r.quoted_rate && Math.round(r.quoted_rate)), money(r.sold_rate && Math.round(r.sold_rate)), r.sold_qty ?? '—', { raw: r.margin, text: r.margin == null ? '—' : `${r.margin}%` }])} />
    </ReportShell>
  );
}

export function NewCustomersReport() {
  const { from, to, bar } = useRange(90);
  const s = useMisData('customers', `&from=${from}&to=${to}`);
  const rows = s.rows || [];
  return (
    <ReportShell title="New Customer Added" description="Customers added in this period. The one-time old-CRM bulk load is not counted here.">
      {bar()}
      <Loading s={s} />
      <Kpis items={[['New customers', rows.length]]} />
      <Grid title="New customers" heads={['Added', 'Customer', 'Code', 'District', 'Phone', 'Account manager', 'Source']}
        rows={rows.map(r => [formatDate(r.created_at), r.name, r.party_code || '—', r.district || '—', r.phone || '—', r.account_manager || '—', r.source || '—'])} />
    </ReportShell>
  );
}

export function EmployeeUsageReport() {
  const s = useMisData('usage');
  const rows = s.rows || [];
  return (
    <ReportShell title="Employee Usage" description="Last sign-in and activity in the last 30 days for each Sales / Marketing user. Only the latest sign-in is kept (no history). Sales Head only.">
      <Loading s={s} />
      <Kpis items={[['Users', rows.length], ['Signed in last 7 days', rows.filter(r => r.last_login && Date.now() - Date.parse(String(r.last_login).replace(' ', 'T') + 'Z') < 7 * 86400000).length]]} />
      <Grid title="Usage" heads={['User', 'Active', 'Last sign-in', 'Last Diary entry', 'Diary entries (30d)', 'Enquiries created (30d)', 'Stage changes (30d)']}
        rows={rows.map(r => [r.display_name || r.username, r.active ? 'Yes' : 'No', r.last_login ? formatDate(r.last_login) : 'Never', r.last_diary ? formatDate(r.last_diary) : '—', r.diary_30d, r.leads_30d, r.stage_changes_30d])} />
    </ReportShell>
  );
}

// AMC Profitability is added with the AMC tab (Part B-4).
export function AmcProfitabilityReport() {
  const s = useMisData('amc');
  const rows = s.rows || [];
  const t = rows.reduce((a, r) => ({ v: a.v + (r.contract_value || 0), rec: a.rec + (r.received_value || 0), c: a.c + (r.cost || 0) }), { v: 0, rec: 0, c: 0 });
  return (
    <ReportShell title="AMC Profitability" description="For each AMC contract: contract value, amount received, cost booked against it, and profit (received less cost). Cost entries are added on the AMC tab.">
      <Loading s={s} />
      <Kpis items={[['Contracts', rows.length], ['Contract value', formatMoney(t.v)], ['Received', formatMoney(t.rec)], ['Cost', formatMoney(t.c)], ['Profit so far', formatMoney(t.rec - t.c)]]} />
      <Grid title="AMC profitability" heads={['Contract', 'Customer', 'Status', 'Start', 'End', 'Value', 'Received', 'Cost', 'Profit']}
        rows={rows.map(r => [r.contract_no, r.customer_name || '—', r.status, formatDate(r.start_date), formatDate(r.end_date), money(r.contract_value), money(r.received_value), money(r.cost), money((r.received_value || 0) - (r.cost || 0))])} />
    </ReportShell>
  );
}

// ── AMC money reports (2026-10-02): Customer Wise Monthly AMC Due / Received, Service Engineer wise AMC Received ──
// One data call (/api/mis-data?what=amc_money); sums in lib/amc-reports.mjs. Months are YYYY-MM.
function useAmcMonths(defFrom, defTo) {
  const s = useMisData('amc_money');
  const [from, setFrom] = useState(defFrom), [to, setTo] = useState(defTo);
  const controls = (
    <div className="flex flex-wrap items-end gap-2">
      <div className="grid gap-1"><Label className="text-xs">From month</Label><Input type="month" className="h-8 w-40" value={from} onChange={e => setFrom(e.target.value)} /></div>
      <div className="grid gap-1"><Label className="text-xs">To month</Label><Input type="month" className="h-8 w-40" value={to} onChange={e => setTo(e.target.value)} /></div>
    </div>
  );
  const data = s.rows && !Array.isArray(s.rows) ? s.rows : { contracts: [], receipts: [] };
  return { s, from, to, controls, data };
}
const monthAhead = n => { const d = new Date(); d.setMonth(d.getMonth() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const monthLabel = m => (m ? formatDate(`${m}-01`).replace(/^\d+\s/, '') : '—');

export function AmcDueReport() {
  const { s, from, to, controls, data } = useAmcMonths(monthAhead(0), monthAhead(11));
  const r = useMemo(() => amcDue(data.contracts, { from, to }), [data, from, to]);
  return (
    <ReportShell title="Customer Wise Monthly AMC Due Report" action={controls}
      description="AMC contracts that end in the months chosen — what each is worth, what has been received, and the balance still to collect. Follows the company selector at the top.">
      <Loading s={s} />
      <Kpis items={[['Contracts due', r.rows.length], ['Contract value', formatMoney(r.totals.value)], ['Received', formatMoney(r.totals.received)], ['To collect', formatMoney(r.totals.balance)]]} />
      <Grid title="AMC due" heads={['Month', 'Customer', 'Contract', 'Ends', 'Status', 'Value', 'Received', 'Balance']}
        rows={r.rows.map(x => [monthLabel(x.month), x.customer, x.contract_no, formatDate(x.end_date), x.status, money(x.value), money(x.received), money(x.balance)])} />
    </ReportShell>
  );
}

export function AmcReceivedReport() {
  const { s, from, to, controls, data } = useAmcMonths(monthAhead(-11), monthAhead(0));
  const r = useMemo(() => amcReceived(data.contracts, data.receipts, { from, to }), [data, from, to]);
  return (
    <ReportShell title="Customer Wise Monthly AMC Received Report" action={controls}
      description="Money received against AMC contracts, by month and customer, from the dated receipts logged on each contract. Follows the company selector at the top.">
      <Loading s={s} />
      <Kpis items={[['Received in period', formatMoney(r.total)], ['Receipts', r.rows.reduce((t, x) => t + x.receipts, 0)]]} />
      <Grid title="AMC received" heads={['Month', 'Customer', 'Receipts', 'Amount']}
        rows={r.rows.map(x => [monthLabel(x.month), x.customer, x.receipts, money(x.amount)])} />
      {r.undated > 0 && <p className="mt-2 text-xs text-muted-foreground">{formatMoney(r.undated)} was received on older contracts before dated receipts were logged — it has no month, so it is not in the table. Log receipts on the AMC tab to include new money.</p>}
    </ReportShell>
  );
}

export function AmcEngineerReport() {
  const { s, from, to, controls, data } = useAmcMonths(monthAhead(-11), monthAhead(0));
  const r = useMemo(() => amcByEngineer(data.contracts, data.receipts, { from, to }), [data, from, to]);
  return (
    <ReportShell title="Service Engineer wise AMC Received Performance Report" action={controls}
      description="For each service engineer: money collected in the months chosen (by who took the receipt, else the contract's engineer), and the active contracts they look after with the balance outstanding.">
      <Loading s={s} />
      <Kpis items={[['Collected in period', formatMoney(r.total)], ['Engineers', r.rows.length]]} />
      <Grid title="AMC by service engineer" heads={['Service engineer', 'Receipts', 'Collected', 'Active contracts', 'Contract value', 'Received to date', 'Outstanding']}
        rows={r.rows.map(x => [x.engineer, x.receipts, money(x.collected), x.contracts, money(x.value), money(x.received), money(x.balance)])} />
    </ReportShell>
  );
}
