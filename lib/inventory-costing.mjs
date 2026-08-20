// lib/inventory-costing.mjs — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5 completion. Dependency-free,
// same precedent as lib/gst-calc.mjs / lib/ledger.mjs. Weighted-average costing — confirmed by
// inspection (2026-08-20) that no valuation method (FIFO, weighted-average, or otherwise) existed
// anywhere in the app before this; this is the one being established, not a second parallel system.

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

// New running average after a receipt (Vendor Bill approval), the standard weighted-average
// formula: (existing stock value + incoming stock value) / (existing qty + incoming qty). Falls
// back to the incoming unit cost alone when there was no prior stock (existingQty <= 0) — avoids a
// divide-by-zero and matches the real-world case of costing the very first receipt of an item.
export function weightedAverageCost({ existingQty, existingAvgCost, receivedQty, receivedUnitCost }) {
  const totalQty = (existingQty || 0) + (receivedQty || 0);
  if (totalQty <= 0) return 0;
  if ((existingQty || 0) <= 0) return round2(receivedUnitCost || 0);
  const totalValue = (existingQty || 0) * (existingAvgCost || 0) + (receivedQty || 0) * (receivedUnitCost || 0);
  return round2(totalValue / totalQty);
}

// What a consumption (material_issues) costs at the item's current running average — read-only,
// never mutates avg_cost itself (only a receipt does that).
export function consumptionCost({ qty, avgCost }) {
  return round2((qty || 0) * (avgCost || 0));
}
