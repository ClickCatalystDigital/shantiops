import assert from 'node:assert/strict';
import { maxDiscount, approvalFor, blockedByApproval, revisionNumber } from './quotation-approval.mjs';
assert.equal(maxDiscount([{ discount_pct: 5 }, { discount_pct: '12.5' }, {}]), 12.5);
assert.equal(approvalFor([{ discount_pct: 10 }], 10), null);       // at the limit is fine
assert.equal(approvalFor([{ discount_pct: 10.5 }], 10), 'pending');
assert.equal(approvalFor([{ discount_pct: 11 }], undefined), 'pending'); // default 10
assert.equal(approvalFor([{ discount_pct: 1 }], 0), 'pending');     // 0 = every discount needs approval
assert.equal(approvalFor([], 10), null);
assert.equal(blockedByApproval({ approval_status: 'pending' }, 'sent'), true);
assert.equal(blockedByApproval({ approval_status: 'pending' }, 'rejected'), false);
assert.equal(blockedByApproval({ approval_status: 'approved' }, 'sent'), false);
assert.equal(revisionNumber('QTN-31/SB/2026-27', 2), 'QTN-31/SB/2026-27-R2');
console.log('quotation-approval selfcheck ok');
