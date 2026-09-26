// Shared write-time checks for BOM lines (bom_items). Keeps the tree/category rules in one place instead of one copy per route.
// Resolve-then-flag, not reject-everything: imports and PR lines legitimately start unassigned; Release BOM is the strict gate.
import { queryOne } from './db';

// '' / null / undefined all mean "no category" (the Release gate and linkBomItem used to disagree on ''). Pure.
export const hasCategory = c => c != null && String(c).trim() !== '';

// True once the project's Release BOM milestone is done (same rule the release route and the traceability freeze use).
export async function isBomReleased(projectId) {
  const m = await queryOne(`SELECT status, actual_end FROM milestones WHERE project_id = ? AND milestone_key = 'release_bom'`, [projectId]);
  return !!(m?.actual_end || m?.status === 'done');
}

// A line's node change. Returns { assemblyId } to write, or { error, status }. Rules:
//  - a node must exist and belong to the line's own project (a forged/other-project id used to be accepted, or 500 on the FK);
//  - taking a line OUT of the tree (non-null -> null) is refused on a released BOM. Re-saving an already-unassigned line
//    (the edit dialog resends '') is never an error.
export async function checkAssemblyChange(item, rawAssemblyId) {
  const next = rawAssemblyId == null || rawAssemblyId === '' ? null : Number(rawAssemblyId);
  if (next !== null && !Number.isInteger(next)) return { error: 'Invalid assembly', status: 400 };
  if (next === null) {
    if (item.assembly_id != null && await isBomReleased(item.project_id)) {
      return { error: 'This BOM is released — un-release it before taking a line out of its node', status: 409 };
    }
    return { assemblyId: null };
  }
  const node = await queryOne('SELECT id, project_id FROM bom_assemblies WHERE id = ?', [next]);
  if (!node) return { error: 'Assembly not found', status: 404 };
  if (Number(node.project_id) !== Number(item.project_id)) return { error: 'That assembly belongs to another project', status: 400 };
  return { assemblyId: next };
}

// The two Release BOM gates, defined once (the release route's GET counts and POST checks used to differ). Only design BOM
// lines (source='bom') count. A line raised through a Purchase Request (pr_item_id set) is a request, not design structure:
// it needs a category but not a node.
export async function bomGateCounts(projectId) {
  const uncategorized = await queryOne(
    `SELECT COUNT(*) AS n FROM bom_items WHERE project_id = ? AND source = 'bom' AND (category IS NULL OR TRIM(category) = '')`, [projectId]);
  const unassigned = await queryOne(
    `SELECT COUNT(*) AS n FROM bom_items WHERE project_id = ? AND source = 'bom' AND assembly_id IS NULL AND pr_item_id IS NULL`, [projectId]);
  return { uncategorized: uncategorized?.n || 0, unassigned: unassigned?.n || 0 };
}
