// Multi-unit split — Stores' active routing decision, per (master BOM line, child unit): does
// allocated-and-ready material go to Production or straight to Dispatch. Current-state upsert (not
// append-only, unlike bom_item_child_allocations) — history lives in usb_audit via audit() below,
// same as every other current-state decision in this app. The server-side readiness check here is
// the real enforcement; a UI only ever offers ready cells, but a direct call must be blocked too.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { execute, queryOne, queryAll } from '@/lib/db';
import { audit } from '@/lib/usb';
import { getAssemblyRollupMap } from '@/lib/data';
import { itemRollupQty } from '@/lib/bom-structure.mjs';

const VALID_ROUTES = new Set(['production', 'dispatch']);

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Stores', 'stores.bom.route');
  if (actionDenied) return actionDenied;

  const item = await queryOne('SELECT * FROM bom_items WHERE id = ?', [params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const routedTo = String(b.routed_to || '');
  if (!VALID_ROUTES.has(routedTo)) {
    return NextResponse.json({ error: "routed_to must be 'production' or 'dispatch'" }, { status: 400 });
  }
  const ids = Array.isArray(b.child_project_ids) ? [...new Set(b.child_project_ids.map(Number).filter(Boolean))] : [];
  if (!ids.length) return NextResponse.json({ error: 'Pick at least one unit' }, { status: 400 });

  const placeholders = ids.map(() => '?').join(',');
  const children = await queryAll(
    `SELECT id, project_no FROM projects WHERE id IN (${placeholders}) AND master_project_id = ?`,
    [...ids, item.project_id]);
  if (children.length !== ids.length) {
    return NextResponse.json({ error: 'One or more selected units are not children of this BOM line\'s own project' }, { status: 400 });
  }

  // Server-side readiness gate — recomputed here, not trusted from the UI's own filtered list.
  const [rollupById, allocatedRows] = await Promise.all([
    getAssemblyRollupMap(item.project_id),
    queryAll(
      `SELECT child_project_id, COALESCE(SUM(qty_allocated), 0) AS total FROM bom_item_child_allocations
        WHERE bom_item_id = ? AND child_project_id IN (${placeholders}) GROUP BY child_project_id`,
      [item.id, ...ids]),
  ]);
  const perUnit = itemRollupQty(item.qty_text, item.assembly_id, rollupById, 1, !!item.qty_resolved) ?? 1;
  const allocatedMap = new Map(allocatedRows.map(r => [r.child_project_id, Number(r.total)]));
  const notReady = children.filter(c => (allocatedMap.get(c.id) ?? 0) < perUnit);
  if (notReady.length) {
    return NextResponse.json(
      { error: `Not fully allocated yet: ${notReady.map(c => c.project_no).join(', ')}` }, { status: 400 });
  }

  for (const child of children) {
    await execute(
      `INSERT INTO bom_item_child_routing (bom_item_id, child_project_id, routed_to, decided_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(bom_item_id, child_project_id) DO UPDATE SET
         routed_to = excluded.routed_to, decided_by = excluded.decided_by, decided_at = CURRENT_TIMESTAMP`,
      [item.id, child.id, routedTo, user.username]);
  }

  await audit('bom_item_routed', {
    actor: user.username,
    detail: `bom_item #${item.id} -> ${routedTo} for ${children.length} unit(s)`,
  });
  return NextResponse.json({ ok: true, routed: children.length, routed_to: routedTo });
}
