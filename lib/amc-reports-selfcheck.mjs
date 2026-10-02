// node lib/amc-reports-selfcheck.mjs
import assert from 'node:assert/strict';
import { amcDue, amcReceived, amcByEngineer, NO_ENGINEER } from './amc-reports.mjs';
const cs = [
  { id: 1, contract_no: 1, customer: 'A', status: 'active', end_date: '2026-11-10', contract_value: 1000, received_value: 400, service_engineer: 'Ravi' },
  { id: 2, contract_no: 2, customer: 'B', status: 'active', end_date: '2026-11-30', contract_value: 500, received_value: 0, service_engineer: '' },
  { id: 3, contract_no: 3, customer: 'A', status: 'cancelled', end_date: '2026-11-20', contract_value: 900, received_value: 0 },
  { id: 4, contract_no: 4, customer: 'C', status: 'expired', end_date: '2026-09-05', contract_value: 300, received_value: 300, service_engineer: 'Ravi' },
];
const rs = [
  { contract_id: 1, receipt_date: '2026-10-02', amount: 150, received_by: '' },
  { contract_id: 1, receipt_date: '2026-10-20', amount: 100, received_by: 'Meena' },
  { contract_id: 4, receipt_date: '2026-09-06', amount: 200, received_by: 'Ravi' },
];
const due = amcDue(cs, { from: '2026-11', to: '2026-11' });
assert.deepEqual(due.rows.map(r => r.contract_no), [1, 2]);          // cancelled left out, other months left out
assert.equal(due.totals.balance, 600 + 500);
const rec = amcReceived(cs, rs, { from: '2026-10', to: '2026-10' });
assert.equal(rec.rows.length, 1); assert.equal(rec.rows[0].amount, 250); assert.equal(rec.rows[0].receipts, 2);
assert.equal(rec.undated, (400 - 250) + (300 - 200));                // totals without a dated receipt
const eng = amcByEngineer(cs, rs, { from: '2026-10', to: '2026-10' });
assert.equal(eng.rows.find(r => r.engineer === 'Ravi').collected, 150);   // Oct receipt with no collector -> contract engineer
assert.equal(eng.rows.find(r => r.engineer === 'Meena').collected, 100);
assert.equal(eng.rows.find(r => r.engineer === NO_ENGINEER).contracts, 1);
console.log('amc-reports ok');
