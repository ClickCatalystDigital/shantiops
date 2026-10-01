// Batched fetch for lib/stock-stage.mjs — one query per fact for a set of BOM lines (no per-row queries).
import { queryAll } from './db';
import { stockStage } from './stock-stage.mjs';

export async function attachStockStages(rows) {
  // A split-order master's lines are shared by all its units (packing lists, routing, allocations are per
  // unit), so one label per master line would be wrong — those rows get no stage.
  const pids = [...new Set(rows.map(r => r.project_id))];
  const masters = pids.length
    ? new Set((await queryAll(`SELECT DISTINCT master_project_id AS id FROM projects WHERE master_project_id IN (${pids.map(() => '?').join(',')})`, pids)).map(r => r.id))
    : new Set();
  const single = rows.filter(r => !masters.has(r.project_id));
  rows.forEach(r => { if (masters.has(r.project_id)) r.stage = null; });
  const ids = single.map(r => r.id);
  if (!ids.length) return rows;
  const inl = ids.map(() => '?').join(',');
  const [resv, pieces, routing, issues, packing] = await Promise.all([
    queryAll(`SELECT DISTINCT bom_item_id FROM inventory_reservations WHERE status = 'active' AND qty > qty_issued AND bom_item_id IN (${inl})`, ids),
    queryAll(`SELECT DISTINCT bom_item_id FROM stock_pieces WHERE status = 'reserved' AND bom_item_id IN (${inl})`, ids),
    queryAll(`SELECT r.bom_item_id, r.routed_to FROM bom_item_child_routing r JOIN bom_items b ON b.id = r.bom_item_id
               WHERE r.child_project_id = b.project_id AND r.bom_item_id IN (${inl})`, ids),
    queryAll(`SELECT DISTINCT bom_item_id FROM material_issues WHERE bom_item_id IN (${inl})`, ids),
    queryAll(`SELECT pi.bom_item_id, pl.status FROM packing_bom_links pi JOIN packing_lists pl ON pl.id = pi.packing_list_id
               WHERE pi.bom_item_id IN (${inl})`, ids),
  ]);
  const set = rs => new Set(rs.map(r => r.bom_item_id));
  const reserved = set([...resv, ...pieces]), issued = set(issues);
  const routed = new Map(routing.map(r => [r.bom_item_id, r.routed_to]));
  const pk = new Map();
  for (const p of packing) {
    const cur = pk.get(p.bom_item_id) || {};
    if (p.status === 'dispatched') cur.dispatched = true; else if (p.status === 'packed') cur.packed = true; else cur.onPackingList = true;
    pk.set(p.bom_item_id, cur);
  }
  for (const r of single) {
    r.stage = stockStage({
      reserved: reserved.has(r.id), issued: issued.has(r.id), routedTo: routed.get(r.id),
      ...(pk.get(r.id) || {}), status: r.purchase_status,
    });
  }
  return rows;
}
