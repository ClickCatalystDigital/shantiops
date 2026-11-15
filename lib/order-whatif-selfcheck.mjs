// Self-check for the order what-if (market-intel plan D5): it reproduces market-intel's Python results for the worked examples,
// stays free of network, database and model code, and refuses market data and missing inputs. No database needed.
import { readFileSync } from 'node:fs';
import { computeWhatIf, prefillFromRecords, WhatIfError } from './order-whatif.mjs';

const here = (p) => new URL(p, import.meta.url);
const read = (p) => JSON.parse(readFileSync(here(p), 'utf8'));
let failed = 0;
const fail = (m) => { failed += 1; console.log('FAIL ' + m); };
const near = (a, b, tol = 0.01) => typeof a === 'number' && Math.abs(a - b) <= tol;

for (const n of [1, 2]) {
  const input = read(`./order-whatif-fixtures/b1-hypothetical-${n}.input.json`);
  const want = read(`./order-whatif-fixtures/b1-hypothetical-${n}.expected.json`); // produced by market-intel harness/whatif.py
  const got = computeWhatIf(input);
  if (got.header !== want.header) fail(`example ${n}: header differs`);
  const sorted = (o) => JSON.stringify(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
  if (sorted(got.input_sources) !== sorted(want.input_sources)) fail(`example ${n}: input sources differ`);
  if (!near(got.inputs.steel_fraction_of_order_at_quote, want.inputs.steel_fraction_of_order_at_quote, 1e-6)) fail(`example ${n}: steel fraction differs`);
  for (const k of ['steel_cost', 'financing_cost']) {
    const g = got.lines[k], w = want.lines[k];
    if (g.mechanism !== w.mechanism || g.posts_to !== w.posts_to || g.vectors_sha256 !== w.vectors_sha256) fail(`example ${n}: ${k} metadata differs`);
  }
  for (const [row, w] of Object.entries(want.lines.steel_cost.rows)) {
    const g = got.lines.steel_cost.rows[row];
    if (!g || !near(g.extra_material_cost, w.extra_material_cost) || !near(g.rate, w.rate, 1e-6)) fail(`example ${n}: steel row ${row} differs`);
  }
  for (const [rate, rows] of Object.entries(want.lines.financing_cost.rows)) for (const [when, w] of Object.entries(rows)) {
    const g = got.lines.financing_cost.rows[rate]?.[when];
    if (!g || !near(g.financing_cost, w.financing_cost) || !near(g.peak_cash_need, w.peak_cash_need) || g.months_negative !== w.months_negative) fail(`example ${n}: financing ${rate} / ${when} differs`);
  }
  for (const [grp, w] of Object.entries(want.comparison)) for (const [k, v] of Object.entries(w)) {
    if (!near(got.comparison[grp]?.[k], v)) fail(`example ${n}: comparison ${grp}.${k} differs`);
  }
  // the output carries no margin percentage and no combined figure
  const blob = JSON.stringify(got).toLowerCase();
  if (/share_of_margin|"total|"sum|combined|insight/.test(blob)) fail(`example ${n}: output contains a forbidden field`);
}

// hand check, same as market-intel/tests/test_whatif.py: 1,880,000 x 3 month-ends x 1% = 56,400 extra interest from buying now
const ex1 = computeWhatIf(read('./order-whatif-fixtures/b1-hypothetical-1.input.json'));
if (!near(ex1.comparison.extra_financing_cost_of_buying_now_instead_of_waiting['own rate'], 56400)) fail('hand-checked financing increment is not 56,400');

// errors are exact and nothing is assumed
const base = () => JSON.parse(JSON.stringify(read('./order-whatif-fixtures/b1-hypothetical-1.input.json')));
const mustFail = (name, mutate, re) => {
  const x = base(); mutate(x);
  try { computeWhatIf(x); fail(`${name}: should have been refused`); } catch (e) { if (!(e instanceof WhatIfError) || !re.test(e.message)) fail(`${name}: wrong error: ${e.message}`); }
};
mustFail('missing rate', (x) => { delete x.steel.now_rate; }, /missing steel input\(s\): now_rate\. Nothing was assumed/);
mustFail('market data input', (x) => { x.steel.wpi_index_change = 1; }, /market data cannot be an input/);
mustFail('insight input', (x) => { x.insight_id = 'abc'; }, /market data cannot be an input/);
mustFail('negative quantity', (x) => { x.steel.open_qty = -1; }, /outside/);
mustFail('fraction out of range', (x) => { x.timeline.advance = 1.5; }, /outside/);
mustFail('fractional months', (x) => { x.timeline.planned_purchase_month = 1.5; }, /whole number/);
mustFail('now after planned', (x) => { x.timeline.now_month = 9; }, /must not be after/);
mustFail('steel larger than materials', (x) => { x.steel.open_qty = 400; }, /materials are only/);
mustFail('unknown label', (x) => { x.label = 'measured'; }, /label/);
mustFail('rate unit with no conversion', (x) => { x.steel.rate_unit = 'm'; }, /no explicit conversion/);
mustFail('bad provenance', (x) => { x.provenance = { order_value: 'guess' }; }, /provenance/);

// prefill uses only what the ERP records and never guesses the open quantity or the quoted rate
const pre = prefillFromRecords({ saleOrder: { so_no: 'SO-1', total: 1000000, order_date: '2026-02-01', quotation_date: '2026-01-10' },
  poLines: [{ description: 'IS 2062 Plate 12mm', qty: 6, uom: 't', rate: 55000, issued_at: '2026-04-15' }, { description: 'Burner assembly', qty: 1, uom: 'nos', rate: 90000, issued_at: '2026-04-15' }] });
if (pre.order_value !== 1000000 || pre.provenance.order_value !== 'erp_record' || pre.context.steel_po_lines.length !== 1 || 'steel' in pre || 'open_qty' in pre) fail('prefill is wrong');
try { prefillFromRecords({ saleOrder: { so_no: 'X', total: 0 } }); fail('prefill of an order with no value should be refused'); } catch (e) { if (!(e instanceof WhatIfError)) fail('prefill: wrong error'); }

// the module is pure: no network, database, model, environment or file access
const src = readFileSync(here('./order-whatif.mjs'), 'utf8') + readFileSync(here('./mechanisms/steel-timing.mjs'), 'utf8') + readFileSync(here('./mechanisms/cash-gap-financing.mjs'), 'utf8');
for (const bad of ['fetch(', "from './db", "from '@libsql", 'process.env', 'node:fs', 'node:http', 'XMLHttpRequest', 'openrouter']) {
  if (src.toLowerCase().includes(bad.toLowerCase())) fail(`pure modules must not contain ${bad}`);
}
console.log(failed ? `order what-if: ${failed} failure(s)` : 'order what-if: ok (reproduces the Python results for both examples; errors exact; pure)');
process.exit(failed ? 1 : 0);
