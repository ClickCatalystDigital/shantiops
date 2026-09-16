// lib/department-state-selfcheck.mjs — runnable check for lib/department-state.mjs.
//   node lib/department-state-selfcheck.mjs
import assert from 'node:assert';
import {
  milestoneDepartmentEntry, procurementEntry, storesEntry, childStoresEntry,
  productionEntry, qcEntry, dispatchEntry,
} from './department-state.mjs';

function selfcheck() {
  // --- Design/Installation, milestone-status-only ---
  assert.deepStrictEqual(
    milestoneDepartmentEntry([{ department: 'Design', status: 'pending', milestone_label: 'Design' }], 'Design'),
    null, 'pending is not active');
  assert.strictEqual(
    milestoneDepartmentEntry([{ department: 'Design', status: 'in_progress', milestone_label: 'Design' }], 'Design').trigger,
    'Design');
  assert.strictEqual(
    milestoneDepartmentEntry([{ department: 'Design', status: 'blocked', milestone_label: 'Design Approval' }], 'Design').trigger,
    'Design Approval', 'blocked counts as active too');
  assert.deepStrictEqual(
    milestoneDepartmentEntry([{ department: 'Design', status: 'done', milestone_label: 'Design' }], 'Design'),
    null, 'done is not active');

  // --- Procurement, weakest-link over bom_items ---
  assert.strictEqual(procurementEntry([]), null, 'no items — no signal');
  assert.deepStrictEqual(
    procurementEntry([{ purchase_status: 'Received' }, { purchase_status: 'In-Stock' }, { purchase_status: 'Cancelled' }]),
    null, 'every item terminal — Procurement is done, no entry');
  const procMixed = procurementEntry([
    { purchase_status: 'Received' }, { purchase_status: 'Enquiry' }, { purchase_status: 'Ordered' },
  ]);
  assert.strictEqual(procMixed.department, 'Procurement');
  assert.strictEqual(procMixed.trigger, '2 of 3 items still in procurement');
  assert.strictEqual(procMixed.fraction, '1/3');

  // --- Stores (normal project) ---
  assert.strictEqual(storesEntry({ totalBomCount: 5, notPackedCount: 0, pendingInwardCount: 0 }), null, 'nothing outstanding');
  const storesBoth = storesEntry({ totalBomCount: 5, notPackedCount: 2, pendingInwardCount: 1 });
  assert.strictEqual(storesBoth.trigger, '2 item(s) received, 1 awaiting QC inward review');
  assert.strictEqual(storesEntry({ totalBomCount: 5, notPackedCount: 3, pendingInwardCount: 0 }).trigger, '3 item(s) received, not yet packed');
  assert.strictEqual(storesEntry({ totalBomCount: 5, notPackedCount: 0, pendingInwardCount: 2 }).trigger, '2 item(s) awaiting QC inward review');

  // --- Stores (split child) ---
  assert.strictEqual(childStoresEntry([]), null, 'no items — no signal');
  assert.strictEqual(childStoresEntry([{ ready: true }, { ready: true }]), null, 'fully allocated — no entry');
  const childStores = childStoresEntry([{ ready: true }, { ready: false }, { ready: false }]);
  assert.strictEqual(childStores.trigger, '2 of 3 items not yet fully allocated');
  assert.strictEqual(childStores.fraction, '1/3');

  // --- Production, plus the held-job-card count QC also needs ---
  const prodNone = productionEntry([], []);
  assert.strictEqual(prodNone.entry, null);
  assert.strictEqual(prodNone.heldCount, 0);
  const prodActive = productionEntry(
    [{ status: 'in_progress' }],
    [{ status: 'progress', requires_qc_hold: 0, qc_released_at: null }, { status: 'done', requires_qc_hold: 1, qc_released_at: '2026-01-01' }]);
  assert.match(prodActive.entry.trigger, /1 job card\(s\) in progress/);
  assert.strictEqual(prodActive.heldCount, 0, 'released hold does not count');
  const prodHeld = productionEntry([], [{ status: 'pending', requires_qc_hold: 1, qc_released_at: null }]);
  assert.strictEqual(prodHeld.entry.trigger, '1 held for QC');
  assert.strictEqual(prodHeld.heldCount, 1);
  const prodWoOnly = productionEntry([{ status: 'released' }], []);
  assert.strictEqual(prodWoOnly.entry.trigger, '1 work order(s) active', 'falls back to WO count when no job cards yet');

  // --- QC, including the held-job-card overlap with Production ---
  assert.strictEqual(qcEntry({ qcPendingCount: 0, openNcrCount: 0, pendingInwardCount: 0, heldJobCardCount: 0 }), null);
  const qc = qcEntry({ qcPendingCount: 2, openNcrCount: 1, pendingInwardCount: 0, heldJobCardCount: 1 });
  assert.strictEqual(qc.trigger, '2 pending test(s), 1 open NCR(s), 1 job card(s) on hold');

  // --- Dispatch, never the packing milestone's own status ---
  assert.strictEqual(dispatchEntry([], []), null);
  assert.strictEqual(dispatchEntry([{ status: 'dispatched' }], []), null, 'fully dispatched — no entry, even though a milestone-only view might have gone stale done earlier and never reopened');
  const dispatchActive = dispatchEntry([{ status: 'draft' }, { status: 'dispatched' }], [{ status: 'pending' }]);
  assert.strictEqual(dispatchActive.trigger, '1 packing list(s) in progress, 1 awaiting pre-dispatch approval');

  console.log('lib/department-state.mjs self-check: all assertions passed.');
}

selfcheck();
