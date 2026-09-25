// lib/sales-insights.mjs — Sales CRM plan 3c/3e. Pure aggregation for Employee Performance 360 and
// Sales Overview, over the same rows the Reports page already loads (leads, diary notes,
// quotations, sale orders, targets, expenses, stage history). No DB import; selfcheck in
// lib/sales-insights-selfcheck.mjs.
//
// Who a record belongs to (plan 1i keys — a username, or a legacy name kept as its own key):
//   enquiry   → A/C manager, else assignee, else creator
//   quotation → its enquiry's owner, else whoever created it
//   order     → Sales Person on the order, else its enquiry's owner, else the legacy sales_person text
//   diary     → whoever wrote it (planned follow-ups: the "Plan of Action for" person, else the writer)
import { personKey } from './sales-people.mjs';
import { avgDaysInStage } from './lead-stage.mjs';

const d10 = s => (s ? String(s).slice(0, 10) : '');
const inMonths = (date, from, to) => { const m = d10(date).slice(0, 7); return !!m && m >= from && m <= to; };

export function monthsBetween(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while ((y < ty || (y === ty && m <= tm)) && out.length < 60) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

export function addMonths(ym, n) {
  let [y, m] = ym.split('-').map(Number);
  m += n;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

// Monday of the week a date falls in (YYYY-MM-DD).
export function weekOf(date) {
  const d = new Date(`${d10(date)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function owners(data) {
  const { leads = [], users = [] } = data;
  const leadOwner = new Map(leads.map(l => [l.id, personKey(l.account_manager || l.assigned_to || l.created_by, users)]));
  return {
    lead: l => leadOwner.get(l.id) || null,
    quotation: q => (q.lead_id && leadOwner.get(q.lead_id)) || personKey(q.created_by, users),
    order: so => personKey(so.sales_person_override, users) || (so.lead_id && leadOwner.get(so.lead_id)) || personKey(so.sales_person, users),
    note: n => personKey(n.created_by, users),
    plan: n => personKey(n.plan_for || n.created_by, users),
  };
}

const blank = () => ({
  enquiries: 0, salesCalls: 0, plannedFollowups: 0, actualFollowups: 0,
  quotations: 0, quotationValue: 0, orders: 0, orderValue: 0, won: 0, lost: 0,
  target: 0, expenses: 0, leadIds: [],
});

// Metrics per person for months [from, to]. Returns Map(personKey → metrics).
export function employeeMetrics(data, from, to) {
  const { leads = [], diaryNotes = [], quotations = [], saleOrders = [], salesTargets = [], expenseClaims = [], stages = [], stageHistory = [], users = [] } = data;
  const own = owners(data);
  const won = new Set(stages.filter(s => s.is_won).map(s => s.name));
  const lost = new Set(stages.filter(s => s.is_lost).map(s => s.name));
  const out = new Map();
  const get = k => { if (!out.has(k)) out.set(k, blank()); return out.get(k); };

  for (const l of leads) {
    const k = own.lead(l);
    if (!k || !inMonths(l.enquiry_date || l.created_at, from, to)) continue;
    const m = get(k);
    m.enquiries++; m.leadIds.push(l.id);
    if (won.has(l.sales_call_status)) m.won++;
    if (lost.has(l.sales_call_status)) m.lost++;
  }
  for (const n of diaryNotes) {
    const k = own.note(n);
    if (k && inMonths(n.visit_date || n.created_at, from, to)) get(k).salesCalls++;
    const p = own.plan(n);
    if (p && n.next_plan_date && inMonths(n.next_plan_date, from, to)) {
      const m = get(p);
      m.plannedFollowups++;
      // Same honest approximation as the Prospect Summary: fulfilled when a later note on the same
      // enquiry is dated on/after the planned date.
      if (diaryNotes.some(n2 => n2.lead_id === n.lead_id && n2.id !== n.id && n2.visit_date && n2.visit_date >= n.next_plan_date)) m.actualFollowups++;
    }
  }
  for (const q of quotations) {
    const k = own.quotation(q);
    if (!k || q.status === 'draft' || !inMonths(q.quotation_date || q.created_at, from, to)) continue;
    const m = get(k); m.quotations++; m.quotationValue += Number(q.total) || 0;
  }
  for (const so of saleOrders) {
    const k = own.order(so);
    if (!k || so.status === 'cancelled' || !inMonths(so.order_date || so.created_at, from, to)) continue;
    const m = get(k); m.orders++; m.orderValue += Number(so.total) || 0;
  }
  for (const t of salesTargets) {
    const k = personKey(t.account_manager, users);
    if (k && t.period >= from && t.period <= to) get(k).target += Number(t.target_amount) || 0;
  }
  for (const c of expenseClaims) {
    const k = personKey(c.employee_name, users);
    if (k && out.has(k) && inMonths(c.claim_date, from, to)) out.get(k).expenses += Number(c.total_amount) || 0;
  }
  for (const [, m] of out) {
    const ids = new Set(m.leadIds);
    const days = Object.values(avgDaysInStage(stageHistory.filter(h => ids.has(h.lead_id))));
    m.avgDaysPerStage = days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null;
    m.winRate = m.won + m.lost ? Math.round((m.won / (m.won + m.lost)) * 100) : null;
    m.achievement = m.target > 0 ? Math.round((m.orderValue / m.target) * 100) : null;
    m.costPerOrder = m.orders ? Math.round(m.expenses / m.orders) : null;
    delete m.leadIds;
  }
  return out;
}

// Per-month series for one person (null = everyone): orders value vs target, enquiry count.
export function monthlySeries(data, from, to, person = null) {
  const { leads = [], saleOrders = [], salesTargets = [], quotations = [], users = [] } = data;
  const own = owners(data);
  const hit = k => person == null || k === person;
  return monthsBetween(from, to).map(month => ({
    month,
    enquiries: leads.filter(l => hit(own.lead(l)) && inMonths(l.enquiry_date || l.created_at, month, month)).length,
    quotations: quotations.filter(q => q.status !== 'draft' && hit(own.quotation(q)) && inMonths(q.quotation_date || q.created_at, month, month)).length,
    orders: saleOrders.filter(so => so.status !== 'cancelled' && hit(own.order(so)) && inMonths(so.order_date || so.created_at, month, month)).length,
    orderValue: saleOrders.filter(so => so.status !== 'cancelled' && hit(own.order(so)) && inMonths(so.order_date || so.created_at, month, month)).reduce((s, so) => s + (Number(so.total) || 0), 0),
    target: salesTargets.filter(t => t.period === month && hit(personKey(t.account_manager, users))).reduce((s, t) => s + (Number(t.target_amount) || 0), 0),
  }));
}

// Diary activity per week (calls written + follow-ups planned), for one person or everyone.
export function weeklyActivity(data, from, to, person = null) {
  const own = owners(data);
  const counts = new Map();
  for (const n of data.diaryNotes || []) {
    const k = own.note(n);
    const date = n.visit_date || n.created_at;
    if ((person != null && k !== person) || !inMonths(date, from, to)) continue;
    const w = weekOf(date);
    if (w) counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([week, value]) => ({ week, value }));
}
