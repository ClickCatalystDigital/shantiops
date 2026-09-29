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
// Customers often deduct TDS before paying: 0.1%, 1% or 2% of either the order total or its
// pre-GST value (total / 1.18). A shortfall within 3% of one of these cuts (rupee rounding) is
// "TDS", not a real gap.
export const TDS_RATES = [0.001, 0.01, 0.02];
export const GST_FACTOR = 1.18;
// Row colour. Bill Value is deliberately not part of it (informational column only).
// 'match' = paid in full (within ₹1), 'tds' = short by what looks like TDS, 'mismatch' = anything
// else (unpaid, part-paid, overpaid), null = no order value to compare.
export function matchState({ orderValue, received }, { tolerance = MATCH_TOLERANCE, tdsRates = TDS_RATES } = {}) {
  const total = Number(orderValue);
  if (!(total > 0)) return null;
  const got = Number(received) || 0;
  const short = total - got;
  if (Math.abs(short) <= tolerance) return 'match';
  if (short > 0 && got > 0) {
    for (const base of [total, total / GST_FACTOR]) {
      for (const rate of tdsRates) {
        const cut = base * rate;
        if (Math.abs(short - cut) <= Math.max(tolerance, cut * 0.03)) return 'tds';
      }
    }
  }
  return 'mismatch';
}

// --- Row colour rules (the cog on the Orders card) ------------------------------------------------
// A rule = name + colour + opacity + up to MAX_CONDITIONS conditions joined by all/any. Rules are
// checked top to bottom; the first one that matches colours the row. A condition compares a column
// with a fixed value or with another column.
export const MAX_CONDITIONS = 4;
export const MAX_RULES = 20;
export const RULE_COLUMNS = [
  { key: 'order_value', label: 'Order Value', type: 'number' },
  { key: 'bill_value', label: 'Bill Value', type: 'number' },
  { key: 'received', label: 'Payment Received', type: 'number' },
  { key: 'pending', label: 'Payment Pending', type: 'number' },
  { key: 'difference', label: 'Difference (+/- ignored)', type: 'number' },
  { key: 'tds_like', label: 'Looks like TDS (1 = yes)', type: 'number' },
  { key: 'cancelled', label: 'Cancelled (1 = yes)', type: 'number' },
  { key: 'status', label: 'Status', type: 'text' },
  { key: 'stage', label: 'Current Stage', type: 'text' },
];
export const NUMBER_OPS = [['=', 'equals'], ['!=', 'is not equal to'], ['>', 'is greater than'], ['<', 'is less than'], ['>=', 'is at least'], ['<=', 'is at most']];
export const TEXT_OPS = [['=', 'is'], ['!=', 'is not']];
const COL = Object.fromEntries(RULE_COLUMNS.map(c => [c.key, c]));

export const DEFAULT_ROW_SETTINGS = {
  tolerance: MATCH_TOLERANCE,
  tdsRates: [0.1, 1, 2], // percent
  rules: [
    { id: 'full', name: 'Received in full', on: true, color: '#16a34a', opacity: 10, match: 'all', conditions: [
      { left: 'order_value', op: '>', right: { kind: 'value', value: 0 } }, { left: 'difference', op: '<=', right: { kind: 'value', value: 1 } }, { left: 'cancelled', op: '=', right: { kind: 'value', value: 0 } }] },
    { id: 'tds', name: 'Short by TDS', on: true, color: '#d97706', opacity: 10, match: 'all', conditions: [
      { left: 'tds_like', op: '=', right: { kind: 'value', value: 1 } }, { left: 'cancelled', op: '=', right: { kind: 'value', value: 0 } }] },
    { id: 'other', name: 'Anything else', on: true, color: '#dc2626', opacity: 10, match: 'all', conditions: [
      { left: 'order_value', op: '>', right: { kind: 'value', value: 0 } }, { left: 'difference', op: '>', right: { kind: 'value', value: 1 } }, { left: 'tds_like', op: '=', right: { kind: 'value', value: 0 } }, { left: 'cancelled', op: '=', right: { kind: 'value', value: 0 } }] },
  ],
};

