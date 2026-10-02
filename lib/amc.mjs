// lib/amc.mjs — AMC numbers and preventive-maintenance due dates (SYSTEM.md §5dr). Pure; selfcheck in lib/amc-selfcheck.mjs.
const d10 = s => (s ? String(s).slice(0, 10) : '');
const dayDiff = (a, b) => Math.round((Date.parse(`${d10(b)}T00:00:00Z`) - Date.parse(`${d10(a)}T00:00:00Z`)) / 86400000);
export const addDays = (iso, n) => { const d = new Date(`${d10(iso)}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// What a contract looks like today: days committed / used / left, value received, cost, profit.
export function amcSummary(c, { costs = 0, visitsDone = 0, visitsPlanned = 0 } = {}, today) {
  const committed = c.start_date && c.end_date ? Math.max(0, dayDiff(c.start_date, c.end_date)) : null;
  const used = c.start_date ? Math.min(committed ?? Infinity, Math.max(0, dayDiff(c.start_date, today))) : null;
  const left = c.end_date ? dayDiff(today, c.end_date) : null;
  const value = Number(c.contract_value) || 0, received = Number(c.received_value) || 0;
  return {
    committed, used: used === Infinity ? null : used, left,
    pctElapsed: committed ? Math.round((used / committed) * 100) : null,
    value, received, pending: Math.max(0, value - received), cost: Number(costs) || 0, profit: received - (Number(costs) || 0),
    visitsDone, visitsPlanned,
    expiringSoon: c.status === 'active' && left != null && left >= 0 && left <= 30,
  };
}

const FREQ = { monthly: 30, quarterly: 91, 'half-yearly': 182, 'half yearly': 182, halfyearly: 182, 'six monthly': 182, 'bi-annual': 182, yearly: 365, annual: 365, annually: 365 };
export function intervalDays(freq) {
  const f = String(freq || '').trim().toLowerCase();
  if (FREQ[f]) return FREQ[f];
  const m = f.match(/(?:every\s*)?(\d+)\s*(day|week|month)/);
  if (m) return Number(m[1]) * { day: 1, week: 7, month: 30 }[m[2]];
  return null;
}

// Next preventive-maintenance visit: last done visit (else the start) + interval. null when there is no interval or it falls past the end.
export function nextPmDue({ start, end, lastDone, interval }) {
  if (!interval || !(lastDone || start)) return null;
  const due = addDays(lastDone || start, interval);
  return end && due > d10(end) ? null : due;
}
export function pmStatus(due, today) {
  const days = dayDiff(today, due);
  return { days, status: days < 0 ? 'overdue' : days <= 30 ? 'due_soon' : 'upcoming' };
}
