// Self-check for the project-page what-if panel's logic (market-intel plan D6). Component-level only: it does not render the page or
// sign anyone in. Live end-to-end verification is a separate, recorded procedure (market-intel OPERATOR_GUIDE.md).
import { readFileSync } from 'node:fs';
import { DEFAULT_FORM, FIELDS, formToInput, runForm } from './order-whatif-form.mjs';

let failed = 0;
const fail = (m) => { failed += 1; console.log('FAIL ' + m); };
const here = (p) => new URL(p, import.meta.url);
const near = (a, b) => typeof a === 'number' && Math.abs(a - b) <= 0.01;

// 1. parity: the default (invented) form IS market-intel's example 1, so it must give the Python results
const want = JSON.parse(readFileSync(here('./order-whatif-fixtures/b1-hypothetical-1.expected.json'), 'utf8'));
const got = runForm(DEFAULT_FORM);
if (!got.ok) fail(`default form does not compute: ${got.error}`);
else {
  const r = got.result;
  if (r.label !== 'hypothetical' || !r.header.includes('Inputs are hypothetical')) fail('default figures are not labelled hypothetical');
  for (const [k, w] of Object.entries(want.lines.steel_cost.rows)) if (!near(r.lines.steel_cost.rows[k]?.extra_material_cost, w.extra_material_cost)) fail(`steel row ${k} differs from the Python result`);
  const names = { 'own rate': 'own rate', 'own rate + 2 points': 'second rate' };
  for (const [pyName, rows] of Object.entries(want.lines.financing_cost.rows)) for (const [when, w] of Object.entries(rows)) {
    const g = r.lines.financing_cost.rows[names[pyName]]?.[when];
    if (!g || !near(g.financing_cost, w.financing_cost) || !near(g.peak_cash_need, w.peak_cash_need) || g.months_negative !== w.months_negative) fail(`financing ${pyName}/${when} differs`);
  }
  for (const [k, v] of Object.entries(want.comparison.steel_cost_of_waiting_instead_of_buying_now)) if (!near(r.comparison.steel_cost_of_waiting_instead_of_buying_now[k], v)) fail(`comparison ${k} differs`);
  if (!near(r.comparison.extra_financing_cost_of_buying_now_instead_of_waiting['own rate'], 56400)) fail('financing increment is not the hand-checked 56,400');
  if (/share_of_margin|"total|combined/i.test(JSON.stringify(r))) fail('result carries a margin share or a combined figure');
}

// 2. percents are percents; blanks stay missing; the label is carried through
const inp = formToInput(DEFAULT_FORM);
if (inp.timeline.advance !== 0.05 || inp.timeline.materials !== 0.6 || inp.annual_rate_pct['own rate'] !== 12) fail('percent conversion is wrong');
if (formToInput({ ...DEFAULT_FORM, recovered: '' }).steel.recovered !== undefined) fail('a blank optional field must stay absent');
if (runForm({ ...DEFAULT_FORM, label: 'customer_entered' }).result.input_sources.order_value !== 'customer_entered') fail('the label does not reach the provenance');

// 3. every field can be blanked or garbled without a crash, and each refusal names the problem
for (const [, fields] of Object.entries(FIELDS)) for (const [k] of fields) {
  for (const bad of ['', 'abc', '-5', '1e999', '   ']) {
    let res;
    try { res = runForm({ ...DEFAULT_FORM, [k]: bad }); } catch (e) { fail(`runForm threw for ${k}=${JSON.stringify(bad)}: ${e.message}`); continue; }
    if (!res.ok && !res.error) fail(`refusal for ${k} has no reason`);
  }
}
const missing = runForm({ ...DEFAULT_FORM, now_rate: '' });
if (missing.ok || !/missing steel input\(s\): now_rate/.test(missing.error)) fail('a blank required field must be refused by name');
if (runForm({ ...DEFAULT_FORM, compare_rate_pct: '' }).ok !== true) fail('the optional second rate must be optional');

// 4. the panel is local and read-only, shows provenance, keeps the lines apart; the page shows it only to money viewers
const jsx = readFileSync(here('../components/OrderWhatIfPanel.jsx'), 'utf8');
for (const bad of ['fetch(', 'localStorage', 'sessionStorage', 'axios', '/api/']) if (jsx.includes(bad)) fail(`panel must not use ${bad}`);
for (const must of ['not added together', 'Where every input came from', 'No percentage of margin', 'role="alert"', 'invented', 'data-testid="whatif-limits"']) if (!jsx.includes(must)) fail(`panel lacks "${must}"`);
// the v1 limitations are shown with every result (market-intel docs/sbops-merge-readiness.md §4)
for (const lim of ['Cash in hand earns nothing', 'values the steel at the quoted rate', 'Supplier credit, storage and handling', 'not a forecast']) if (!jsx.includes(lim)) fail(`panel must show the limitation "${lim}"`);
if (/\d/.test(jsx.slice(jsx.indexOf('export const LIMITS'), jsx.indexOf('];', jsx.indexOf('export const LIMITS'))).replace(/version|1\b/g, ''))) fail('limitation notes must carry no figures');
// narrow screens: financing and comparison amounts are lines that wrap, not wide tables that push amounts off-screen
const results = jsx.slice(jsx.indexOf('2. Financing cost'));
if (results.slice(0, results.indexOf('Where every input came from')).includes('<Table')) fail('financing and comparison must not be wide tables');
const page = readFileSync(here('../app/projects/[id]/page.js'), 'utf8');
if (!/canSeeMoney && !project\.master_project_id && (isDepartmentEnabled\(.Sales.\) && )?<OrderWhatIfPanel/.test(page)) fail('the panel must sit behind the canSeeMoney gate on the project page');
console.log(failed ? `order what-if form: ${failed} failure(s)` : 'order what-if form: ok (parity with the shared example, safe on bad input, local and gated)');
process.exit(failed ? 1 : 0);