const num = (v, lo, hi, dflt) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Math.min(hi, Math.max(lo, Number(v))) : dflt);
function cleanCondition(c) {
  const left = COL[c?.left]; if (!left) return null;
  const ops = (left.type === 'number' ? NUMBER_OPS : TEXT_OPS).map(o => o[0]);
  const op = ops.includes(c.op) ? c.op : '=';
  const r = c.right || {};
  if (r.kind === 'column' && COL[r.column] && COL[r.column].type === left.type) return { left: left.key, op, right: { kind: 'column', column: r.column } };
  if (left.type === 'number') return { left: left.key, op, right: { kind: 'value', value: num(r.value, -1e12, 1e12, 0) } };
  return { left: left.key, op, right: { kind: 'value', value: String(r.value ?? '').slice(0, 60) } };
}
function cleanRule(r, i) {
  const conditions = (Array.isArray(r?.conditions) ? r.conditions : []).map(cleanCondition).filter(Boolean).slice(0, MAX_CONDITIONS);
  return {
    id: String(r?.id || `r${i}`).slice(0, 24), name: String(r?.name || 'Rule').slice(0, 40), on: r?.on !== false,
    color: /^#[0-9a-fA-F]{6}$/.test(r?.color || '') ? r.color : '#2563eb', opacity: num(r?.opacity, 0, 100, 10),
    match: r?.match === 'any' ? 'any' : 'all', conditions,
  };
}
// Accepts the newest shape ({rules}) or the first version ({states}) and returns the newest.
export function normalizeRowSettings(raw) {
  const d = DEFAULT_ROW_SETTINGS, r = raw && typeof raw === 'object' ? raw : {};
  const rates = Array.isArray(r.tdsRates) ? r.tdsRates.map(Number).filter(x => x > 0 && x <= 100) : d.tdsRates;
  let rules;
  if (Array.isArray(r.rules)) rules = r.rules.slice(0, MAX_RULES).map(cleanRule);
  else {
    rules = d.rules.map(x => JSON.parse(JSON.stringify(x)));
    for (const [k, legacy] of Object.entries(r.states || {})) { // first version: keep their colours
      const t = rules.find(x => x.id === ({ match: 'full', mismatch: 'other' }[k] || k)); if (!t) continue;
      if (/^#[0-9a-fA-F]{6}$/.test(legacy?.color || '')) t.color = legacy.color;
      t.opacity = num(legacy?.opacity, 0, 100, t.opacity); t.on = legacy?.on !== false;
    }
  }
  return { tolerance: num(r.tolerance, 0, 1000, d.tolerance), tdsRates: rates.length ? rates : d.tdsRates, rules };
}
export function matchOptions(settings) { return { tolerance: settings.tolerance, tdsRates: settings.tdsRates.map(x => x / 100) }; }

// Values the rules compare, for one order row.
export function ruleContext({ orderValue, billValue, received, status, stage, cancelled }, settings) {
  const ov = Number(orderValue) || 0, got = Number(received) || 0;
  return {
    order_value: ov, bill_value: billValue == null ? 0 : Number(billValue) || 0, received: got, pending: ov - got, difference: Math.abs(ov - got),
    tds_like: matchState({ orderValue: ov, received: got }, matchOptions(settings)) === 'tds' ? 1 : 0,
    cancelled: cancelled ? 1 : 0, status: String(status || ''), stage: String(stage || ''),
  };
}
function test(a, op, b) {
  if (typeof a === 'string' || typeof b === 'string') { const x = String(a).toLowerCase(), y = String(b).toLowerCase(); return op === '=' ? x === y : x !== y; }
  switch (op) { case '=': return Math.abs(a - b) < 0.005; case '!=': return Math.abs(a - b) >= 0.005; case '>': return a > b; case '<': return a < b; case '>=': return a >= b - 0.005; case '<=': return a <= b + 0.005; default: return false; }
}
export function ruleMatches(rule, ctx) {
  if (!rule.on || !rule.conditions.length) return false;
  const hits = rule.conditions.map(c => test(ctx[c.left], c.op, c.right.kind === 'column' ? ctx[c.right.column] : c.right.value));
  return rule.match === 'any' ? hits.some(Boolean) : hits.every(Boolean);
}
// First matching rule (or null).
export function firstRule(settings, ctx) { return settings.rules.find(r => ruleMatches(r, ctx)) || null; }
export function ruleColor(rule) {
  if (!rule) return null;
  const n = parseInt(rule.color.slice(1), 16);
  return `rgba(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}, ${rule.opacity / 100})`;
}
