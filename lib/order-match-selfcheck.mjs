import assert from 'node:assert/strict';
import { currentStage, flagsForStage, STAGE_OPTIONS, billValueOf, matchState } from './order-match.mjs';

// Every dropdown option round-trips to itself.
for (const label of STAGE_OPTIONS) assert.equal(currentStage(flagsForStage(label)), label, label);
assert.deepEqual(flagsForStage('Dispatched'), { stage_advance: 1, stage_dispatched: 0, stage_site_completed: 0, stage_commissioning: 0, stage_pending_issue: 0, stage_cleared_issue: 0 });
assert.equal(flagsForStage('Nope'), null);
assert.equal(currentStage({ stage_advance: 0, stage_dispatched: 1 }), 'Advance'); // gap = first unticked

// Bill Value: invoices win; drafts/cancelled don't count; else typed; blank = null.
const o = { id: 7, bill_value: 500 };
assert.deepEqual(billValueOf(o, [{ sale_order_id: 7, status: 'issued', total: 100 }, { sale_order_id: 7, status: 'paid', total: 50 }, { sale_order_id: 7, status: 'draft', total: 999 }, { sale_order_id: 8, status: 'issued', total: 1 }]), { value: 150, fromInvoices: true });
assert.deepEqual(billValueOf(o, [{ sale_order_id: 7, status: 'cancelled', total: 100 }]), { value: 500, fromInvoices: false });
assert.deepEqual(billValueOf({ id: 1, bill_value: null }), { value: null, fromInvoices: false });

// Colour.
assert.equal(matchState({ orderValue: 1000, billValue: 1000, received: 1000 }), 'match');
assert.equal(matchState({ orderValue: 1000, billValue: 1000.6, received: 999.8 }), 'match'); // rounding
assert.equal(matchState({ orderValue: 33629, billValue: 33629, received: 32956 }), 'mismatch'); // TDS short
assert.equal(matchState({ orderValue: 1000, billValue: 1000, received: 0 }), 'mismatch'); // unpaid
assert.equal(matchState({ orderValue: 1000, billValue: 1100, received: 1100 }), 'mismatch'); // billed ≠ ordered
assert.equal(matchState({ orderValue: 1000, billValue: null, received: 1000 }), null); // not billed
assert.equal(matchState({ orderValue: 0, billValue: 1000, received: 1000 }), null); // no order value
console.log('order-match selfcheck passed');
