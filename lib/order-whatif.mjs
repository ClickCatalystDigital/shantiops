// Order what-if (market-intel plan D5): the same calculation as market-intel's harness/whatif.py, in JavaScript, for use inside
// SB Ops on the tenant's own data. PURE: numbers in, a report object out. No database, no network, no model, no module-level state.
// It compares paying for the steel now with paying when fabrication starts, delivery fixed, in CURRENCY AMOUNTS on separate lines
// that are never added together. It computes no percentage of margin and no combined figure, and market data cannot be an input.
import { steelTiming } from './mechanisms/steel-timing.mjs';
import { cashGapFinancing } from './mechanisms/cash-gap-financing.mjs';
import pins from './mechanisms/PINS.json' with { type: 'json' };

export class WhatIfError extends Error {}
export const STEEL_WORDS = ['plate', 'sheet', 'coil', 'pipe', 'tube']; // how steel PO lines are recognised (a heuristic)
const SCENARIOS = ['low', 'base', 'high'];
const LABELS = ['customer_entered', 'hypothetical', 'erp_record'];
const FORBIDDEN = /insight|wpi|rbi|repo|index|market/i;
const TOP = ['label', 'currency', 'order_value', 'market', 'steel', 'timeline', 'annual_rate_pct', 'provenance', 'note'];
const STEEL = ['open_qty', 'unit', 'rate_unit', 'quote_rate', 'now_rate', 'scenarios', 'recovered'];
const TIMELINE = ['advance', 'materials', 'other_costs', 'retention', 'now_month', 'planned_purchase_month', 'fabrication_months', 'collection_delay', 'retention_delay'];
const HEADER = (cur, label) => `Amounts in ${cur}. Shown separately; not added together. No percentage of margin is computed. Inputs are ${label}. Deterministic arithmetic: no model, no market data.`;
// explicit factors (1 <from> = factor <to>); the same table as market-intel harness/units.py, nothing else converts
const FACTORS = { 't>kg': 1000, 'kg>lb': 2.20462, 'm>ft': 3.28084, 'm2>ft2': 10.7639 };
const DIM = { t: 'mass', kg: 'mass', lb: 'mass', m: 'length', ft: 'length', m2: 'area', ft2: 'area' };
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

function factor(src, dst) {
  if (src === dst) return 1;
  const direct = FACTORS[`${src}>${dst}`] ?? (FACTORS[`${dst}>${src}`] ? 1 / FACTORS[`${dst}>${src}`] : null);
  if (direct) return direct;
  if (DIM[src] && DIM[src] === DIM[dst]) {
    for (const mid of Object.keys(DIM).filter((u) => DIM[u] === DIM[src])) {
      const a = FACTORS[`${src}>${mid}`] ?? (FACTORS[`${mid}>${src}`] ? 1 / FACTORS[`${mid}>${src}`] : null);
      const b = FACTORS[`${mid}>${dst}`] ?? (FACTORS[`${dst}>${mid}`] ? 1 / FACTORS[`${dst}>${mid}`] : null);
      if (a && b) return a * b;
    }
  }
  throw new WhatIfError(`no explicit conversion from '${src}' to '${dst}'`);
}

