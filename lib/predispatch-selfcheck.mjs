import assert from 'node:assert';
import { overallStatus, paymentSummary, needsEwayBill, predispatchRoles } from './predispatch.mjs';
assert.deepEqual(predispatchRoles(false), ['qc', 'production']);
assert.deepEqual(predispatchRoles(true), ['qc', 'production', 'accounts']);
assert.equal(overallStatus({ qc_decision: 'approved', production_decision: 'approved' }, false), 'approved');
assert.equal(overallStatus({ qc_decision: 'approved', production_decision: 'approved' }, true), 'pending');
assert.equal(overallStatus({ qc_decision: 'approved', production_decision: 'approved', accounts_decision: 'approved' }, true), 'approved');
assert.equal(overallStatus({ qc_decision: 'approved', accounts_decision: 'rejected' }, true), 'rejected');
assert.equal(overallStatus({ qc_decision: 'approved', accounts_decision: 'rejected' }, false), 'pending'); // Accounts off: its slot is ignored
assert.deepEqual(paymentSummary(4956000, 2478000), { total: 4956000, received: 2478000, balance: 2478000 });
assert.equal(needsEwayBill(50000), false);
assert.equal(needsEwayBill(50001), true);
assert.equal(needsEwayBill(null), false);
console.log('predispatch selfcheck ok');
