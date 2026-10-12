// Multi-unit BOM split, Phase 7 (MULTI-UNIT-SPLIT-DESIGN.md §4 Dispatch) — batch action: pick
// several child units, get one packing list per child, each pre-filled with only the BOM lines
// Stores has actually allocated AND routed to Dispatch for that specific unit (Stores per-child
// routing — getChildRoutingBoard, the single shared source of truth for "ready"/"routed" used by
// both this route and ChildRoutingPanel's own write UI). This is a real behavior change from the
// original build: it used to apply the master's aggregate "ready to pack" list uniformly to every
// selected child, ignoring allocation/routing entirely — a child now only gets what Stores has
// actively decided is theirs. Per the guiding principle: one action, N separate packing lists, each
// its own e-way bill / dispatch date / delivery — never one merged shipment.
//
// Dispatch already has real multi-lot support at the master level (POST /api/packing/from-bom
// already excludes whatever's already drafted and can be called again as more material becomes
// ready) — this reuses that exact exclusion idiom, just scoped per child instead of per project, so
// re-running this batch action after Stores routes more lines only adds the NEW lines to each
// child's own list(s) rather than duplicating what's already there.
import { NextResponse } from 'next/server';
import { queryOne, queryAll } from '@/lib/db';
import { createPackingLists } from '@/lib/packing-generate';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getChildRoutingBoard } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.generate');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const masterId = Number(b.master_project_id);
  const childIds = Array.isArray(b.child_project_ids) ? b.child_project_ids.map(Number).filter(Boolean) : [];
  if (!masterId) return NextResponse.json({ error: 'master_project_id is required' }, { status: 400 });
  if (!childIds.length) return NextResponse.json({ error: 'Pick at least one unit' }, { status: 400 });

  const master = await queryOne('SELECT id, customer_name, bom_release_revision FROM projects WHERE id = ?', [masterId]);
  if (!master) return NextResponse.json({ error: 'Master project not found' }, { status: 404 });

  const placeholders = childIds.map(() => '?').join(',');
  const children = await queryAll(
    `SELECT id FROM projects WHERE id IN (${placeholders}) AND master_project_id = ? ORDER BY unit_no`,
    [...childIds, masterId]);
  if (children.length !== childIds.length) {
    return NextResponse.json({ error: 'One or more selected units are not children of this master project' }, { status: 400 });
  }

  const board = await getChildRoutingBoard(masterId);
  const linesById = new Map(board.lines.map(l => [l.id, l]));
  const dispatchCellsByChild = new Map();
  for (const c of board.cells) {
    // Straight to Dispatch, or made in Production and handed over (Shop Floor > Dispatch).
    const toDispatch = c.routed_to === 'dispatch' || (c.routed_to === 'production' && c.handed_over >= c.per_unit_required);
    if (!c.ready || !toDispatch) continue;
    if (!dispatchCellsByChild.has(c.child_project_id)) dispatchCellsByChild.set(c.child_project_id, []);
    dispatchCellsByChild.get(c.child_project_id).push(c);
  }
  if (!dispatchCellsByChild.size) {
    return NextResponse.json(
      { error: 'Nothing routed to Dispatch yet — Stores allocates material to a unit, then routes it to Dispatch.' },
      { status: 400 });
  }

  const created = [];
  const skipped = [];
  for (const child of children) {
    const cells = dispatchCellsByChild.get(child.id) || [];
    if (!cells.length) { skipped.push(child.id); continue; }

    // Same exclusion idiom as POST /api/packing/from-bom, scoped to this one child instead of the
    // whole project — lets the batch be re-run safely as more lines get routed to Dispatch.
    const alreadyDrafted = await queryAll(
      `SELECT DISTINCT pi.bom_item_id FROM packing_bom_links pi
         JOIN packing_lists pl ON pl.id = pi.packing_list_id
        WHERE pl.project_id = ? AND pi.bom_item_id IS NOT NULL`, [child.id]);
    const draftedIds = new Set(alreadyDrafted.map(r => r.bom_item_id));
    const newCells = cells.filter(c => !draftedIds.has(c.bom_item_id) && linesById.has(c.bom_item_id));
    if (!newCells.length) { skipped.push(child.id); continue; }

    const bomRows = await queryAll(
      `SELECT id, assembly_id, material_description, moc, size_spec, make FROM bom_items WHERE id IN (${newCells.map(() => '?').join(',')})`,
      newCells.map(c => c.bom_item_id));
    const bomById = new Map(bomRows.map(r => [r.id, r]));
    const childProject = await queryOne('SELECT id, company FROM projects WHERE id = ?', [child.id]);
    const lists = await createPackingLists({
      project: childProject, treeProjectId: masterId, customerName: master.customer_name, user,
      revision: master.bom_release_revision ?? null,
      lines: newCells.map(c => ({ b: bomById.get(c.bom_item_id), qty: c.per_unit_required })),
      layout: b.layout === 'sections' ? 'sections' : 'combined',
    });
    for (const l of lists) created.push({ child_project_id: child.id, packing_list_id: l.id, packing_no: l.packing_no, items: l.items });
  }

  await audit('packing_batch_created', {
    actor: user.username, detail: `${created.length} packing lists for master ${masterId} (${skipped.length} skipped, nothing new)`,
  });
  return NextResponse.json({ ok: true, created, skipped });
}
