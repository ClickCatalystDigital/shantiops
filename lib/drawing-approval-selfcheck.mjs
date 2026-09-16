// lib/drawing-approval-selfcheck.mjs — runnable check for lib/drawing-approval.mjs.
//   node lib/drawing-approval-selfcheck.mjs
import assert from 'node:assert';
import { drawingApprovalState } from './drawing-approval.mjs';

function selfcheck() {
  // Internal approved, customer not applicable at all.
  assert.deepStrictEqual(
    drawingApprovalState({ status: 'approved', customer_visible: 0, customer_approved_at: null }),
    { internal: 'approved', customerApplicable: false, customer: null });

  // as_built counts as internally approved too.
  assert.strictEqual(drawingApprovalState({ status: 'as_built', customer_visible: 0 }).internal, 'approved');

  // Internal not approved yet (in review), customer not applicable.
  assert.deepStrictEqual(
    drawingApprovalState({ status: 'under_review', customer_visible: 0, customer_approved_at: null }),
    { internal: 'not-approved', customerApplicable: false, customer: null });

  // Sent to customer, not yet approved by them.
  assert.deepStrictEqual(
    drawingApprovalState({ status: 'approved', customer_visible: 1, customer_approved_at: null }),
    { internal: 'approved', customerApplicable: true, customer: 'not-approved' });

  // Sent to customer, and approved.
  assert.deepStrictEqual(
    drawingApprovalState({ status: 'approved', customer_visible: 1, customer_approved_at: '2026-01-01' }),
    { internal: 'approved', customerApplicable: true, customer: 'approved' });

  console.log('lib/drawing-approval.mjs self-check: all assertions passed.');
}

selfcheck();
