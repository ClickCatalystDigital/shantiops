// lib/acceptance.mjs — pass/fail for a measured value against the configured acceptance rules
// (docs/gulf-coast-asme-plan.md, Phase 1). Pure. The app knows no limits of its own: every rule is entered
// by QC with its source (customer spec, purchaser spec, code clause from their licensed copy).
//
// Rule choice for one characteristic: the most specific active scope wins (project > customer > material >
// global), then the highest version. Units must match the rule's unit exactly (case and spaces ignored):
// no conversions until the customer confirms a scale pair.
// ponytail: add a conversion table per confirmed pair (e.g. HV -> HBW) if they ever need one.

const SCOPE_RANK = { project: 4, customer: 3, material: 2, global: 1 };
const n = s => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const unitKey = s => String(s ?? '').trim().toLowerCase().replace(/\s+/g, '');

export function scopeMatches(rule, ctx = {}) {
  const v = n(rule.scope_value);
  if (rule.scope === 'global' || !rule.scope) return true;
  if (rule.scope === 'project') return v && v === n(ctx.project);
  if (rule.scope === 'customer') return v && v === n(ctx.customer);
  if (rule.scope === 'material') return v && v === n(ctx.material);
  return false;
}

export function pickRule(rules, characteristic, ctx = {}) {
  const c = n(characteristic);
  const live = rules.filter(r => !r.retired_at && n(r.characteristic) === c && scopeMatches(r, ctx));
  live.sort((a, b) => (SCOPE_RANK[b.scope] || 0) - (SCOPE_RANK[a.scope] || 0) || b.version - a.version);
  return live[0] || null;
}

export function verdict(value, rule) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 'fail';
  if (rule.min != null && (rule.min_inclusive ? v < rule.min : v <= rule.min)) return 'fail';
  if (rule.max != null && (rule.max_inclusive ? v > rule.max : v >= rule.max)) return 'fail';
  return 'pass';
}

// measurements: [{characteristic, value, unit, ...}] -> { rows: [...with rule_id, verdict], errors, anyFail }
export function evaluate(measurements, rules, ctx = {}) {
  const errors = [];
  const rows = measurements.map((m, i) => {
    if (!String(m.characteristic || '').trim()) errors.push(`Row ${i + 1}: characteristic is missing`);
    if (!Number.isFinite(Number(m.value)) || String(m.value).trim() === '') errors.push(`Row ${i + 1}: value is not a number`);
    const rule = pickRule(rules, m.characteristic, ctx);
    if (!rule) return { ...m, rule_id: null, verdict: null };
    if (unitKey(m.unit) !== unitKey(rule.unit)) {
      errors.push(`${m.characteristic}: entered in "${m.unit || '(no unit)'}", the rule is in "${rule.unit}"`);
      return { ...m, rule_id: rule.id, verdict: null };
    }
    return { ...m, rule_id: rule.id, verdict: verdict(m.value, rule) };
  });
  return { rows, errors, anyFail: rows.some(r => r.verdict === 'fail') };
}

export const describeRule = r => {
  const lo = r.min != null ? `${r.min_inclusive ? '≥' : '>'} ${r.min}` : '';
  const hi = r.max != null ? `${r.max_inclusive ? '≤' : '<'} ${r.max}` : '';
  return `${[lo, hi].filter(Boolean).join(' and ')} ${r.unit}`.trim();
};
