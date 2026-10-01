// lib/stores-undo.js — "undo" guards for Stores' own decisions (routing, per-unit allocation, withdraw).
// A decision can be taken back only while nothing downstream was built on it; otherwise the caller gets a
// plain reason. Never deletes a BOM line — that belongs to Engineering (cancel / delete_item).
import { queryOne, queryAll } from './db';

// Why the routing of (bomItem, child project) can't be undone yet — null when it can.
export async function routingBlockReason(bomItemId, childProjectId) {
  // Per unit on a split order (an indent for unit 1 must not block undoing unit 21); an ordinary project's
  // lines carry no unit, so any live indent on the line counts. Old lines whose unit is unknown also count.
  const indent = await queryOne(
    `SELECT mi.indent_no FROM material_indent_items mii JOIN material_indents mi ON mi.id = mii.indent_id
      WHERE mii.bom_item_id = ? AND mii.status != 'cancelled'
        AND (mii.child_project_id = ? OR mii.child_project_id IS NULL) LIMIT 1`, [bomItemId, childProjectId]);
  if (indent) return `Already on Production request ${indent.indent_no} — cancel that first`;
  const packed = await queryOne(
    `SELECT pl.packing_no FROM packing_bom_links pi JOIN packing_lists pl ON pl.id = pi.packing_list_id
      WHERE pi.bom_item_id = ? AND pl.project_id = ? LIMIT 1`, [bomItemId, childProjectId]);
  if (packed) return `Already on packing list ${packed.packing_no} — remove it from there first`;
  return null;
}

// Why one allocation row (bom_item -> unit) can't be taken back yet — null when it can.
export async function allocationBlockReason(bomItemId, childProjectId) {
  const routed = await queryOne(
    'SELECT routed_to FROM bom_item_child_routing WHERE bom_item_id = ? AND child_project_id = ?', [bomItemId, childProjectId]);
  if (routed) return `This unit is already routed to ${routed.routed_to === 'production' ? 'Production' : 'Dispatch'} — undo the routing first`;
  const cert = await queryOne(
    'SELECT 1 AS x FROM bom_item_child_certificates WHERE bom_item_id = ? AND child_project_id = ? LIMIT 1', [bomItemId, childProjectId]);
  if (cert) return 'A test certificate is already assigned to this unit — QC must remove it first';
  return null;
}

// Stores-side list for the Allocator's "Undo" card: lines routed for their own project that nothing
// downstream has picked up yet.
export async function getUndoableRoutings() {
  const rows = await queryAll(
    `SELECT b.id, b.material_description, b.qty_text, r.routed_to, r.decided_at, r.decided_by, p.project_no
       FROM bom_item_child_routing r JOIN bom_items b ON b.id = r.bom_item_id JOIN projects p ON p.id = b.project_id
      WHERE r.child_project_id = b.project_id
        AND NOT EXISTS (SELECT 1 FROM material_indent_items mii WHERE mii.bom_item_id = b.id AND mii.status != 'cancelled')
        AND NOT EXISTS (SELECT 1 FROM packing_bom_links pi WHERE pi.bom_item_id = b.id)
      ORDER BY r.decided_at DESC LIMIT 100`);
  return rows;
}
