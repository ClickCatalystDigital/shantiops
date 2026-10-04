// Production -> Dispatch handover (Shop Floor > Dispatch). The shop floor reports finished quantity
// against a BOM line (and unit, on a split order); nothing is ticked on the project's BOM table.
// bom_items.production_done is derived here: 1 once the handed-over total meets the need (non-split).
import { queryAll, queryOne, execute } from '@/lib/db';
import { getPendingProductionMaterialLines } from '@/lib/data';

// Handover is by finished subsystem: the first level of the BOM tree below the root (a root with no
// children is its own subsystem), so a Production head thinks "Feed Line is done", not 40 lines.
async function attachSubsystems(rows, projectOf, assemblyOf) {
  const projectIds = [...new Set(rows.map(projectOf))];
  if (!projectIds.length) return rows;
  const asm = await queryAll(
    `SELECT id, parent_id, name FROM bom_assemblies WHERE project_id IN (${projectIds.map(() => '?').join(',')})`, projectIds);
  const byId = new Map(asm.map(a => [a.id, a]));
  const resolve = id => {
    const chain = [];
    for (let n = byId.get(id), guard = 0; n && guard < 50; n = byId.get(n.parent_id), guard++) chain.push(n);
    if (!chain.length) return { group_id: null, group_name: 'Not in a subsystem' };
    const top = chain[chain.length - 1];
    const sub = chain.length >= 2 ? chain[chain.length - 2] : top;
    return { group_id: sub.id, group_name: sub.id === top.id ? top.name : `${top.name} › ${sub.name}` };
  };
  return rows.map(r => ({ ...r, ...resolve(assemblyOf(r)) }));
}

const keyOf = (bomItemId, childId) => `${bomItemId}:${childId || 0}`;

// Lines Stores has routed to Production, with how much is already handed over. Reuses the indent
// worklist query (same population: routed to Production, QC-cleared) so the two screens can't drift.
export async function getHandoverLines() {
  const rows = await getPendingProductionMaterialLines();
  if (!rows.length) return [];
  const ids = [...new Set(rows.map(r => r.bom_item_id))];
  const ph = ids.map(() => '?').join(',');
  const [sums, flags] = await Promise.all([
    queryAll(`SELECT bom_item_id, child_project_id, SUM(qty) AS qty FROM production_handovers
               WHERE bom_item_id IN (${ph}) GROUP BY bom_item_id, child_project_id`, ids),
    queryAll(`SELECT id, production_done FROM bom_items WHERE id IN (${ph})`, ids),
  ]);
  const handed = new Map(sums.map(r => [keyOf(r.bom_item_id, r.child_project_id), Number(r.qty)]));
  const doneFlag = new Map(flags.map(r => [r.id, !!r.production_done]));
  const lines = rows.map(r => {
    const required = r.required_qty || 0;
    let h = handed.get(keyOf(r.bom_item_id, r.unit_project_id)) || 0;
    // Lines ticked Prod. Done before this screen existed have no handover rows: count them as handed over.
    if (!h && !r.unit_project_id && doneFlag.get(r.bom_item_id)) h = required;
    return { ...r, handed_over: h, remaining: Math.max(0, required - h) };
  });
  return attachSubsystems(lines, r => r.indent_project_id, r => r.assembly_id);
}

// Made-in-house lines of a subsystem that are not with Production yet (material not received or not
// routed) — shown as a warning so a subsystem isn't handed over while part of it is still missing.
// Counted per project + subsystem; not attempted for split-order units (their routing is per unit).
export async function getWaitingMadeCounts(lines) {
  const projectIds = [...new Set(lines.filter(l => !l.unit_project_id).map(l => l.indent_project_id))];
  if (!projectIds.length) return {};
  const inLines = new Set(lines.map(l => l.bom_item_id));
  const made = await queryAll(
    `SELECT id, project_id, assembly_id FROM bom_items
      WHERE project_id IN (${projectIds.map(() => '?').join(',')}) AND source = 'bom'
        AND requires_manufacturing = 1 AND purchase_status != 'Cancelled'`, projectIds);
  const tagged = await attachSubsystems(made.filter(m => !inLines.has(m.id)), m => m.project_id, m => m.assembly_id);
  const out = {};
  tagged.forEach(m => { const k = `${m.project_id}:${m.group_id || 0}`; out[k] = (out[k] || 0) + 1; });
  return out;
}

export async function getHandoverHistory(limit = 300) {
  const rows = await queryAll(
    `SELECT h.id, h.bom_item_id, h.child_project_id, h.qty, h.note, h.handed_by, h.handed_at,
            b.material_description, b.size_spec, b.qty_text, b.project_id, b.assembly_id,
            p.project_no, cp.project_no AS unit_project_no
       FROM production_handovers h
       JOIN bom_items b ON b.id = h.bom_item_id
       JOIN projects p ON p.id = b.project_id
       LEFT JOIN projects cp ON cp.id = h.child_project_id
      ORDER BY h.id DESC LIMIT ?`, [limit]);
  return attachSubsystems(rows, r => r.project_id, r => r.assembly_id);
}

// Keep the derived flag in step with the ledger. Split-order lines keep it untouched (their
// readiness is per unit, read from production_handovers directly).
export async function syncProductionDone(bomItemId, requiredQty) {
  const total = await queryOne('SELECT COALESCE(SUM(qty),0) AS q FROM production_handovers WHERE bom_item_id = ? AND child_project_id IS NULL', [bomItemId]);
  const done = requiredQty > 0 && Number(total.q) >= requiredQty ? 1 : 0;
  await execute('UPDATE bom_items SET production_done = ? WHERE id = ?', [done, bomItemId]);
}

// Check what the screen sent against what is really left to hand over. Returns { picked } or { error }.
export async function validateHandoverItems(items) {
  if (!Array.isArray(items) || !items.length) return { error: 'Pick at least one item' };
  const lines = await getHandoverLines();
  const byKey = new Map(lines.map(l => [`${l.bom_item_id}:${l.unit_project_id || 0}`, l]));
  const picked = [];
  for (const it of items) {
    const line = byKey.get(`${it.bom_item_id}:${it.child_project_id || 0}`);
    if (!line) return { error: 'One of the items is not routed to Production' };
    const qty = Number(it.qty);
    if (!(qty > 0)) return { error: `Enter a quantity for ${line.material_description}` };
    if (!line.required_qty) return { error: `${line.material_description}: quantity needed is unclear` };
    if (qty > line.remaining + 1e-9) return { error: `${line.material_description}: only ${line.remaining} left to hand over` };
    picked.push({ line, qty });
  }
  return { picked };
}

// One group per project (or per unit of a split order): each gets its own packing list.
export function groupHandovers(picked) {
  const groups = new Map();
  for (const { line } of picked) {
    const k = `${line.indent_project_id}:${line.unit_project_id || 0}`;
    if (!groups.has(k)) groups.set(k, { key: k, projectId: line.indent_project_id, no: line.indent_project_no,
      unit: line.unit_project_id ? { childId: line.unit_project_id } : null, unitNo: line.unit_project_no, ids: [] });
    groups.get(k).ids.push(line.bom_item_id);
  }
  return [...groups.values()];
}
