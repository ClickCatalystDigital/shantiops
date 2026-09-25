'use client';

// components/SalesCallReportPanels.jsx — Sales CRM expansion Phase 5, the 13 "Enquiry Analysis
// Management Report" + follow-up/feedback/expense reports. Same hasOwnControls shape as
// CrmReportPanels.jsx's 6 analytics reports — client-rendered off the crmData fetch
// app/reports/page.js's getCrmData() already widened for this phase, no new per-report query.
import { personKey, personLabel } from '@/lib/sales-people.mjs';
import { funnelRows } from '@/lib/lead-stage.mjs';
import { useMemo, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { formatMoney } from '@/lib/format';
import { todayMonth } from '@/lib/date';
import { BarList, StatRow, ReportShell } from '@/components/ReportKit';

const NEGLECTED_DAYS = 14; // "still hasn't been followed up in N days" threshold

function monthBounds(ym) {
  const [y, m] = ym.split('-').map(Number);
  const from = `${ym}-01`;
  const to = new Date(y, m, 0).toISOString().slice(0, 10);
  return [from, to];
}
function inRange(dateStr, from, to) {
  return !!dateStr && dateStr >= from && dateStr <= to;
}
function firmStageSortOrder(stages) {
  return stages.find(s => s.name === 'Proposals')?.sort_order ?? 3;
}
function stageSortOrder(stages, name) {
  return stages.find(s => s.name === name)?.sort_order ?? -1;
}

function MonthPicker({ value, onChange }) {
  return <Input type="month" className="w-40" value={value} onChange={e => onChange(e.target.value)} />;
}

// --- 1. Sales Call Prospect Summary Report -------------------------------------------------------

export function SalesCallProspectSummaryReport({ leads, diaryNotes, salesTargets, expenseClaims, saleOrders, branches, stages, users = [] }) {
  // Plan 1i — managers matched by username or display name, legacy text kept as its own row.
  const pk = v => personKey(v, users) || '—';
  const [period, setPeriod] = useState(todayMonth());
  const [from, to] = monthBounds(period);
  const firmSort = firmStageSortOrder(stages);

  const rows = useMemo(() => {
    const groups = new Map(); // key: branch_id|manager
    for (const l of leads) {
      const key = `${l.branch_id || ''}|${pk(l.account_manager || l.assigned_to)}`;
      if (!groups.has(key)) {
        groups.set(key, {
          branchId: l.branch_id, manager: pk(l.account_manager || l.assigned_to),
          prospect: 0, firmProspect: 0, vip: 0, orders: 0,
        });
      }
      const g = groups.get(key);
      if (inRange(l.enquiry_date || l.created_at?.slice(0, 10), from, to)) {
        g.prospect++;
        const sort = stageSortOrder(stages, l.sales_call_status);
        if (sort >= firmSort) g.firmProspect++;
        if (l.is_vip) g.vip++;
      }
    }
    for (const so of saleOrders) {
      if (!inRange(so.order_date || so.created_at?.slice(0, 10), from, to)) continue;
      const key = `${so.branch_id || ''}|${pk(so.sales_person_override)}`;
      const g = groups.get(key);
      if (g) g.orders++;
    }
    const salesCallsByKey = new Map(), appointmentsByKey = new Map(), fUpsByKey = new Map(), actualFUpsByKey = new Map();
    for (const n of diaryNotes) {
      const key = `${n.branch_id || ''}|${pk(n.account_manager)}`;
      if (inRange(n.visit_date || n.created_at?.slice(0, 10), from, to)) salesCallsByKey.set(key, (salesCallsByKey.get(key) || 0) + 1);
      if (inRange(n.plan_date, from, to)) appointmentsByKey.set(key, (appointmentsByKey.get(key) || 0) + 1);
      if (inRange(n.next_plan_date, from, to)) {
        fUpsByKey.set(key, (fUpsByKey.get(key) || 0) + 1);
        // "Actual F/Ups" — an honest approximation (no field links a later diary entry back to the
        // specific planned follow-up it fulfills): counted when a later note's own visit_date falls
        // on/after this one's planned next_plan_date, for the same lead.
        const fulfilled = diaryNotes.some(n2 => n2.lead_id === n.lead_id && n2.visit_date && n2.visit_date >= n.next_plan_date);
        if (fulfilled) actualFUpsByKey.set(key, (actualFUpsByKey.get(key) || 0) + 1);
      }
    }
    const targetsByKey = new Map();
    for (const t of salesTargets) {
      if (t.period !== period) continue;
      targetsByKey.set(`${t.branch_id || ''}|${pk(t.account_manager)}`, t.target_amount);
    }
    // Expenses — company-agnostic on purpose (no direct link between expense_claims and either
    // legal entity), matched to a manager by employee_name (best real signal available).
    const expensesByManager = new Map();
    for (const c of expenseClaims) {
      if (!inRange(c.claim_date, from, to)) continue;
      expensesByManager.set(c.employee_name, (expensesByManager.get(c.employee_name) || 0) + c.total_amount);
    }

    return [...groups.values()].map(g => {
      const key = `${g.branchId || ''}|${g.manager}`;
      const salesCalls = salesCallsByKey.get(key) || 0;
      const orderValue = saleOrders.filter(so => inRange(so.order_date, from, to) && `${so.branch_id || ''}|${pk(so.sales_person_override)}` === key)
        .reduce((s, so) => s + (so.total || 0), 0);
      const target = targetsByKey.get(key) || 0;
      return {
        ...g,
        branchName: branches.find(b => b.id === g.branchId)?.name || '—',
        salesCalls, appointments: appointmentsByKey.get(key) || 0,
        target, ta: target > 0 ? Math.round((orderValue / target) * 100) : null,
        expenses: expensesByManager.get(personLabel(g.manager, users)) || expensesByManager.get(g.manager) || 0,
        fUps: fUpsByKey.get(key) || 0, actualFUps: actualFUpsByKey.get(key) || 0,
        pfpRatio: g.prospect > 0 ? Math.round((g.firmProspect / g.prospect) * 100) : null,
        fpoRatio: g.firmProspect > 0 ? Math.round((g.orders / g.firmProspect) * 100) : null,
      };
    }).filter(r => r.prospect > 0 || r.salesCalls > 0);
  }, [leads, diaryNotes, salesTargets, expenseClaims, saleOrders, branches, from, to, period, firmSort, users]);

  return (
    <ReportShell title="Sales Call Prospect Summary Report"
      description="Actual F/Ups is an honest approximation (no field links a follow-up back to the specific plan it fulfills) — matched by date proximity, not a hard link."
      action={<MonthPicker value={period} onChange={setPeriod} />}>
      <Table>
        <TableHeader><TableRow>
          {['Region', 'Branch', 'A/C Manager', 'Prospect', 'Firm Prospect', 'Sales Calls', 'VIP Prospect', 'Appointments', 'Orders', 'Targets', 'T/A', 'Expenses', 'F/Ups', 'Actual F/Ups', 'P/FP Ratio', 'FP/O Ratio'].map(h => <TableHead key={h}>{h}</TableHead>)}
        </TableRow></TableHeader>
        <TableBody>
          {rows.length === 0 ? <TableRow><TableCell colSpan={16} className="text-center text-sm text-muted-foreground">No data for this period.</TableCell></TableRow> : rows.map((r, i) => (
            <TableRow key={i}>
              <TableCell>{branches.find(b => b.id === r.branchId)?.region || '—'}</TableCell>
              <TableCell>{r.branchName}</TableCell>
              <TableCell>{personLabel(r.manager, users)}</TableCell>
              <TableCell className="tnum">{r.prospect}</TableCell>
              <TableCell className="tnum">{r.firmProspect}</TableCell>
              <TableCell className="tnum">{r.salesCalls}</TableCell>
              <TableCell className="tnum">{r.vip}</TableCell>
              <TableCell className="tnum">{r.appointments}</TableCell>
              <TableCell className="tnum">{r.orders}</TableCell>
              <TableCell className="tnum" data-raw={r.target || 0}>{r.target ? formatMoney(r.target) : '—'}</TableCell>
              <TableCell className="tnum">{r.ta == null ? '—' : `${r.ta}%`}</TableCell>
              <TableCell className="tnum" data-raw={r.expenses || 0}>{r.expenses ? formatMoney(r.expenses) : '—'}</TableCell>
              <TableCell className="tnum">{r.fUps}</TableCell>
              <TableCell className="tnum">{r.actualFUps}</TableCell>
              <TableCell className="tnum">{r.pfpRatio == null ? '—' : `${r.pfpRatio}%`}</TableCell>
              <TableCell className="tnum">{r.fpoRatio == null ? '—' : `${r.fpoRatio}%`}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ReportShell>
  );
}

// --- 2. Date-wise sales call -----------------------------------------------------------------------

export function DateWiseSalesCallReport({ leads }) {
  const items = useMemo(() => {
    const counts = new Map();
    for (const l of leads) {
      const d = l.enquiry_date || l.created_at?.slice(0, 10);
      if (!d) continue;
      counts.set(d, (counts.get(d) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 60).map(([label, value]) => ({ label, value }));
  }, [leads]);
  return (
    <ReportShell title="Date-wise Sales Call" description="Enquiries logged per day (most recent 60 days shown).">
      <BarList items={items} />
    </ReportShell>
  );
}

// --- 3. Location-wise sales call -------------------------------------------------------------------

export function LocationWiseSalesCallReport({ leads, branches }) {
  const items = useMemo(() => {
    const counts = new Map();
    for (const l of leads) {
      const label = branches.find(b => b.id === l.branch_id)?.name || l.district || 'Unassigned';
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  }, [leads, branches]);
  return (
    <ReportShell title="Location-wise Sales Call" description="Enquiries by Branch (falls back to District when no Branch is set).">
      <BarList items={items} />
    </ReportShell>
  );
}

// --- 4. Sales call funnel report, with drill-down --------------------------------------------------

export function SalesCallFunnelReport({ leads, stages, salesProducts, quotations = [], diaryNotes = [], users = [] }) {
  const [drill, setDrill] = useState(null); // stage name
  // Plan 3d — Value = Σ expected_value of the stage's enquiries; weighted by the stage's
  // probability (Masters → Funnel Stages, lib/lead-stage.mjs stageProbability).
  const rows = useMemo(() => funnelRows(leads, stages), [leads, stages]);
  const open = rows.filter(r => !r.isWon && !r.isLost);
  const total = { count: rows.reduce((s, r) => s + r.count, 0), value: rows.reduce((s, r) => s + r.value, 0), weighted: rows.reduce((s, r) => s + r.weighted, 0) };
  const openValue = open.reduce((s, r) => s + r.value, 0);
  const forecast = open.reduce((s, r) => s + r.weighted, 0);
  const won = rows.filter(r => r.isWon).reduce((s, r) => s + r.count, 0);
  const lost = rows.filter(r => r.isLost).reduce((s, r) => s + r.count, 0);

  // Latest quotation per enquiry, and its latest Diary note (for the follow-up hover text).
  const latestQuote = useMemo(() => {
    const m = new Map();
    for (const q of quotations) if (q.lead_id && (!m.has(q.lead_id) || q.id > m.get(q.lead_id).id)) m.set(q.lead_id, q);
    return m;
  }, [quotations]);
  const latestNote = useMemo(() => {
    const m = new Map();
    for (const n of diaryNotes) if (n.lead_id && (!m.has(n.lead_id) || n.id > m.get(n.lead_id).id)) m.set(n.lead_id, n);
    return m;
  }, [diaryNotes]);
  const drillRows = drill ? leads.filter(l => l.sales_call_status === drill) : [];
  const productName = l => salesProducts?.find(p => p.id === l.product_id)?.product_type || salesProducts?.find(p => p.id === l.product_id)?.product_name || l.product || '—';

  return (
    <ReportShell title="Sales Call Funnel Report" description="Enquiries by funnel stage, their expected value, and the value weighted by each stage's win probability. Click a count to see the enquiries.">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[['Open enquiries', open.reduce((s, r) => s + r.count, 0)], ['Open value', formatMoney(openValue)], ['Weighted forecast', formatMoney(forecast)], ['Win rate', won + lost ? `${Math.round((won / (won + lost)) * 100)}%` : '—']].map(([label, value]) => (
          <div key={label} className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="text-lg font-semibold tnum">{value}</div></div>
        ))}
      </div>
      <BarList items={rows.filter(r => r.value > 0).map(r => ({ label: r.stage, value: r.value }))} valueFmt={formatMoney} />
      <div data-export-title="Funnel">
        <Table>
          <TableHeader><TableRow>{['S.N.', 'Funnel Stage', 'No of Sales Call', 'Value', 'Probability (%)', 'Probability (Value)'].map(h => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={r.stage}>
                <TableCell>{i + 1}</TableCell>
                <TableCell>{r.stage}</TableCell>
                <TableCell className="tnum" data-raw={r.count}>
                  <button className="text-primary hover:underline disabled:text-muted-foreground disabled:no-underline" disabled={!r.count} onClick={() => setDrill(r.stage)}>{r.count}</button>
                </TableCell>
                <TableCell className="tnum" data-raw={r.value}>{formatMoney(r.value)}</TableCell>
                <TableCell className="tnum" data-raw={r.probability}>{r.probability}%</TableCell>
                <TableCell className="tnum" data-raw={r.weighted}>{formatMoney(r.weighted)}</TableCell>
              </TableRow>
            ))}
            <TableRow className="font-semibold">
              <TableCell colSpan={2}>Total</TableCell>
              <TableCell className="tnum" data-raw={total.count}>{total.count}</TableCell>
              <TableCell className="tnum" data-raw={total.value}>{formatMoney(total.value)}</TableCell>
              <TableCell />
              <TableCell className="tnum" data-raw={total.weighted}>{formatMoney(total.weighted)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <Sheet open={!!drill} onOpenChange={o => !o && setDrill(null)}>
        <SheetContent className="w-full sm:max-w-5xl">
          <SheetHeader><SheetTitle>{drill} — {drillRows.length} enquir{drillRows.length === 1 ? 'y' : 'ies'}</SheetTitle></SheetHeader>
          <div className="overflow-auto px-4 pb-4">
            <Table>
              <TableHeader><TableRow>{['Customer', 'Short name', 'Address', 'Enquiry date', 'Contact', 'Email', 'Product type', 'Stage / latest quote', 'Expected', 'A/C manager'].map(h => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {drillRows.map(l => {
                  const q = latestQuote.get(l.id);
                  const n = latestNote.get(l.id);
                  const tip = n ? [n.visit_date || n.created_at?.slice(0, 10), n.content, n.next_plan_date ? `Next: ${n.next_plan_date}` : ''].filter(Boolean).join(' · ') : 'No Diary entries yet';
                  return (
                    <TableRow key={l.id} title={tip}>
                      <TableCell className="font-medium"><a className="text-primary hover:underline" href={`/sales?tab=leads&highlight=LD-${l.id}`}>{l.company_name || l.lead_name}</a></TableCell>
                      <TableCell>{l.short_name || '—'}</TableCell>
                      <TableCell className="max-w-48 truncate">{l.address || '—'}</TableCell>
                      <TableCell className="tnum whitespace-nowrap">{l.enquiry_date || '—'}</TableCell>
                      <TableCell>{[l.phone, l.telephone].filter(Boolean).join(' · ') || '—'}</TableCell>
                      <TableCell>{l.email || '—'}</TableCell>
                      <TableCell>{productName(l)}</TableCell>
                      <TableCell>{l.sales_call_status}{q ? ` · ${q.quotation_no} ${formatMoney(q.total)}` : ''}</TableCell>
                      <TableCell>{l.order_expected_in || '—'}</TableCell>
                      <TableCell>{personLabel(l.account_manager || l.assigned_to, users) || '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </SheetContent>
      </Sheet>
    </ReportShell>
  );
}

// --- 5. Neglected Sales Call ------------------------------------------------------------------------

export function NeglectedSalesCallReport({ leads, diaryNotes }) {
  const rows = useMemo(() => {
    const lastActivityByLead = new Map();
    for (const n of diaryNotes) {
      const d = n.visit_date || n.created_at?.slice(0, 10);
      if (!d) continue;
      const cur = lastActivityByLead.get(n.lead_id);
      if (!cur || d > cur) lastActivityByLead.set(n.lead_id, d);
    }
    const cutoff = new Date(Date.now() - NEGLECTED_DAYS * 86400000).toISOString().slice(0, 10);
    return leads.filter(l => !l.sales_call_closed_at).map(l => ({ ...l, lastActivity: lastActivityByLead.get(l.id) || l.created_at?.slice(0, 10) }))
      .filter(l => !l.lastActivity || l.lastActivity < cutoff)
      .sort((a, b) => (a.lastActivity || '').localeCompare(b.lastActivity || ''));
  }, [leads, diaryNotes]);
  return (
    <ReportShell title="Neglected Sales Call" description={`Open leads with no logged activity in the last ${NEGLECTED_DAYS} days.`}>
      <Table>
        <TableHeader><TableRow><TableHead>Organization</TableHead><TableHead>A/C Manager</TableHead><TableHead>Sales Call Status</TableHead><TableHead>Last Activity</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground">Nothing neglected right now.</TableCell></TableRow> : rows.map(l => (
            <TableRow key={l.id}><TableCell>{l.company_name || l.lead_name}</TableCell><TableCell>{l.account_manager || l.assigned_to || '—'}</TableCell><TableCell>{l.sales_call_status || '—'}</TableCell><TableCell className="tnum">{l.lastActivity || '—'}</TableCell></TableRow>
          ))}
        </TableBody>
      </Table>
    </ReportShell>
  );
}

// --- 6. Customer Follow up report — customer × 12 months --------------------------------------------

export function CustomerFollowUpReport({ diaryNotes }) {
  const year = new Date().getFullYear();
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const rows = useMemo(() => {
    const byCustomer = new Map();
    for (const n of diaryNotes) {
      const d = n.visit_date || n.created_at?.slice(0, 10);
      if (!d || !d.startsWith(String(year))) continue;
      const key = n.company_name || n.lead_name;
      if (!byCustomer.has(key)) byCustomer.set(key, Array(12).fill(0));
      byCustomer.get(key)[Number(d.slice(5, 7)) - 1]++;
    }
    return [...byCustomer.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [diaryNotes, year]);
  return (
    <ReportShell title="Customer Follow-up Report" description={`Follow-up count per customer, by month, ${year}.`}>
      <Table>
        <TableHeader><TableRow><TableHead>Customer</TableHead>{months.map(m => <TableHead key={m} className="tnum">{m.slice(5)}</TableHead>)}<TableHead className="tnum">Total</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map(([customer, counts]) => (
            <TableRow key={customer}><TableCell>{customer}</TableCell>{counts.map((c, i) => <TableCell key={i} className="tnum">{c || '—'}</TableCell>)}<TableCell className="tnum font-medium">{counts.reduce((a, b) => a + b, 0)}</TableCell></TableRow>
          ))}
        </TableBody>
      </Table>
    </ReportShell>
  );
}

// --- 7/10/11. Feedback reports — one shared table, 3 filtered views -------------------------------

function FeedbackTable({ rows }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Date</TableHead><TableHead>Feedback</TableHead><TableHead>Logged by</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No feedback here yet.</TableCell></TableRow> : rows.map(n => (
          <TableRow key={n.id}>
            <TableCell>{n.company_name || n.lead_name}</TableCell>
            <TableCell className="tnum">{n.visit_date || n.created_at?.slice(0, 10)}</TableCell>
            <TableCell className="max-w-96 truncate">{n.content}</TableCell>
            <TableCell>{n.created_by}</TableCell>
            <TableCell><Badge variant={n.feedback_responded ? 'default' : 'outline'}>{n.feedback_responded ? 'Responded' : 'Not responded'}</Badge></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ClientFeedbackReport({ diaryNotes }) {
  const rows = diaryNotes.filter(n => n.note_type === 'feedback');
  return <ReportShell title="Client Feedback Report" description="Every logged feedback entry."><FeedbackTable rows={rows} /></ReportShell>;
}
export function FeedbackNotRespondedReport({ diaryNotes }) {
  const rows = diaryNotes.filter(n => n.note_type === 'feedback' && !n.feedback_responded);
  return <ReportShell title="Feedback Not Responded By Employee" description="Feedback still waiting on a response."><FeedbackTable rows={rows} /></ReportShell>;
}
export function FeedbackResponseReport({ diaryNotes }) {
  const rows = diaryNotes.filter(n => n.note_type === 'feedback' && n.feedback_responded);
  return <ReportShell title="Feedback Response Report" description="Feedback that's already been responded to."><FeedbackTable rows={rows} /></ReportShell>;
}

// --- 8. SalesCall/Employee Follow up report — A/C Manager × last 30 days ---------------------------

export function EmployeeFollowUpReport({ diaryNotes }) {
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const days = Array.from({ length: 30 }, (_, i) => new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10));
  const rows = useMemo(() => {
    const byManager = new Map();
    for (const n of diaryNotes) {
      const d = n.visit_date || n.created_at?.slice(0, 10);
      if (!d || d < cutoff) continue;
      const key = n.created_by || 'Unassigned';
      if (!byManager.has(key)) byManager.set(key, Object.fromEntries(days.map(x => [x, 0])));
      const bucket = byManager.get(key);
      if (bucket[d] !== undefined) bucket[d]++;
    }
    return [...byManager.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [diaryNotes, cutoff]);
  return (
    <ReportShell title="SalesCall / Employee Follow-up Report" description="Diary activity per A/C Manager, last 30 days.">
      <Table>
        <TableHeader><TableRow><TableHead>A/C Manager</TableHead>{days.map(d => <TableHead key={d} className="tnum">{d.slice(8)}</TableHead>)}<TableHead className="tnum">Total</TableHead><TableHead className="tnum">Average</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map(([manager, bucket]) => {
            const counts = Object.values(bucket);
            const total = counts.reduce((a, b) => a + b, 0);
            return (
              <TableRow key={manager}>
                <TableCell>{manager}</TableCell>
                {counts.map((c, i) => <TableCell key={i} className="tnum">{c || '—'}</TableCell>)}
                <TableCell className="tnum font-medium">{total}</TableCell>
                <TableCell className="tnum">{(total / 30).toFixed(1)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </ReportShell>
  );
}

// --- 9. Quotation Listing Report ---------------------------------------------------------------------

export function QuotationListingReport({ quotations }) {
  return (
    <ReportShell title="Quotation Listing Report" description="Every Commercial Offer / Quotation on file.">
      <Table>
        <TableHeader><TableRow><TableHead>Quotation No</TableHead><TableHead>Customer</TableHead><TableHead>Company</TableHead><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead className="tnum">Total</TableHead></TableRow></TableHeader>
        <TableBody>
          {quotations.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground">No quotations yet.</TableCell></TableRow> : quotations.map(q => (
            <TableRow key={q.id} data-entity-code={`QT-${q.id}`}>
              <TableCell>{q.quotation_no}</TableCell>
              <TableCell>{q.customer_name || '—'}</TableCell>
              <TableCell>{q.company || '—'}</TableCell>
              <TableCell className="tnum">{q.quotation_date || '—'}</TableCell>
              <TableCell>{q.quotation_type || '—'}</TableCell>
              <TableCell><Badge variant={q.status === 'accepted' ? 'default' : 'outline'}>{q.status}</Badge></TableCell>
              <TableCell className="tnum" data-raw={q.total || 0}>{formatMoney(q.total)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ReportShell>
  );
}

// --- 12. Employee wise expense report -----------------------------------------------------------------

export function EmployeeExpenseReport({ expenseClaims }) {
  const rows = useMemo(() => {
    const byEmployee = new Map();
    for (const c of expenseClaims) byEmployee.set(c.employee_name, (byEmployee.get(c.employee_name) || 0) + c.total_amount);
    return [...byEmployee.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  }, [expenseClaims]);
  return (
    <ReportShell title="Employee-wise Expense Report" description="Total submitted expense claims per employee.">
      <StatRow stats={[{ label: 'Total claims', value: expenseClaims.length }, { label: 'Total amount', value: formatMoney(rows.reduce((s, r) => s + r.value, 0)) }]} />
      <BarList items={rows} valueFmt={formatMoney} />
    </ReportShell>
  );
}

// --- 13. Customize Sales Call list report ---------------------------------------------------------

export function SalesCallCustomizeReport({ leads, branches, stages = [] }) {
  // One status column — the funnel stage (docs/sales-crm-plan.md 1a).
  const ALL_COLS = ['Organization', 'Source', 'Sales Call Status', 'Branch', 'A/C Manager', 'Enquiry Date'];
  const [visibleCols, setVisibleCols] = useState(ALL_COLS);
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');

  const rows = leads.filter(l =>
    (status === 'all' || l.sales_call_status === status) &&
    (!q.trim() || (l.company_name || l.lead_name || '').toLowerCase().includes(q.trim().toLowerCase()))
  );

  function toggleCol(c) {
    setVisibleCols(v => v.includes(c) ? v.filter(x => x !== c) : [...v, c]);
  }

  return (
    <ReportShell title="Customize Sales Call List Report" description="Filter and choose which columns to show.">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search organization…" value={q} onChange={e => setQ(e.target.value)} className="w-56" />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All stages</SelectItem>{stages.map(s => <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>)}</SelectContent>
        </Select>
        <div className="flex flex-wrap gap-1.5">
          {ALL_COLS.map(c => (
            <Badge key={c} variant={visibleCols.includes(c) ? 'default' : 'outline'} className="cursor-pointer" onClick={() => toggleCol(c)}>{c}</Badge>
          ))}
        </div>
      </div>
      <Table>
        <TableHeader><TableRow>{visibleCols.map(c => <TableHead key={c}>{c}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          {rows.map(l => (
            <TableRow key={l.id}>
              {visibleCols.includes('Organization') && <TableCell>{l.company_name || l.lead_name}</TableCell>}
              {visibleCols.includes('Source') && <TableCell>{l.source || '—'}</TableCell>}
              {visibleCols.includes('Sales Call Status') && <TableCell>{l.sales_call_status || '—'}</TableCell>}
              {visibleCols.includes('Branch') && <TableCell>{branches.find(b => b.id === l.branch_id)?.name || '—'}</TableCell>}
              {visibleCols.includes('A/C Manager') && <TableCell>{l.account_manager || l.assigned_to || '—'}</TableCell>}
              {visibleCols.includes('Enquiry Date') && <TableCell className="tnum">{l.enquiry_date || '—'}</TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ReportShell>
  );
}
