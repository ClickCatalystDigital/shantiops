// lib/plan-coverage.js — gathers the rows lib/plan-coverage.mjs decides on. Read-only; one batched
// pass (no per-line queries) because the dev/prod DB is remote. Reuses existing helpers for required
// quantity (itemRollupQty + rollup/unit-count maps), delivery dates (attachDeliveryLotDates) and
// remnant geometry (parseDims) instead of re-deriving any of them.
import { queryAll } from './db';
import { getInventoryItems, getAssemblyRollupMap, getProjectUnitCounts, attachDeliveryLotDates } from './data';
import { itemRollupQty, hasAmbiguousQty, qtyBreakdown } from './bom-structure.mjs';
import { parseDims } from './remnant-match';
import { getRemnantMatchTolerances } from './procurement';
import { normalizeMaterial } from './match-utils';
import { computePlan, demandState, summarizeProject } from './plan-coverage.mjs';
import { todayISO } from './date';

const inList = ids => ids.map(() => '?').join(',');

// itemsOnly: the Inventory tab only needs per-item pool figures (available / planned demand). Those
// come solely from lines linked to a stocked catalog item, and each pool is shared only among lines of
// the same item, so reading just those lines gives identical numbers without the whole BOM.
export async function getPlan({ projectIds = null, itemsOnly = false } = {}) {
  let scope = projectIds?.length ? `AND b.project_id IN (${inList(projectIds)})` : '';
  if (itemsOnly) {
    const stocked = (await queryAll('SELECT DISTINCT item_id FROM inventory_items WHERE item_id IS NOT NULL AND track_pieces = 0')).map(r => r.item_id);
    if (!stocked.length) return { rows: [], counts: {}, items: {}, today: todayISO() };
    scope += ` AND b.item_id IN (${inList(stocked)})`;
    projectIds = null; // args below come from projectIds only
    return getPlanInner(scope, stocked, projectIds);
  }
  return getPlanInner(scope, projectIds?.length ? projectIds : [], projectIds);
}

