// Multi-unit BOM split, Phase 7 (MULTI-UNIT-SPLIT-DESIGN.md §4 Dispatch) — batch action: pick
// several child units, get one packing list per child, each pre-filled from the MASTER's own
// ready-to-pack BOM lines (a child never has its own bom_items, per confirmed architecture) at the
// PER-UNIT quantity (unit multiplier of 1 — same "read master, scope to one unit" pattern §Phase 3's
// getChildDerivedBom and §Phase 6's QC batch route both already use), never the master's own
// aggregate quantity. Per the guiding principle: one action, N separate packing lists, each its own
// e-way bill / dispatch date / delivery — never one merged shipment.
//
// Dispatch already has real multi-lot support at the master level (POST /api/packing/from-bom
// already excludes whatever's already drafted and can be called again as more material becomes
// ready) — this reuses that exact exclusion idiom, just scoped per child instead of per project, so
// re-running this batch action after new master BOM lines become ready only adds the NEW lines to
// each child's own list(s) rather than duplicating what's already there.
import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll, nextNumber } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getProjectBom, getAssemblyRollupMap } from '@/lib/data';
import { itemRollupQty } from '@/lib/bom-structure.mjs';
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

  // The master's own ready-to-pack lines are the template every child draws from — this never reads
  // or writes the master's own packing lists, only its BOM readiness signal.
  const { readyForPacking } = await getProjectBom(masterId);
  if (!readyForPacking.length) {
    return NextResponse.json({ error: "No BOM lines ready to pack yet — Production hasn't marked any as done" }, { status: 400 });
  }
  const rollupById = await getAssemblyRollupMap(masterId);

  const created = [];
  const skipped = [];
  for (const child of children) {
    // Same exclusion idiom as POST /api/packing/from-bom, scoped to this one child instead of the
    // whole project — lets the batch be re-run safely as more master BOM lines become ready.
    const alreadyDrafted = await queryAll(
      `SELECT DISTINCT pi.bom_item_id FROM packing_items pi
         JOIN packing_lists pl ON pl.id = pi.packing_list_id
        WHERE pl.project_id = ? AND pi.bom_item_id IS NOT NULL`, [child.id]);
    const draftedIds = new Set(alreadyDrafted.map(r => r.bom_item_id));
    const newItems = readyForPacking.filter(item => !draftedIds.has(item.id));
    if (!newItems.length) { skipped.push(child.id); continue; }

    const packing_no = await nextNumber('packing_no', 'PL');
    const pl = await execute(
      'INSERT INTO packing_lists (project_id, packing_no, customer_name, created_by, bom_release_revision_at_creation) VALUES (?, ?, ?, ?, ?)',
      [child.id, packing_no, master.customer_name, user?.username || null, master.bom_release_revision ?? null]);
    const listId = Number(pl.lastId);

    let s = 1;
    for (const item of newItems) {
      // unit multiplier 1, deliberately not the master's own unit_count — this list is for ONE
      // physical unit, not the aggregate.
      const qty = itemRollupQty(item.qty_text, item.assembly_id, rollupById, 1, !!item.qty_resolved) ?? 1;
      await execute(
        `INSERT INTO packing_items (packing_list_id, bom_item_id, s_no, material_description, moc, size_spec, make, qty, unit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [listId, item.id, s++, item.material_description, item.moc || null, item.size_spec || null, item.make || null, qty, "No's"]);
    }
    created.push({ child_project_id: child.id, packing_list_id: listId, packing_no, items: newItems.length });
  }

  await audit('packing_batch_created', {
    actor: user.username, detail: `${created.length} packing lists for master ${masterId} (${skipped.length} skipped, nothing new)`,
  });
  return NextResponse.json({ ok: true, created, skipped });
}
