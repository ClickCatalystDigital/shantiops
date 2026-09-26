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
const m = (orderValue, received) => matchState({ orderValue, received });
assert.equal(m(1000, 1000), 'match');
assert.equal(m(1000, 999.5), 'match'); // rounding
assert.equal(m(33629, 32956), 'tds'); // SAS-163: 2% of total
assert.equal(m(5900, 5800), 'tds'); // LC-32: 2% of pre-GST value
assert.equal(m(177472, 173922), 'tds'); // NIBR-227: 2% of total
assert.equal(m(350304, 350000), 'tds'); // NIBR-313: ~0.1% of pre-GST
assert.equal(m(118000, 116820), 'tds'); // 1% of total
assert.equal(m(920400, 920350), 'mismatch'); // SB-1060: ₹50 short, not a TDS rate
assert.equal(m(1000, 0), 'mismatch'); // unpaid
assert.equal(m(1000, 600), 'mismatch'); // part-paid
assert.equal(m(1000, 1100), 'mismatch'); // overpaid
assert.equal(m(0, 1000), null); // no order value
assert.equal(matchState({ orderValue: 1000, billValue: 5, received: 1000 }), 'match'); // Bill Value ignored
// Stage meaning is unchanged: the dropdown shows the first step not yet done, as the old column did.
assert.equal(currentStage({ stage_advance: 1, stage_dispatched: 1 }), 'Site Work Completed');
assert.equal(currentStage({}), 'Advance');
console.log('order-match selfcheck passed');