async function getPlanInner(scope, args, projectIds) {
  const lines = await queryAll(
    `SELECT b.*, p.project_no, p.customer_name, p.is_system AS project_is_system,
            it.item_code AS catalog_item_code, sq.expected_delivery_date AS rfq_date
       FROM bom_items b
       JOIN projects p ON p.id = b.project_id
       LEFT JOIN items it ON it.id = b.item_id
       LEFT JOIN supplier_quotes sq ON sq.id = b.selected_quote_id
      WHERE p.status IN ('active','system') AND p.master_project_id IS NULL
        AND COALESCE(b.purchase_status, 'Enquiry') != 'Cancelled' ${scope}`,
    args
  );
  if (!lines.length) return { rows: [], counts: {}, items: {}, today: todayISO() };

  const ids = lines.map(l => l.id);
  const [rollupById, unitCounts, inventory, resv, pieceResv, receipts, qcHeld, needBy, asm, pieces, tol, released] = await Promise.all([
    getAssemblyRollupMap(), getProjectUnitCounts(), getInventoryItems(),
    queryAll(`SELECT bom_item_id, SUM(qty - COALESCE(qty_issued,0)) AS n FROM inventory_reservations WHERE status='active' GROUP BY bom_item_id`),
    queryAll(`SELECT bom_item_id, COUNT(*) AS n FROM stock_pieces WHERE status='reserved' AND bom_item_id IS NOT NULL GROUP BY bom_item_id`),
    queryAll(`SELECT bom_item_id, SUM(qty_received) AS n FROM bom_item_receipts GROUP BY bom_item_id`),
    queryAll(`SELECT ia.bom_item_id, SUM(COALESCE(ia.qty_scalar, r.qty_received)) AS n
                FROM inward_approvals ia JOIN bom_item_receipts r ON r.id = ia.bom_item_receipt_id
               WHERE ia.status = 'pending' GROUP BY ia.bom_item_id`),
    queryAll(`SELECT project_id,
                     MIN(CASE WHEN department = 'Production' THEN planned_start END) AS prod_start,
                     MIN(planned_end) AS any_end
                FROM milestones GROUP BY project_id`),
    queryAll(`SELECT id, parent_id, name FROM bom_assemblies`),
    queryAll(`SELECT sp.id, sp.code, sp.inventory_item_id, sp.thickness_mm, sp.length_mm, sp.width_mm, sp.owner_project_id,
                     i.category, i.moc AS inv_moc, i.spec AS inv_spec, i.item_id AS inv_item_id
                FROM stock_pieces sp JOIN inventory_items i ON i.id = sp.inventory_item_id
               WHERE sp.status = 'available' AND i.track_pieces = 1`),
    getRemnantMatchTolerances(),
    queryAll(`SELECT DISTINCT project_id FROM milestones WHERE milestone_key = 'release_bom' AND status = 'done'`),
  ]);

  const num = rows => new Map(rows.map(r => [r.bom_item_id, Number(r.n) || 0]));
  const resvBy = num(resv), pieceBy = num(pieceResv), recvBy = num(receipts), qcBy = num(qcHeld);
  const needBy_ = new Map(needBy.map(r => [r.project_id, r.prod_start || r.any_end || null]));
  const releasedSet = new Set(released.map(r => r.project_id));
  const asmById = new Map(asm.map(a => [a.id, a]));
  const rootName = id => { let a = asmById.get(id), g = 0; while (a?.parent_id && g++ < 50) a = asmById.get(a.parent_id); return a?.name || null; };

  // Free stock pools: one per catalog-linked scalar/batch inventory row. Piece-tracked rows are
  // matched by geometry below; serial rows are discrete units reserved elsewhere.
  const poolByItem = new Map(), pools = {}, invById = new Map();
  for (const i of inventory) {
    invById.set(i.id, i);
    if (i.item_id != null && !i.track_pieces && ['scalar', 'batch', null, undefined].includes(i.tracking_mode)) {
      poolByItem.set(i.item_id, i.id);
      pools[i.id] = Math.max(0, Number(i.available) || 0);
    }
  }

  await attachDeliveryLotDates(lines);   // adds delivery_lots / unscheduled_* (mutates in place)

  const pieceRows = pieces.map(p => ({ ...p, invMocNorm: normalizeMaterial(p.inv_moc), invSpecNorm: normalizeMaterial(p.inv_spec) }));
  const planLines = lines.map(l => {
    const unit = unitCounts.get(l.project_id) ?? 1;
    const lots = (l.delivery_lots || []).map(x => ({ qty: x.qty, date: x.expected_delivery_date }));
    const poQty = lots.reduce((s, x) => s + x.qty, 0) + (l.unscheduled_qty || 0);
    const dims = parseDims(l);
    return {
      id: l.id, project_id: l.project_id, item_id: l.item_id,
      required: itemRollupQty(l.qty_text, l.assembly_id, rollupById, unit, !!l.qty_resolved),
      ambiguous: hasAmbiguousQty(l.qty_text),
      purchase_status: l.purchase_status || 'Enquiry', pending_review: l.pending_review,
      needBy: needBy_.get(l.project_id) || null,
      // same visibility rule as getSourcingItems(): a plain BOM line waits for release_bom; PR-raised and stock/SAS lines don't
      released: l.project_is_system || l.pr_item_id != null || releasedSet.has(l.project_id),
      received: recvBy.get(l.id) || 0, reservedNet: resvBy.get(l.id) || 0, reservedPieces: pieceBy.get(l.id) || 0,
      poolKey: l.item_id != null ? (poolByItem.get(l.item_id) ?? null) : null,
      dims, reqMoc: dims ? normalizeMaterial(l.moc) : null,
      poQty, lots, unscheduledQty: l.unscheduled_qty || 0, unscheduledDate: l.unscheduled_expected_delivery || null,
      qcHeldQty: qcBy.get(l.id) || 0,
    };
  });

  const today = todayISO();
  const plan = computePlan({ lines: planLines, pools, pieces: pieceRows, today, thicknessTol: tol.plate?.thickness_mm ?? 0.3 });
  const info = new Map(lines.map(l => [l.id, l]));
  const rows = plan.rows.map(r => {
    const l = info.get(r.id);
    const sentinel = !!l.project_is_system;
    return {
      ...r,
      description: l.material_description, moc: l.moc, size_spec: l.size_spec, qty_text: l.qty_text,
      catalog_item_code: l.catalog_item_code, source: l.source,
      project_label: sentinel ? (l.source === 'sas' ? `SO #${l.sale_order_no || ''}`.trim() : 'Stock') : l.project_no,
      customer_name: sentinel ? null : l.customer_name,
      group: rootName(l.assembly_id),
      inventory_item_id: r.poolKey,
      inventory_description: r.poolKey != null ? invById.get(r.poolKey)?.description : null,
      // Extra fields Stores' Reserve dialog / match hints / Raise-PR read (same names getOpenBomItems uses)
      material_description: l.material_description, category: l.category, category_fields_json: l.category_fields_json,
      rolled_qty: r.required, pr_item_id: l.pr_item_id ?? null, requires_manufacturing: l.requires_manufacturing,
      qty_breakdown: qtyBreakdown(l.qty_text, l.assembly_id, rollupById, unitCounts.get(l.project_id) ?? 1, !!l.qty_resolved),
      demand: demandState(r),
    };
  });
  return { rows, counts: plan.counts, items: plan.items, today };
}

