// node lib/morning-brief-selfcheck.mjs
import assert from 'node:assert';
import { executiveBrief, pmBrief, departmentBrief, renderBrief } from './morning-brief.mjs';

const today = '2026-10-04';
const base = {
  kpi: { total: 10, completed: 2, healthy: 5, delayed: 2, critical: 1 },
  topRisks: [{ project_no: 'SB-1', customer_name: 'Acme', milestone_label: 'Hydro Test', impactDays: 9 }],
  forecast: [
    { project_no: 'SB-2', customer_name: 'B', roll: { code: 'in_progress' }, estDispatch: '2026-10-06' }, // inside 7 days
    { project_no: 'SB-3', customer_name: 'C', roll: { code: 'in_progress' }, estDispatch: '2026-10-20' }, // outside
    { project_no: 'SB-4', customer_name: 'D', roll: { code: 'done' }, estDispatch: '2026-10-05' },        // already done
  ],
  biz: { outstanding: 1234567.4, owingCustomers: 1, collectedMonth: 50000, approvals: { discounts: 2, expenses: 0, registrations: 1 } },
  today,
};
const ex = renderBrief(executiveBrief(base), { today, link: 'https://x/executive' });
assert.match(ex.text, /Active: 8 {3}On track: 5 {3}At risk: 2 {3}Delayed: 1/);
assert.match(ex.text, /SB-1 · Acme \(Hydro Test\) — 9d late/);
assert.ok(ex.text.includes('SB-2') && !ex.text.includes('SB-3') && !ex.text.includes('SB-4'));
assert.match(ex.text, /Outstanding: ₹12,34,567/);
assert.match(ex.text, /2 quotation discounts — waiting/);
assert.ok(ex.html.includes('href="https://x/executive"') && ex.html.includes('Good morning.'));

const pm = renderBrief(pmBrief(base), { today });
assert.ok(!pm.text.includes('Outstanding'), 'PM brief carries no cash');
assert.match(pm.subject, /1 project need attention, 1 dispatch this week/);

const dept = departmentBrief({ department: 'Installation', today, tasks: 2,
  overdue: [{ project_no: 'SB-9', label: 'Site Installation', planned_end: '2026-10-01' }], due: [] });
assert.equal(dept.empty, false);
const d = renderBrief(dept, { today });
assert.match(d.text, /Service brief/);
assert.match(d.text, /SB-9 \(Site Installation\) — 3d late/);
assert.match(d.text, /Nothing due this week\./);
assert.equal(departmentBrief({ department: 'QC', today }).empty, true);
assert.ok(!renderBrief(departmentBrief({ department: 'QC<script>', today, tasks: 1 }), { today }).html.includes('<script>'));
console.log('morning-brief selfcheck OK');