function need(d, keys, where, allowed) {
  if (d === null || typeof d !== 'object' || Array.isArray(d)) throw new WhatIfError(`${where} must be an object`);
  if (allowed) for (const k of Object.keys(d)) {
    if (!allowed.includes(k)) throw new WhatIfError(`${where}.${k}: ${FORBIDDEN.test(k) ? 'market data cannot be an input: enter your own figure' : 'unknown input'}`);
  }
  const missing = keys.filter((k) => d[k] === undefined || d[k] === null);
  if (missing.length) throw new WhatIfError(`missing ${where === 'input' ? '' : where + ' '}input(s): ${missing.join(', ')}. Nothing was assumed`);
}
function num(d, k, where, lo = 0, hi = null) {
  const v = d[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new WhatIfError(`${where}.${k} must be a number, got ${JSON.stringify(v)}`);
  if (v < lo || (hi !== null && v > hi)) throw new WhatIfError(`${where}.${k}=${v} is outside ${lo}..${hi ?? 'any'}`);
  return v;
}

export function computeWhatIf(inp) {
  need(inp, ['label', 'currency', 'order_value', 'steel', 'timeline', 'annual_rate_pct'], 'input', TOP);
  if (!['customer_entered', 'hypothetical'].includes(inp.label)) throw new WhatIfError('input.label must be customer_entered or hypothetical');
  const cur = inp.currency;
  if (typeof cur !== 'string' || !cur) throw new WhatIfError('input.currency must be a currency code');
  const prov = inp.provenance || {};
  const badProv = Object.entries(prov).filter(([, v]) => !LABELS.includes(v));
  if (badProv.length) throw new WhatIfError(`provenance values must be one of ${LABELS.join(', ')}`);
  const orderValue = num(inp, 'order_value', 'input', 0.000001);
  const st = inp.steel, tl = inp.timeline;
  need(st, ['open_qty', 'unit', 'quote_rate', 'now_rate', 'scenarios'], 'steel', STEEL);
  need(tl, TIMELINE, 'timeline', TIMELINE);
  need(st.scenarios, SCENARIOS, 'steel.scenarios', SCENARIOS);
  const unit = st.unit;
  const rateUnit = st.rate_unit ?? unit;
  const qty = num(st, 'open_qty', 'steel');
  let rates = { quote: num(st, 'quote_rate', 'steel'), now: num(st, 'now_rate', 'steel') };
  for (const s of SCENARIOS) rates[s] = num(st.scenarios, s, 'steel.scenarios');
  const recovered = 'recovered' in st ? num(st, 'recovered', 'steel') : 0;
  if (rateUnit !== unit) { // explicit conversion: price per rate_unit -> price per unit
    const f = factor(rateUnit, unit);
    rates = Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, v / f]));
  }
  const t = {};
  for (const k of ['advance', 'materials', 'other_costs', 'retention']) t[k] = num(tl, k, 'timeline', 0, 1);
  for (const k of ['now_month', 'planned_purchase_month', 'fabrication_months', 'collection_delay', 'retention_delay']) {
    const v = num(tl, k, 'timeline');
    if (!Number.isInteger(v)) throw new WhatIfError(`timeline.${k} must be a whole number of months`);
    t[k] = v;
  }
  if (t.now_month > t.planned_purchase_month) throw new WhatIfError('timeline.now_month must not be after planned_purchase_month');
  const rateIn = inp.annual_rate_pct;
  const named = typeof rateIn === 'object' && rateIn !== null ? { ...rateIn } : { 'own rate': rateIn };
  if (!Object.keys(named).length) throw new WhatIfError('annual_rate_pct needs at least one rate');
  for (const [n, r] of Object.entries(named)) named[n] = num({ r }, 'r', `annual_rate_pct[${n}]`, 0, 100);

  const steelFraction = (qty * rates.quote) / orderValue; // the open steel valued at the quoted rate
  if (steelFraction > t.materials + 1e-9) {
    throw new WhatIfError(`the open steel is ${(steelFraction * 100).toFixed(1)}% of the order value at the quoted rate but materials are only ${(t.materials * 100).toFixed(1)}%: check quantities, rates and order value`);
  }
  const steelLine = (rate) => steelTiming({ open_qty: qty, unit, currency: cur, quote_rate: rates.quote, purchase_rate: rate, recovered }).extra_material_cost;
  const steel = { 'buy now': { rate: rates.now, extra_material_cost: steelLine(rates.now) } };
  for (const s of SCENARIOS) steel[`wait (${s})`] = { rate: rates[s], extra_material_cost: steelLine(rates[s]) };
  const fin = (month, rate) => cashGapFinancing({
    currency: cur, order_value: orderValue, advance: t.advance, materials: t.materials, other_costs: t.other_costs, retention: t.retention,
    purchase_month: t.planned_purchase_month, fabrication_months: t.fabrication_months, collection_delay: t.collection_delay,
    retention_delay: t.retention_delay, annual_rate_pct: rate, steel: Math.round(steelFraction * 1e12) / 1e12, steel_month: month });
  const financing = {};
  for (const [n, r] of Object.entries(named)) {
    financing[n] = { 'steel paid now': fin(t.now_month, r), 'steel paid at planned purchase': fin(t.planned_purchase_month, r) };
  }
  const comparison = {
    steel_cost_of_waiting_instead_of_buying_now: Object.fromEntries(SCENARIOS.map((s) => [s, r2(steel[`wait (${s})`].extra_material_cost - steel['buy now'].extra_material_cost)])),
    extra_financing_cost_of_buying_now_instead_of_waiting: Object.fromEntries(Object.entries(financing).map(([n, f]) => [n, r2(f['steel paid now'].financing_cost - f['steel paid at planned purchase'].financing_cost)])),
  };
  const keys = ['order_value', 'steel.open_qty', 'steel.quote_rate', 'steel.now_rate', 'steel.scenarios', 'steel.recovered', 'timeline', 'annual_rate_pct'];
  return {
    label: inp.label, currency: cur, header: HEADER(cur, inp.label.replace(/_/g, ' ')),
    inputs: { steel_fraction_of_order_at_quote: Math.round(steelFraction * 1e6) / 1e6 },
    input_sources: Object.fromEntries(keys.map((k) => [k, prov[k] ?? inp.label])),
    lines: {
      steel_cost: { posts_to: 'material cost', mechanism: 'steel_timing@1', vectors_sha256: pins['steel_timing@1'], rows: steel },
      financing_cost: { posts_to: 'financing cost', mechanism: 'cash_gap_financing@1', vectors_sha256: pins['cash_gap_financing@1'], rows: financing },
    },
    comparison,
  };
}