// Stores' Demand tab: one card per project, windowed by need-by. Need-by rule = getPlanInner's (first
// Production planned_start, else earliest planned_end). The plan is run over EVERY project with
// need-by <= cutoff (never just the cards shown) because free stock is handed out in need-by order — an
// excluded earlier project would otherwise leave stock that a later one wrongly appears to get.
// ponytail: undated projects sort last in the engine but are planned here without the dated projects
// beyond the window, so their "free stock" can be optimistic; widen the window to see the full picture.
export async function getProjectPlanSummaries({ withinDays = 14 } = {}) {
  const today = todayISO();
  const cutoff = new Date(today + 'T00:00:00Z'); cutoff.setUTCDate(cutoff.getUTCDate() + Number(withinDays));
  const cut = cutoff.toISOString().slice(0, 10);
  const projects = await queryAll(
    `SELECT p.id, p.is_system,
            MIN(CASE WHEN m.department = 'Production' THEN m.planned_start END) AS prod_start,
            MIN(m.planned_end) AS any_end
       FROM projects p LEFT JOIN milestones m ON m.project_id = p.id
      WHERE p.status IN ('active','system') AND p.master_project_id IS NULL
      GROUP BY p.id`);
  const need = p => p.prod_start || p.any_end || null;
  const ids = projects.filter(p => p.is_system || !need(p) || need(p) <= cut).map(p => p.id);
  if (!ids.length) return { projects: [], cutoff: cut, today };
  const plan = await getPlan({ projectIds: ids });
  const byProject = new Map();
  for (const r of plan.rows) {
    if (!byProject.has(r.project_id)) byProject.set(r.project_id, []);
    byProject.get(r.project_id).push(r);
  }
  const out = [...byProject.entries()].map(([project_id, rows]) => {
    const f = rows[0];
    return {
      project_id, project_label: f.project_label, customer_name: f.customer_name, needBy: f.needBy,
      is_stock: rows.every(r => r.source === 'stock'), group: f.needBy ? 'window' : 'nodate',
      ...summarizeProject(rows),
    };
  }).sort((a, b) => (a.needBy || '9').localeCompare(b.needBy || '9'));
  return { projects: out, cutoff: cut, today };
}
