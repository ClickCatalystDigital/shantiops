// Port of cash_gap_financing@1 (canonical: market-intel/mechanisms/cash_gap_financing/v1/spec.yaml). Pure arithmetic.
// Timeline: month 0 is the order month. Advance at month 0; materials (less the steel part) at purchase_month; other costs spread
// evenly over fabrication_months from purchase_month; dispatch = purchase_month + fabrication_months; the balance arrives
// collection_delay months after dispatch; retention retention_delay months after that. The steel part (if any) is paid at
// steel_month instead. Cost = sum over month-ends of max(0, -cumulative balance) * annual_rate_pct / 100 / 12.
export const REF = 'cash_gap_financing@1';

const NUM = { order_value: [0, null], advance: [0, 1], materials: [0, 1], other_costs: [0, 1], retention: [0, 1], annual_rate_pct: [0, 100], steel: [0, 1] };
const INT = { purchase_month: 0, fabrication_months: 1, collection_delay: 0, retention_delay: 0, steel_month: 0 };
const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

function check(input) {
  const allowed = ['currency', ...Object.keys(NUM), ...Object.keys(INT)];
  const unknown = Object.keys(input).filter((k) => !allowed.includes(k));
  if (unknown.length) throw new Error(`${REF}: unknown inputs ${unknown.join(', ')}`);
  if (typeof input.currency !== 'string' || !input.currency) throw new Error(`${REF}: currency must be a non-empty string`);
  const out = { currency: input.currency, steel: 0, steel_month: null };
  for (const [k, [lo, hi]] of Object.entries(NUM)) {
    if (k === 'steel' && (input[k] === undefined || input[k] === null)) continue;
    const v = input[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${REF}: ${k} must be a number, got ${JSON.stringify(v)}`);
    if (v < lo || (hi !== null && v > hi)) throw new Error(`${REF}: ${k}=${v} is outside ${lo}..${hi ?? 'any'}`);
    out[k] = v;
  }
  for (const [k, lo] of Object.entries(INT)) {
    if (k === 'steel_month' && (input[k] === undefined || input[k] === null)) continue;
    const v = input[k];
    if (typeof v !== 'number' || !Number.isInteger(v)) throw new Error(`${REF}: ${k} must be a whole number, got ${JSON.stringify(v)}`);
    if (v < lo) throw new Error(`${REF}: ${k}=${v} is below ${lo}`);
    out[k] = v;
  }
  if (out.materials + out.other_costs > 1 + 1e-12) throw new Error(`${REF}: materials + other_costs must not exceed 1 (version 1 does not model a loss-making order)`);
  if (out.advance + out.retention > 1 + 1e-12) throw new Error(`${REF}: advance + retention must not exceed 1`);
  if (out.steel > out.materials + 1e-12) throw new Error(`${REF}: steel must not exceed materials`);
  return out;
}

export function cashGapFinancing(input) {
  const i = check(input);
  const value = i.order_value;
  const rest = i.materials - i.steel; // paid at purchase_month; the steel part is paid at steel_month
  const dispatch = i.purchase_month + i.fabrication_months;
  const balanceMonth = dispatch + i.collection_delay;
  const last = Math.max(balanceMonth + (i.retention > 0 ? i.retention_delay : 0), i.steel === 0 ? 0 : (i.steel_month ?? i.purchase_month));
  const cash = new Array(last + 1).fill(0);
  cash[0] += i.advance * value;
  cash[i.purchase_month] -= rest * value;
  for (let m = i.purchase_month; m < i.purchase_month + i.fabrication_months; m++) cash[m] -= (i.other_costs * value) / i.fabrication_months;
  cash[balanceMonth] += (1 - i.advance - i.retention) * value;
  if (i.retention > 0) cash[balanceMonth + i.retention_delay] += i.retention * value;
  if (i.steel) cash[i.steel_month ?? i.purchase_month] -= i.steel * value;
  let bal = 0, need = 0, peak = 0, negative = 0;
  for (const c of cash) {
    bal += c;
    const n = Math.max(0, -bal);
    need += n;
    peak = Math.max(peak, n);
    if (n > 0) negative += 1;
  }
  return { financing_cost: round2((need * i.annual_rate_pct) / 100 / 12), peak_cash_need: round2(peak), months_negative: negative };
}
