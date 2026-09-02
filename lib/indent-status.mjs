// lib/indent-status.mjs — Material Indent (Feature B) status rollup, pure + node-runnable (no DB),
// same shape as lib/bom-fields.mjs. Cancellation rules, stated precisely:
//   - Cancelling an 'open' item is a plain transition.
//   - Cancelling a 'partially_released' item closes off only the remaining, unreleased quantity —
//     whatever was already released stays as history, never reversed.
//   - A 'released' item is never touched by any cancellation path (see the bom_item cancel cascade
//     in app/api/bom-items/[id]/route.js) — once material has actually been handed over, that's a
//     completed fact, not something a later cancellation can undo.
export function rollupIndentStatus(itemStatuses) {
  if (!itemStatuses.length) return 'open';
  if (itemStatuses.every(s => s === 'cancelled')) return 'cancelled';
  const active = itemStatuses.filter(s => s !== 'cancelled');
  if (active.every(s => s === 'released')) return 'released';
  if (active.some(s => s === 'released' || s === 'partially_released')) return 'partially_released';
  return 'open';
}

// The CAS-guarded release math, extracted as a pure predicate so it's testable without a DB: given
// what's already released and what's being released now, what's the item's new status? Returns
// null if the release would exceed what's requested (the route rejects before ever writing).
export function nextReleaseStatus(qtyRequested, qtyAlreadyReleased, qtyReleasingNow) {
  const total = qtyAlreadyReleased + qtyReleasingNow;
  if (total > qtyRequested + 1e-9) return null;
  return total >= qtyRequested - 1e-9 ? 'released' : 'partially_released';
}
