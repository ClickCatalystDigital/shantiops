// lib/rule-input.mjs — checks on an acceptance rule before it is saved (pure).
const num = v => (v === '' || v == null ? null : Number(v));
export const SCOPES = ['global', 'customer', 'project', 'material'];

export function cleanRule(b) {
  const r = {
    characteristic: String(b.characteristic || '').trim(), unit: String(b.unit || '').trim(),
    min: num(b.min), max: num(b.max), min_inclusive: b.min_inclusive === false || b.min_inclusive === 0 ? 0 : 1,
    max_inclusive: b.max_inclusive === false || b.max_inclusive === 0 ? 0 : 1,
    scope: SCOPES.includes(b.scope) ? b.scope : 'global', scope_value: String(b.scope_value || '').trim() || null,
    source: String(b.source || '').trim(), edition: String(b.edition || '').trim() || null,
    effective_from: String(b.effective_from || '').trim() || null,
  };
  if (!r.characteristic) return { error: 'Characteristic is required (e.g. Hardness)' };
  if (!r.unit) return { error: 'Unit is required (e.g. HBW, FN, ppm)' };
  if (!r.source) return { error: 'Source is required: where this limit comes from (customer spec, purchaser spec, code clause and edition)' };
  if (r.min == null && r.max == null) return { error: 'Give a minimum, a maximum, or both' };
  if ([r.min, r.max].some(v => v != null && !Number.isFinite(v))) return { error: 'Limits must be numbers' };
  if (r.min != null && r.max != null && r.min > r.max) return { error: 'Minimum is above maximum' };
  if (r.scope !== 'global' && !r.scope_value) return { error: `Say which ${r.scope} this rule is for` };
  if (r.scope === 'global') r.scope_value = null;
  return { rule: r };
}
