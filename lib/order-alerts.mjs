// lib/order-alerts.mjs — when a Sale Order needs a nudge about delivery (SYSTEM.md §5dr). Pure; selfcheck in lib/order-alerts-selfcheck.mjs.
// Two reasons: the promised delivery date has passed and nothing has been dispatched, or the order has sat as
// "Pending" for a long time. Dispatched / Closed / cancelled orders never alert.
export const PENDING_DAYS = 30;
const d10 = s => (s ? String(s).slice(0, 10) : '');
const days = (a, b) => Math.round((Date.parse(`${d10(b)}T00:00:00Z`) - Date.parse(`${d10(a)}T00:00:00Z`)) / 86400000);

export function orderAlertReason(o, today, pendingDays = PENDING_DAYS) {
  if (o.status === 'cancelled' || ['Dispatched', 'Closed'].includes(o.track_status)) return null;
  if (o.packing_status === 'dispatched') return null;
  if (d10(o.expected_delivery_date) && d10(o.expected_delivery_date) < today) return 'delivery_overdue';
  const placed = d10(o.order_date || o.created_at);
  if ((o.track_status || 'Pending') === 'Pending' && placed && days(placed, today) >= pendingDays) return 'pending_long';
  return null;
}
export const ORDER_ALERT_LABEL = { delivery_overdue: 'Expected delivery date has passed', pending_long: 'Still Pending after a long time' };
