// lib/payment-reminders.mjs — which orders deserve an overdue-payment reminder. Pure (selfcheck:
// node lib/payment-reminders-selfcheck.mjs). Only recent orders are chased: the ~1,100 imported
// legacy orders would otherwise all fire on the first run.
import { matchState } from './order-match.mjs';

export const DEFAULT_REMINDER_DAYS = 30;
export const RECENT_DAYS = 365;

const DAY = 86400000;
const ageDays = (dateISO, todayISO) => Math.floor((Date.parse(todayISO) - Date.parse(String(dateISO).slice(0, 10))) / DAY);

// order: { status, track_status, total, received, order_date|created_at }. True when it is unpaid or
// part-paid (a TDS-sized shortfall counts as paid), older than `days`, but within the last year.
export function needsPaymentReminder(order, todayISO, days = DEFAULT_REMINDER_DAYS) {
  if (order.status === 'cancelled' || order.track_status === 'Closed') return false;
  const date = order.order_date || order.created_at;
  if (!date) return false;
  const age = ageDays(date, todayISO);
  if (!(age >= days && age <= RECENT_DAYS)) return false;
  return matchState({ orderValue: order.total, received: order.received || 0 }) === 'mismatch'
    && (Number(order.received) || 0) < Number(order.total);
}

// ISO week key so a still-unpaid order reminds at most once a week.
export function weekKey(todayISO) {
  const d = new Date(`${todayISO}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - first) / DAY - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
