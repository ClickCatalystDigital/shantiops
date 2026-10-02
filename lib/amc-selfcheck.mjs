import assert from 'node:assert/strict';
import { amcSummary, intervalDays, nextPmDue, pmStatus, addDays } from './amc.mjs';

const c = { status: 'active', start_date: '2026-01-01', end_date: '2026-12-31', contract_value: 120000, received_value: 60000 };
const s = amcSummary(c, { costs: 25000, visitsDone: 2, visitsPlanned: 4 }, '2026-07-01');
assert.equal(s.committed, 364);
assert.equal(s.used, 181);
assert.equal(s.left, 183);
assert.equal(s.profit, 35000);
assert.equal(s.pending, 60000);
assert.equal(s.expiringSoon, false);
assert.equal(amcSummary(c, {}, '2026-12-10').expiringSoon, true);
assert.equal(amcSummary({ status: 'active' }, {}, '2026-07-01').committed, null);   // no dates: no crash

assert.equal(intervalDays('Quarterly'), 91);
assert.equal(intervalDays('every 2 months'), 60);
assert.equal(intervalDays('as needed'), null);
assert.equal(nextPmDue({ start: '2026-01-01', end: '2026-12-31', lastDone: null, interval: 91 }), '2026-04-02');
assert.equal(nextPmDue({ start: '2026-01-01', end: '2026-03-01', lastDone: null, interval: 91 }), null);   // past contract end
assert.equal(nextPmDue({ start: '2026-01-01', lastDone: '2026-05-01', interval: 30 }), '2026-05-31');
assert.deepEqual(pmStatus('2026-06-01', '2026-06-10'), { days: -9, status: 'overdue' });
assert.equal(pmStatus('2026-06-20', '2026-06-10').status, 'due_soon');
assert.equal(pmStatus('2026-09-20', '2026-06-10').status, 'upcoming');
assert.equal(addDays('2026-02-27', 3), '2026-03-02');
console.log('amc selfcheck ok');
