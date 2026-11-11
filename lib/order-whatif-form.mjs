// Form state <-> order what-if input (market-intel plan D6). Pure and safe: runForm never throws, it returns either the result of
// computeWhatIf (lib/order-whatif.mjs, the port of the shared calculation) or the exact reason it cannot compute. Percent fields are
// typed as percents (5 = 5%) and divided by 100 here; blank fields stay missing, so the calculation refuses rather than guesses.
import { computeWhatIf, WhatIfError } from './order-whatif.mjs';

// The default figures are INVENTED (market-intel whatif/examples/b1-hypothetical-1.json) and labelled hypothetical.
export const DEFAULT_FORM = {
  label: 'hypothetical', currency: 'INR', order_value: '12000000',
  open_qty: '40', unit: 't', quote_rate: '62000', now_rate: '66000', low: '60000', base: '66000', high: '74000', recovered: '',
  advance_pct: '5', materials_pct: '60', other_costs_pct: '25', retention_pct: '5',
  now_month: '0', planned_purchase_month: '3', fabrication_months: '4', collection_delay: '1', retention_delay: '6',
  rate_pct: '12', compare_rate_pct: '14',
};

// [key, label, help]; grouped for the panel. Every field is shown with its value and its source in the result.
export const FIELDS = {
  'Order': [['order_value', 'Order value', 'currency'], ['currency', 'Currency', 'code, e.g. INR']],
  'Steel still to buy': [['open_qty', 'Quantity not yet bought', 'in the unit'], ['unit', 'Unit', 't, kg or lb'], ['quote_rate', 'Rate assumed in the quotation', 'per unit'],
    ['now_rate', 'Rate if bought now', 'per unit'], ['low', 'Rate later: low', 'per unit'], ['base', 'Rate later: expected', 'per unit'], ['high', 'Rate later: high', 'per unit'],
    ['recovered', 'Reimbursed by the buyer (optional)', 'currency, e.g. under a price variation clause']],
  'Payment terms and timeline': [['advance_pct', 'Advance', '% of order value'], ['materials_pct', 'Materials', '% of order value, incl. the steel'],
    ['other_costs_pct', 'Labour and other costs', '% of order value'], ['retention_pct', 'Retention', '% of order value'],
    ['now_month', 'Buy now: month', 'months from the order'], ['planned_purchase_month', 'Fabrication starts: month', 'months from the order'],
    ['fabrication_months', 'Fabrication takes', 'months'], ['collection_delay', 'Balance paid after dispatch', 'months'], ['retention_delay', 'Retention released after that', 'months']],
  'Your borrowing rate': [['rate_pct', 'Your borrowing rate', '% a year'], ['compare_rate_pct', 'A second rate to compare (optional)', '% a year']],
};

const blank = (v) => v === undefined || v === null || String(v).trim() === '';
// A number from a text field: undefined when blank (so the calculation reports it missing), NaN text stays text (so it is refused).
const n = (v) => (blank(v) ? undefined : Number.isFinite(Number(v)) ? Number(v) : String(v));
const pct = (v) => { const x = n(v); return typeof x === 'number' ? x / 100 : x; };

export function formToInput(f) {
  const rates = { 'own rate': n(f.rate_pct) };
  if (!blank(f.compare_rate_pct)) rates['second rate'] = n(f.compare_rate_pct);
  const steel = { open_qty: n(f.open_qty), unit: blank(f.unit) ? undefined : String(f.unit).trim(), quote_rate: n(f.quote_rate), now_rate: n(f.now_rate),
    scenarios: { low: n(f.low), base: n(f.base), high: n(f.high) } };
  if (!blank(f.recovered)) steel.recovered = n(f.recovered);
  return {
    label: f.label, currency: blank(f.currency) ? undefined : String(f.currency).trim().toUpperCase(), order_value: n(f.order_value), steel,
    timeline: { advance: pct(f.advance_pct), materials: pct(f.materials_pct), other_costs: pct(f.other_costs_pct), retention: pct(f.retention_pct),
      now_month: n(f.now_month), planned_purchase_month: n(f.planned_purchase_month), fabrication_months: n(f.fabrication_months),
      collection_delay: n(f.collection_delay), retention_delay: n(f.retention_delay) },
    annual_rate_pct: rates,
  };
}

export function runForm(f) {
  try {
    return { ok: true, result: computeWhatIf(formToInput(f)) };
  } catch (e) {
    return { ok: false, error: e instanceof WhatIfError ? e.message : `Cannot compute: ${e.message}` };
  }
}
