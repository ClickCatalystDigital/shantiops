// node lib/morning-brief-selfcheck.mjs
import assert from 'node:assert';
import { buildBrief } from './morning-brief.mjs';

const base = {
  kpi: { total: 10, completed: 2, healthy: 5, delayed: 2, critical: 1 },
  topRisks: [{ project_no: 'SB-1', customer_name: 'Acme', milestone_label: 'Hydro Test', impactDays: 9 }],
  forecast: [
    { project_no: 'SB-2', customer_name: 'B', roll: { code: 'in_progress' }, estDispatch: '2026-10-06' }, // inside 7 days
    { project_no: 'SB-3', customer_name: 'C', roll: { code: 'in_progress' }, estDispatch: '2026-10-20' }, // outside
    { project_no: 'SB-4', customer_name: 'D', roll: { code: 'done' }, estDispatch: '2026-10-05' },        // already done
  ],
  biz: { outstanding: 1234567.4, owingCustomers: 1, collectedMonth: 50000, approvals: { discounts: 2, expenses: 0, registrations: 1 } },
  today: '2026-10-04', link: 'https://x/executive',
};
const b = buildBrief(base);
assert.match(b.text, /8 active — 5 on track, 2 at risk, 1 delayed/);
assert.match(b.text, /SB-1 \(Acme\): Hydro Test, 9 days late/);
assert.ok(b.text.includes('SB-2') && !b.text.includes('SB-3') && !b.text.includes('SB-4'));
assert.match(b.text, /Rs 12,34,567 outstanding from 1 customer\./);
assert.match(b.text, /2 quotation discounts, 1 access request\./);
assert.match(b.subject, /1 delayed.*3 approvals waiting/);
assert.ok(b.text.endsWith('Open: https://x/executive'));

const quiet = buildBrief({ ...base, topRisks: [], forecast: [], link: null, biz: { outstanding: 0, collectedMonth: 0, owingCustomers: 0, approvals: {} } });
assert.match(quiet.text, /DISPATCH in the next 7 days: none\./);
assert.match(quiet.text, /APPROVALS: nothing waiting\./);
console.log('morning-brief selfcheck OK');
