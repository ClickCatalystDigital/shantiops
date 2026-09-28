// lib/dispatch-checkpoints.mjs — Dispatch's real per-packing-list checkpoint progress
// (milestone-automation plan §D). Checkpoint 1 (Packing scope ready) is deliberately deferred as
// its own future feature — quantity-aware Production-to-Packing reconciliation doesn't exist today,
// and the split-order allocation system that does track quantities is hard-enforced to split orders
// only (reusing it for a normal project risks corrupting the has_children-based routing logic
// elsewhere). This module only computes checkpoints 2-5; once checkpoint 1 ships, bump
// DISPATCH_CHECKPOINT_COUNT to 5 and add its own evaluator here — nothing else in this file (or its
// callers) needs to change.
//   node lib/dispatch-checkpoints-selfcheck.mjs
export const DISPATCH_CHECKPOINT_COUNT = 4; // Production approval, QC approval, Dispatched, Received

// list: { productionApproved, qcApproved, dispatched, deliveryAcked } — all plain booleans.
export function packingListCheckpointCount(list) {
  return [list.productionApproved, list.qcApproved, list.dispatched, list.deliveryAcked].filter(Boolean).length;
}

// Aggregate across every packing list belonging to a project — every existing list counts (no
// draft/staleness exclusion this round, deliberately deferred, per the plan).
export function dispatchProgress(lists) {
  if (!lists.length) return null;
  const completeCount = lists.reduce((sum, l) => sum + packingListCheckpointCount(l), 0);
  return { completeCount, totalCount: lists.length * DISPATCH_CHECKPOINT_COUNT, listCount: lists.length };
}
