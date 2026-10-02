// lib/mis.mjs — pure aggregation for the Sales "MIS" report pack (SYSTEM.md §5dr). Works on rows the
// Reports page already loads (leads, orders, quotations, diary notes, stage history), so there is no
// new query. No DB import; selfcheck in lib/mis-selfcheck.mjs.
import { owners } from './sales-insights.mjs';
import { personLabel } from './sales-people.mjs';
import { isClosedCall, leadStateForStage } from './lead-stage.mjs';

const d10 = s => (s ? String(s).slice(0, 10) : '');
const inRange = (date, from, to) => { const d = d10(date); return !!d && (!from || d >= from) && (!to || d <= to); };
const ms = s => Date.parse(String(s).replace(' ', 'T'));
const daysBetween = (a, b) => Math.round((ms(b) - ms(a)) / 86400000);
const NONE = '(not recorded)';

// Orders grouped by source / reference / branch / employee. Cancelled orders are left out.
// Enquiries are counted per the same key so the table can show enquiries → orders.
export function ordersBy(by, data, from, to) {
  const { leads = [], saleOrders = [], branches = [], users = [] } = data;
  const own = owners(data);
  const leadById = new Map(leads.map(l => [l.id, l]));
  const branchName = id => branches.find(b => Number(b.id) === Number(id))?.name || NONE;
  const keyOfLead = l => (by === 'source' ? l.source : by === 'reference' ? l.reference : by === 'branch' ? (l.branch_id ? branchName(l.branch_id) : '') : own.lead(l)) || NONE;
  const keyOfOrder = so => {
    const l = so.lead_id ? leadById.get(so.lead_id) : null;
    if (by === 'employee') return own.order(so) || NONE;
    if (by === 'branch') return so.branch_id ? branchName(so.branch_id) : (l?.branch_id ? branchName(l.branch_id) : NONE);
    return (l && (by === 'source' ? l.source : l.reference)) || NONE;
  };
  const m = new Map();
  const row = k => { if (!m.has(k)) m.set(k, { key: k, enquiries: 0, orders: 0, value: 0 }); return m.get(k); };
  for (const l of leads) if (inRange(l.enquiry_date || l.created_at, from, to)) row(keyOfLead(l)).enquiries++;
  for (const so of saleOrders) {
    if (so.status === 'cancelled' || !inRange(so.order_date || so.created_at, from, to)) continue;
    const r = row(keyOfOrder(so)); r.orders++; r.value += Number(so.total) || 0;
  }
  return [...m.values()]
    .map(r => ({ ...r, label: by === 'employee' ? personLabel(r.key, users) : r.key, avg: r.orders ? Math.round(r.value / r.orders) : 0, conversion: r.enquiries ? Math.round((r.orders / r.enquiries) * 100) : null }))
    .sort((a, b) => b.value - a.value || b.orders - a.orders);
}

// Won / lost enquiries per employee (by the enquiry's own month), plus quotation → order proposals.
export function winLoss(data, from, to) {
  const { leads = [], stages = [], quotations = [], users = [] } = data;
  const own = owners(data);
  const state = n => leadStateForStage(stages, n);
  const m = new Map();
  const row = k => { if (!m.has(k)) m.set(k, { key: k, won: 0, wonValue: 0, lost: 0, lostValue: 0, open: 0, quotes: 0, accepted: 0 }); return m.get(k); };
  for (const l of leads) {
    if (!inRange(l.enquiry_date || l.created_at, from, to)) continue;
    const r = row(own.lead(l) || NONE); const s = state(l.sales_call_status); const v = Number(l.expected_value) || 0;
    if (s === 'won') { r.won++; r.wonValue += v; } else if (s === 'lost') { r.lost++; r.lostValue += v; } else r.open++;
  }
  for (const q of quotations) {
    if (q.status === 'draft' || !inRange(q.quotation_date || q.created_at, from, to)) continue;
    const r = row(own.quotation(q) || NONE); r.quotes++; if (q.status === 'accepted') r.accepted++;
  }
  return [...m.values()].map(r => ({ ...r, label: personLabel(r.key, users), winRate: r.won + r.lost ? Math.round((r.won / (r.won + r.lost)) * 100) : null, quoteRate: r.quotes ? Math.round((r.accepted / r.quotes) * 100) : null }))
    .sort((a, b) => b.wonValue - a.wonValue || b.won - a.won);
}

