// Port of steel_timing@1 (canonical: market-intel/mechanisms/steel_timing/v1/spec.yaml). Pure: numbers in, numbers out.
// extra_material_cost = open_qty * (purchase_rate - quote_rate) - recovered; positive is a cost to the maker.
export const REF = 'steel_timing@1';

const num = (v, name, min = null) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${REF}: ${name} must be a number, got ${JSON.stringify(v)}`);
  if (min !== null && v < min) throw new Error(`${REF}: ${name}=${v} is below ${min}`);
  return v;
};
const str = (v, name) => {
  if (typeof v !== 'string' || !v) throw new Error(`${REF}: ${name} must be a non-empty string`);
  return v;
};
const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

export function steelTiming(input) {
  const allowed = ['open_qty', 'unit', 'currency', 'quote_rate', 'purchase_rate', 'recovered'];
  const unknown = Object.keys(input).filter((k) => !allowed.includes(k));
  if (unknown.length) throw new Error(`${REF}: unknown inputs ${unknown.join(', ')}`);
  const qty = num(input.open_qty, 'open_qty', 0);
  str(input.unit, 'unit');
  str(input.currency, 'currency');
  const quote = num(input.quote_rate, 'quote_rate', 0);
  const paid = num(input.purchase_rate, 'purchase_rate', 0);
  const recovered = input.recovered === undefined || input.recovered === null ? 0 : num(input.recovered, 'recovered');
  return { extra_material_cost: round2(qty * (paid - quote) - recovered) };
}