// What the ERP already holds, to prefill a form: the order value and dates, and the steel lines on issued POs for the order's projects.
// It never guesses the open quantity or the quoted steel rate (SB Ops does not record them): the person enters those.
export function prefillFromRecords({ saleOrder, poLines = [] }) {
  if (!saleOrder || !(saleOrder.total > 0)) throw new WhatIfError('the sale order has no value recorded');
  const isSteel = (d) => STEEL_WORDS.some((w) => String(d || '').toLowerCase().includes(w));
  return {
    order_value: Number(saleOrder.total),
    provenance: { order_value: 'erp_record' },
    context: {
      order_ref: saleOrder.so_no, order_date: saleOrder.order_date ?? null, quotation_date: saleOrder.quotation_date ?? null,
      steel_po_lines: poLines.filter((l) => isSteel(l.description)).map((l) => ({ description: l.description, qty: l.qty, uom: l.uom, rate: l.rate, issued_at: l.issued_at })),
    },
  };
}

// Loads those rows with INJECTED query functions (the app passes its own; a test passes a local file), read-only SELECTs only.
export async function loadRecords(queryOne, queryAll, soNo) {
  const saleOrder = await queryOne(
    `SELECT so.id, so.so_no, so.total, so.order_date, q.quotation_date FROM sale_orders so LEFT JOIN quotations q ON q.id = so.quotation_id WHERE so.so_no = ?`, [soNo]);
  if (!saleOrder) throw new WhatIfError(`no sale order ${soNo}`);
  const poLines = await queryAll(
    `SELECT pi.description, pi.qty, pi.uom, pi.rate, po.issued_at FROM po_items pi JOIN purchase_orders po ON po.id = pi.po_id
       JOIN projects pr ON pr.id = pi.project_id WHERE pr.sale_order_id = ? AND po.status = 'issued' ORDER BY po.issued_at`, [saleOrder.id]);
  return { saleOrder, poLines };
}