// Enquiries created, grouped by day / month / source / creator.
export function leadGeneration(data, from, to, by = 'month') {
  const { leads = [], users = [] } = data;
  const m = new Map();
  for (const l of leads) {
    const d = d10(l.enquiry_date || l.created_at);
    if (!inRange(d, from, to)) continue;
    const k = by === 'day' ? d : by === 'month' ? d.slice(0, 7) : by === 'source' ? (l.source || NONE) : (l.created_by || l.initiated_by || NONE);
    const r = m.get(k) || { key: k, count: 0, value: 0 }; r.count++; r.value += Number(l.expected_value) || 0; m.set(k, r);
  }
  const rows = [...m.values()].map(r => ({ ...r, label: by === 'creator' ? personLabel(r.key, users) : r.key }));
  return by === 'day' || by === 'month' ? rows.sort((a, b) => a.key.localeCompare(b.key)) : rows.sort((a, b) => b.count - a.count);
}

const noteDate = n => d10(n.visit_date || n.created_at);
const isCall = n => n.note_type === 'call' || n.plan_note_type === 'call' || n.call_type === 'incoming' || n.call_type === 'outgoing';

// Diary entries as a log. type: 'call' | 'meeting' | 'email' | 'all'.
export function callLog(diaryNotes, from, to, type = 'call') {
  return diaryNotes.filter(n => inRange(noteDate(n), from, to) && (type === 'all' || (type === 'call' ? isCall(n) : n.note_type === type || n.plan_note_type === type)))
    .map(n => ({ id: n.id, date: noteDate(n), by: n.created_by || '', org: n.company_name || '', location: n.location || '', kind: n.note_type || '', direction: n.call_type || '', seconds: Number(n.duration_seconds) || 0, inTime: n.in_time || '', outTime: n.out_time || '', action: n.action_taken || n.content || '' }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

// Employee × day: entries, organisations, first/last time, places visited (no GPS — the Diary's own location field).
export function dailyWork(diaryNotes, from, to, users = []) {
  const m = new Map();
  for (const n of diaryNotes) {
    const date = noteDate(n);
    if (!inRange(date, from, to) || !n.created_by) continue;
    const k = `${n.created_by}|${date}`;
    const r = m.get(k) || { by: n.created_by, date, entries: 0, orgs: new Set(), places: new Set(), first: '', last: '' };
    r.entries++; if (n.company_name) r.orgs.add(n.company_name); if (n.location) r.places.add(n.location);
    if (n.in_time && (!r.first || n.in_time < r.first)) r.first = n.in_time;
    if (n.out_time && n.out_time > r.last) r.last = n.out_time;
    m.set(k, r);
  }
  return [...m.values()].map(r => ({ ...r, label: personLabel(r.by, users), orgs: [...r.orgs], places: [...r.places] }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.label.localeCompare(b.label));
}

// Latest contact per customer / enquiry, oldest contact first.
export function lastContact(diaryNotes, today) {
  const m = new Map();
  for (const n of diaryNotes) {
    const k = n.customer_id ? `c${n.customer_id}` : n.lead_id ? `l${n.lead_id}` : null;
    const d = noteDate(n);
    if (!k || !d) continue;
    const cur = m.get(k);
    if (!cur || d > cur.date) m.set(k, { key: k, org: n.company_name || '', date: d, by: n.created_by || '', action: n.action_taken || n.content || '' });
  }
  return [...m.values()].map(r => ({ ...r, daysAgo: daysBetween(r.date, today) })).sort((a, b) => b.daysAgo - a.daysAgo);
}

const BUCKETS = [['0-7 days', 7], ['8-30 days', 30], ['31-90 days', 90], ['Over 90 days', Infinity]];

// Funnel ageing: how long open enquiries have sat in their current stage (since the last stage change, else creation).
export function funnelAgeing(leads, stages, stageHistory, today) {
  const lastChange = new Map();
  for (const h of stageHistory) {
    const cur = lastChange.get(h.lead_id);
    if (!cur || String(h.changed_at) > cur) lastChange.set(h.lead_id, String(h.changed_at));
  }
  const rows = [];
  for (const l of leads) {
    if (isClosedCall(l, stages) || leadStateForStage(stages, l.sales_call_status) !== 'open') continue;
    const since = d10(lastChange.get(l.id) || l.updated_at || l.enquiry_date || l.created_at);
    if (!since) continue;
    rows.push({ id: l.id, org: l.company_name, stage: l.sales_call_status, since, days: Math.max(0, daysBetween(since, today)), value: Number(l.expected_value) || 0, manager: l.account_manager || l.assigned_to || '' });
  }
  const order = [...stages].sort((a, b) => a.sort_order - b.sort_order).map(s => s.name);
  const byStage = order.map(stage => {
    const r = rows.filter(x => x.stage === stage);
    const b = BUCKETS.map(([label, max], i) => r.filter(x => x.days <= max && (i === 0 || x.days > BUCKETS[i - 1][1])).length);
    return { stage, count: r.length, avgDays: r.length ? Math.round((r.reduce((t, x) => t + x.days, 0) / r.length) * 10) / 10 : 0, buckets: b };
  }).filter(s => s.count);
  return { byStage, rows: rows.sort((a, b) => b.days - a.days), bucketLabels: BUCKETS.map(b => b[0]) };
}

// Order time cycle: days from enquiry (and from quotation) to the order, per employee.
export function orderTimeCycle(data, from, to) {
  const { leads = [], saleOrders = [], quotations = [], users = [] } = data;
  const own = owners(data);
  const leadById = new Map(leads.map(l => [l.id, l]));
  const qById = new Map(quotations.map(q => [q.id, q]));
  const rows = [];
  for (const so of saleOrders) {
    if (so.status === 'cancelled' || !inRange(so.order_date, from, to)) continue;
    const l = so.lead_id ? leadById.get(so.lead_id) : null;
    const q = so.quotation_id ? qById.get(so.quotation_id) : null;
    const fromEnquiry = l && d10(l.enquiry_date) ? daysBetween(d10(l.enquiry_date), so.order_date) : null;
    const fromQuote = q && d10(q.quotation_date) ? daysBetween(d10(q.quotation_date), so.order_date) : null;
    if (fromEnquiry == null && fromQuote == null) continue;
    rows.push({ id: so.id, so_no: so.so_no, customer: so.customer_name || l?.company_name || '', manager: own.order(so) || NONE, orderDate: d10(so.order_date), value: Number(so.total) || 0, fromEnquiry: fromEnquiry != null && fromEnquiry >= 0 ? fromEnquiry : null, fromQuote: fromQuote != null && fromQuote >= 0 ? fromQuote : null });
  }
  const avg = (list, f) => { const v = list.map(f).filter(x => x != null); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null; };
  const people = [...new Set(rows.map(r => r.manager))].map(k => { const r = rows.filter(x => x.manager === k); return { key: k, label: personLabel(k, users), orders: r.length, avgEnquiry: avg(r, x => x.fromEnquiry), avgQuote: avg(r, x => x.fromQuote) }; }).sort((a, b) => b.orders - a.orders);
  return { rows: rows.sort((a, b) => b.orderDate.localeCompare(a.orderDate)), people, avgEnquiry: avg(rows, x => x.fromEnquiry), avgQuote: avg(rows, x => x.fromQuote) };
}
