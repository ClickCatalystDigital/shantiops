// lib/bom-item-guard.js — every table with a real, enforced reference into bom_items(id) that
// would either block or corrupt a `DELETE FROM bom_items` if not checked first.
//
// Turso DOES enforce foreign keys (confirmed live, 2026-09, via PRAGMA foreign_key_list against
// the real DB — the "this app never turns PRAGMA foreign_keys on" comment elsewhere in lib/db.js
// describes local-sqlite dev fallback behavior, not what the hosted Turso connection actually
// does). This app has already hit this exact bug twice in production, one table at a time —
// app/api/bom-items/[id]/route.js's own DELETE handler carries the scars: inventory_reservations
// (found after a real 500 in production) and material_indent_items (found in review before it
// could). Both were patched as one-off checks in that single route, leaving 16 other tables with
// the identical unguarded FK, plus the PMB Replace route's own bulk DELETE with none at all.
// Centralizing here so the next new bom_item_id-referencing table only needs adding to the list
// below, not rediscovering live a third time.
//
// The list was generated from the real schema, not hand-counted from source:
//   SELECT name FROM sqlite_master WHERE type='table' ...
//   then PRAGMA foreign_key_list(<table>) filtered to fk.table === 'bom_items'
// 18 tables came back with a real FK; `packing_items` is deliberately included too even though its
// bom_item_id column carries no DB-level FK at all — the app already treats it as a hard delete
// blocker (deleting a packed line would orphan real dispatch reconciliation), so it belongs in the
// same one gate everything else does. `supplier_quotes` is the one CASCADE case (the rest are all
// NO ACTION, i.e. genuinely block the delete) — CASCADE would silently delete a log this app
// deliberately never lets anyone delete anywhere else (its own append-only price-history
// precedent), so it's blocked here too rather than left to cascade quietly.
import { queryAll } from './db';

export const BOM_ITEM_BLOCKING_TABLES = [
  { table: 'packing_items', label: 'is on a packing list' },
  { table: 'inventory_reservations', label: 'has a stock reservation on record' },
  { table: 'material_indent_items', label: 'has a material indent on record' },
  { table: 'qc_records', label: 'has a QC record' },
  { table: 'supplier_quotes', label: 'has a supplier quote logged' },
  { table: 'po_items', label: 'is on a purchase order' },
  { table: 'qc_document_parts', label: 'is linked to a statutory QC document' },
  { table: 'rfq_items', label: 'has an RFQ sent' },
  { table: 'qc_mountings', label: 'is on a Mounting & Fittings list' },
  { table: 'material_issues', label: 'has been issued to WIP' },
  { table: 'work_order_materials', label: 'is on a Work Order' },
  { table: 'bom_change_notes', label: 'has an Engineering Change Note' },
  { table: 'job_work_inspections', label: 'has a job-work inspection' },
  { table: 'vendor_bill_items', label: 'is on a vendor bill' },
  { table: 'ncr_records', label: 'has an NCR' },
  { table: 'bom_item_receipts', label: 'has a receipt logged' },
  { table: 'bom_item_child_allocations', label: 'is allocated to a split unit' },
  { table: 'bom_item_child_routing', label: 'is routed to a split unit' },
  { table: 'bom_item_child_certificates', label: 'has a certificate assigned on a split unit' },
];

// One bom_item id -> { blocked, reasons: [{table, label}] } — used where a single, human-readable
// reason is worth reporting (the single-item DELETE route's own 409 message).
export async function findBlockingReferences(bomItemId) {
  const reasons = [];
  for (const { table, label } of BOM_ITEM_BLOCKING_TABLES) {
    const rows = await queryAll(`SELECT 1 FROM ${table} WHERE bom_item_id = ? LIMIT 1`, [bomItemId]);
    if (rows.length > 0) reasons.push({ table, label });
  }
  return { blocked: reasons.length > 0, reasons };
}

// Many bom_item ids -> Set of the ones that are blocked by *something*, in O(tables) queries
// rather than O(tables x ids) — the shape a bulk operation (PMB Replace) needs, since checking one
// id at a time would mean 19 queries per BOM line on a project that can run to hundreds of lines.
export async function findBlockedIds(candidateIds) {
  const blocked = new Set();
  if (!candidateIds.length) return blocked;
  const placeholders = candidateIds.map(() => '?').join(',');
  for (const { table } of BOM_ITEM_BLOCKING_TABLES) {
    const rows = await queryAll(
      `SELECT DISTINCT bom_item_id FROM ${table} WHERE bom_item_id IN (${placeholders})`,
      candidateIds
    );
    for (const r of rows) blocked.add(r.bom_item_id);
  }
  return blocked;
}
