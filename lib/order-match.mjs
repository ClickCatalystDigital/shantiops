// lib/order-match.mjs — Payment Tracker Orders: Bill Value, the row match colour, and the Current
// Stage dropdown. Pure, shared by the table and its selfcheck (node lib/order-match-selfcheck.mjs).

// The six tracker steps, in order (same order as the legacy Excel tracker's columns).
export const TRACKER_STEPS = [
  { key: 'advance', label: 'Advance' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'site_completed', label: 'Site Work Completed' },
  { key: 'commissioning', label: 'Commissioning' },
  { key: 'pending_issue', label: 'Pending Site Issue' },
  { key: 'cleared_issue', label: 'Cleared Issue' },
];
export const COMPLETED = 'Completed';
export const STAGE_OPTIONS = [...TRACKER_STEPS.map(s => s.label), COMPLETED];

// Current Stage = the first step not yet done (the Excel's own formula), else Completed.
export function currentStage(order) {
  return TRACKER_STEPS.find(s => !order[`stage_${s.key}`])?.label || COMPLETED;
}

// Picking a stage in the dropdown writes the same six flags: every step before it done, it and the
// ones after not done; Completed marks all six done. currentStage(result) === the picked stage.
export function flagsForStage(label) {
  const idx = label === COMPLETED ? TRACKER_STEPS.length : TRACKER_STEPS.findIndex(s => s.label === label);
  if (idx < 0) return null;
  return Object.fromEntries(TRACKER_STEPS.map((s, i) => [`stage_${s.key}`, i < idx ? 1 : 0]));
}

// Bill Value: the order's issued/paid Sales Invoices when there are any; else the typed value.
export function billValueOf(order, invoices = []) {
  const billed = invoices.filter(i => i.sale_order_id === order.id && ['issued', 'paid'].includes(i.status));
  if (billed.length) return { value: billed.reduce((t, i) => t + (Number(i.total) || 0), 0), fromInvoices: true };
  const typed = order.bill_value;
  return { value: typed == null || typed === '' ? null : Number(typed), fromInvoices: false };
}

// Row colour: null (no colour) until the order has a value and a bill; 'match' when Order Value,
// Bill Value and Received all agree within ₹1 (rounding); 'mismatch' otherwise.
export const MATCH_TOLERANCE = 1;
export function matchState({ orderValue, billValue, received }) {
  if (!(Number(orderValue) > 0) || !(Number(billValue) > 0)) return null;
  const v = [Number(orderValue), Number(billValue), Number(received) || 0];
  return Math.max(...v) - Math.min(...v) <= MATCH_TOLERANCE ? 'match' : 'mismatch';
}
