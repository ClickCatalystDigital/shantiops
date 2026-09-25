// lib/order-book.mjs — Order Book & Collections report math (Sales → Reports). Pure, no DB; one
// place so the tiles, charts and details table can't disagree. Money truth = the payment log
// (sale_order_payments), same rule as the Payment Tracker. Cancelled orders are left out.
import { financialYear } from './gst-calc.mjs';

const AGING = [['0–30 days', 30], ['31–90 days', 90], ['91–180 days', 180], ['180+ days', Infinity]];
export const AGING_BUCKETS = [...AGING.map(a => a[0]), 'No order date'];

export const orderDate = so => (so.order_date || String(so.created_at || '').slice(0, 10)) || null;
export const companyOf = x => x.company || 'Shanti Boilers';
const days = (from, to) => Math.floor((Date.parse(to) - Date.parse(from)) / 864e5);

// fy: 'YYYY-YY' or 'all'. Orders filter by their order date; collections by the payment date
// (so "collected this year" includes money received this year against an older order).
export function orderBook({ saleOrders = [], payments = [], fy = 'all', today }) {
  const inFy = d => fy === 'all' || (d && financialYear(d) === fy);
  const live = saleOrders.filter(so => so.status !== 'cancelled');
  const orders = live.filter(so => inFy(orderDate(so)));
  const liveIds = new Set(live.map(so => Number(so.id)));
  const pays = payments.filter(p => liveIds.has(Number(p.sale_order_id)));
  const receivedBy = new Map();
  for (const p of pays) receivedBy.set(Number(p.sale_order_id), (receivedBy.get(Number(p.sale_order_id)) || 0) + (Number(p.amount) || 0));

  const rows = orders.map(so => {
    const value = Number(so.total) || 0;
    const received = receivedBy.get(Number(so.id)) || 0;
    return { ...so, date: orderDate(so), value, received, outstanding: Math.max(0, value - received) };
  });
  const sum = (a, k) => a.reduce((n, r) => n + r[k], 0);
  const value = sum(rows, 'value'), receivedOnBooked = sum(rows, 'received'), outstanding = sum(rows, 'outstanding');
  const collectedInPeriod = pays.filter(p => inFy(p.received_on)).reduce((n, p) => n + (Number(p.amount) || 0), 0);

  const months = new Map(); // YYYY-MM → { month, booked: {company: value}, orders, collected }
  const m = k => { if (!months.has(k)) months.set(k, { month: k, booked: {}, orders: 0, collected: 0 }); return months.get(k); };
  for (const r of rows) if (r.date) { const e = m(r.date.slice(0, 7)); e.orders++; e.booked[companyOf(r)] = (e.booked[companyOf(r)] || 0) + r.value; }
  for (const p of pays) if (p.received_on && inFy(p.received_on)) m(p.received_on.slice(0, 7)).collected += Number(p.amount) || 0;
  const monthly = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));

  const group = keyFn => {
    const g = new Map();
    for (const r of rows) {
      const k = keyFn(r) || '—';
      const e = g.get(k) || { key: k, orders: 0, value: 0, received: 0, outstanding: 0 };
      e.orders++; e.value += r.value; e.received += r.received; e.outstanding += r.outstanding; g.set(k, e);
    }
    return [...g.values()].sort((a, b) => b.value - a.value);
  };

  const aging = Object.fromEntries(AGING_BUCKETS.map(b => [b, 0]));
  for (const r of rows) {
    if (!r.outstanding) continue;
    if (!r.date) { aging['No order date'] += r.outstanding; continue; }
    const d = days(r.date, today);
    aging[AGING.find(([, max]) => d <= max)[0]] += r.outstanding;
  }

  return {
    rows, monthly, aging,
    kpis: { orders: rows.length, value, receivedOnBooked, outstanding, collectedInPeriod, collectionPct: value ? (receivedOnBooked / value) * 100 : 0 },
    byStatus: group(r => r.track_status || 'Pending'),
    bySalesPerson: group(r => r.sales_person || r.sales_person_override || 'Unassigned'),
    byCustomer: group(r => r.customer_name),
    byCompany: group(companyOf),
  };
}

export function financialYears(saleOrders = []) {
  return [...new Set(saleOrders.map(orderDate).filter(Boolean).map(financialYear))].sort().reverse();
}
