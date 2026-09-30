// lib/stock-stage.mjs — pure "where is this material now?" label for a BOM line, derived from data that
// already exists (no new purchase_status values: those feed Procurement milestones, the Material Plan and
// packing readiness). node lib/stock-stage-selfcheck.mjs
// Furthest step wins: Dispatched > Packed > On packing list > On floor > Routed > Reserved > In stock.
export function stockStage(f) {
  if (f.dispatched) return { key: 'dispatched', label: 'Dispatched' };
  if (f.packed) return { key: 'packed', label: 'Packed' };
  if (f.onPackingList) return { key: 'on_packing_list', label: 'On packing list' };
  if (f.issued) return { key: 'on_floor', label: 'On floor' };
  if (f.routedTo === 'production') return { key: 'routed_production', label: 'Routed → Production' };
  if (f.routedTo === 'dispatch') return { key: 'routed_dispatch', label: 'Routed → Dispatch' };
  if (f.reserved) return { key: 'reserved', label: 'Reserved' };
  if (f.status === 'Received' || f.status === 'In-Stock') return { key: 'in_stock', label: 'In stock' };
  return null;
}
