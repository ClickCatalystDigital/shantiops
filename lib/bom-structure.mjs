// lib/bom-structure.mjs — pure computation for STERP items 16-19 (§5o: Multi-Level BOM roll-up,
// Where-Used/Common-Uncommon identity matching, ECN/Purchase-Return transition guards). Split out
// from lib/data.js and the API routes so plain `node` can load and self-check it, same precedent
// as lib/bom-fields.mjs.
//
// normalizeMaterial is inlined (not imported from lib/remnant-match.js, which has the identical
// one-line function) because remnant-match.js pulls in lib/db.js's whole Turso client at import
// time — that would break plain-`node` self-checkability for the sake of a one-line dedupe.
function normalizeMaterial(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Roll-up qty for one assembly = product of qty up its parent chain. `byId` is a Map<id, assembly>
// (assembly = {id, parent_id, qty}).
export function rollupQty(assemblyId, byId) {
  let mult = 1;
  let a = byId.get(assemblyId);
  while (a) { mult *= Number(a.qty) || 1; a = a.parent_id ? byId.get(a.parent_id) : null; }
  return mult;
}

// Reparent cycle guard (BOM workspace Phase 2) — true if `candidateParentId` is `nodeId` itself or
// any descendant of it, i.e. moving `nodeId` under `candidateParentId` would create a cycle. Same
// parent-chain walk shape as rollupQty, just starting from the proposed parent and walking up
// looking for nodeId instead of multiplying qty.
export function wouldCreateCycle(nodeId, candidateParentId, byId) {
  let cur = candidateParentId;
  while (cur != null) {
    if (cur === nodeId) return true;
    const a = byId.get(cur);
    cur = a ? a.parent_id : null;
  }
  return false;
}

// A BOM item's own qty_text ("2 Nos") times its assembly's roll-up multiplier. Null when qty_text
// doesn't start with a number — shown as-is, not guessed.
// ponytail: leading-number parse is the ceiling; a real UOM-aware parser is the upgrade path.
export function itemRollupQty(qtyText, assemblyId, byId) {
  const m = String(qtyText || '').match(/^\s*([\d.]+)/);
  if (!m) return null;
  return Number(m[1]) * rollupQty(assemblyId, byId);
}

// Hybrid part identity for Where-Used/Common-Uncommon: bom_items.item_id when set (exact,
// catalog-linked), normalized material_description+moc+size_spec fallback otherwise. An item_id
// row and a string-only row never match each other, even if their text happens to coincide.
export function partIdentityKey(row) {
  if (row.item_id) return `id:${row.item_id}`;
  const key = [row.material_description, row.moc, row.size_spec].map(normalizeMaterial).join('|');
  return key.replace(/\|+$/, '') ? `s:${key}` : null;
}

// ECN approve/reject guard: only a still-pending note may be decided (mirrors
// app/api/engineering-change-notes/[id]/route.js's own check).
export function canDecideChangeNote(status) {
  return status === 'pending';
}

// Purchase-return stock-decrement guard: only fires on the transition INTO removed_from_stock, so
// a later re-save (e.g. editing debit_note_ref) never double-decrements. Mirrors
// app/api/purchase-returns/[id]/route.js's own check (and sales-returns' credit-side mirror).
export function shouldAdjustStock(requestedAction, currentAction, targetAction = 'removed_from_stock') {
  return requestedAction === targetAction && currentAction !== targetAction;
}
