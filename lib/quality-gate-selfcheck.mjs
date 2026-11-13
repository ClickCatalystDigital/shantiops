import assert from 'node:assert/strict';
import { gateStates, requiresProblems, testState, openBeforeShipping, pointType, blockedMessage } from './quality-gate.mjs';

const P = (id, item_key, extra = {}) => ({ id, item_key, name: `P${item_key}`, sort_order: id, point_type: 'R', requires: '', qc_sign_by: null, released_at: null, not_applicable: 0, after_dispatch: 0, ...extra });
const welds = [{ id: 1, weld_no: 'L1', nde: 'RT, VT' }, { id: 2, weld_no: 'C1', nde: 'VT' }];

// Templates: earlier-only prerequisites, so no cycle can exist.
assert.deepEqual(requiresProblems([{ item_key: '1', sort_order: 1 }, { item_key: '2', sort_order: 2, requires: '1' }]), []);
assert.equal(requiresProblems([{ item_key: '1', sort_order: 1, requires: '2' }, { item_key: '2', sort_order: 2 }]).length, 1, 'later point refused');
assert.equal(requiresProblems([{ item_key: '1', sort_order: 1, requires: '9' }]).length, 1, 'unknown point refused');
assert.equal(requiresProblems([{ item_key: '1', sort_order: 1, requires: '1' }]).length, 1, 'self refused');
assert.equal(pointType('vt'), 'R');

// RT on 4.20 (per weld) blocks bundle insertion 5.5; an unrelated point is not blocked.
const rt = P(1, '4.20', { point_type: 'H', test_type: 'RT', per_weld: 1 });
const bundle = P(2, '5.5', { requires: '4.20' });
const paint = P(3, '6.1');
const stages = [rt, bundle, paint];
let recs = [{ id: 10, job_sheet_stage_id: 1, weld_id: 1, test_type: 'RT', result: 'fail' }];
let s = gateStates(stages, recs, [], welds);
assert.equal(s[1].blocked, true);
assert.match(blockedMessage(s[1]), /RT failed on weld L1/);
assert.equal(s[2].blocked, false, 'unrelated point unaffected');

// Retest fails again: still blocked. Retest passes but NCR open and not signed: still blocked.
recs = [...recs, { id: 11, job_sheet_stage_id: 1, weld_id: 1, test_type: 'RT', result: 'fail', supersedes_id: 10 }];
assert.equal(gateStates(stages, recs, [], welds)[1].blocked, true);
recs = [...recs, { id: 12, job_sheet_stage_id: 1, weld_id: 1, test_type: 'RT', result: 'pass', supersedes_id: 11 }];
const ncr = { job_sheet_stage_id: 1, status: 'dispositioned', ncr_no: 'NCR-1' };
assert.equal(testState(rt, recs, welds).ok, true, 'latest pass counts');
assert.match(blockedMessage(gateStates(stages, recs, [ncr], welds)[1]), /NCR-1 dispositioned/);
// NCR closed and QC signed, but a Hold point without the customer's release: still blocked.
const signed = { ...rt, qc_sign_by: 'qc' };
assert.match(blockedMessage(gateStates([signed, bundle, paint], recs, [{ ...ncr, status: 'closed' }], welds)[1]), /customer release/);
// Released: cleared, dependents free.
const released = { ...signed, released_at: '2026-11-12' };
s = gateStates([released, bundle, paint], recs, [{ ...ncr, status: 'closed' }], welds);
assert.equal(s[0].cleared, true);
assert.equal(s[1].blocked, false);
// Reopen (sign cleared) re-blocks.
assert.equal(gateStates([{ ...released, qc_sign_by: null }, bundle, paint], recs, [], welds)[1].blocked, true);
// N/A clears.
assert.equal(gateStates([{ ...rt, not_applicable: 1 }, bundle, paint], [], [], welds)[1].blocked, false);

// Per-weld test needs every weld that lists the method; a weld without RT is not needed.
assert.deepEqual(testState(rt, [{ id: 1, job_sheet_stage_id: 1, weld_id: 2, test_type: 'RT', result: 'pass' }], welds).missing, ['L1']);
assert.deepEqual(testState({ ...rt, test_type: 'VT' }, [{ id: 1, job_sheet_stage_id: 1, weld_id: 1, test_type: 'VT', result: 'pass' }], welds).missing, ['C1']);

// Shipping: after_dispatch points are allowed to be open.
const doc = P(4, '8.1', { after_dispatch: 1 });
const all = [released, { ...bundle, qc_sign_by: 'qc' }, { ...paint, qc_sign_by: 'qc' }, doc];
assert.equal(openBeforeShipping(all, gateStates(all, recs, [], welds)).length, 0);
console.log('quality-gate ok');
