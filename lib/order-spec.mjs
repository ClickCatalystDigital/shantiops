// lib/order-spec.mjs — what a New Project should default to for a given Sale Order.
// The MAIN line of the order is its boiler-family line with the largest amount (PRS only when the
// order has no boiler; chimney, ducting, pumps, charges never decide). Its product's name gives the
// rule-based spec (lib/product-spec.mjs). What Design Heads actually SAVED on earlier projects for
// that same product ("memory") overrides a field once it has been used the same way at least twice
// and accounts for at least 60% of that field's saved uses (Laplace-smoothed) — so one odd project
// can't flip a default, and a default is never learned from a suggestion nobody saved.
// Pure, no DB import. Selfchecked: node lib/order-spec-selfcheck.mjs
import { readProductSpec, BOILER_SERIES } from './product-spec.mjs';

export const SPEC_FIELDS = ['series', 'model_design', 'model_capacity', 'model_pressure'];
export const MIN_USES = 2, MIN_CONFIDENCE = 0.6;
const RULE_KEY = { series: 'series', model_design: 'design', model_capacity: 'capacity', model_pressure: 'pressure' };

const amountOf = l => Number(l.amount) || (Number(l.qty) || 1) * (Number(l.rate) || 0);

// -> { line, spec } | null. A line with no linked product is read from its own description.
export function mainLine(lines = []) {
  const read = lines.map(l => ({ line: l, spec: readProductSpec({ name: l.product_name || l.item_description, type: l.product_type }) })).filter(x => x.spec.series);
  const pick = list => list.reduce((best, x) => (!best || amountOf(x.line) > amountOf(best.line) ? x : best), null);
  return pick(read.filter(x => BOILER_SERIES.includes(x.spec.series))) || pick(read.filter(x => x.spec.series === 'PRS'));
}

// memory: { field: [{ value, uses }] } for the main product. -> the learned value or null.
export function learnedValue(rows = []) {
  const total = rows.reduce((s, r) => s + r.uses, 0);
  const best = [...rows].sort((a, b) => b.uses - a.uses)[0];
  return best && best.uses >= MIN_USES && (best.uses + 1) / (total + 2) >= MIN_CONFIDENCE ? best.value : null;
}

// -> { series, model_design, model_capacity, model_pressure, product_id } — every value null when unknown.
export function orderSpecDefaults(lines, memory = {}) {
  const main = mainLine(lines);
  const out = { series: null, model_design: null, model_capacity: null, model_pressure: null, product_id: null };
  if (!main) return out;
  out.product_id = main.line.product_id ?? null;
  for (const f of SPEC_FIELDS) {
    const learned = out.product_id ? learnedValue(memory[f]) : null;
    const v = learned ?? main.spec[RULE_KEY[f]] ?? null;
    out[f] = f === 'model_capacity' || f === 'model_pressure' ? (Number(v) > 0 ? Number(v) : null) : (v || null);
  }
  return out;
}
