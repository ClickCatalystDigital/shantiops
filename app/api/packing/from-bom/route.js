// app/api/packing/from-bom/route.js

import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne, nextNumber } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getProjectBom, getAssemblyRollupMap } from '@/lib/data';
import { itemRollupQty } from '@/lib/bom-structure.mjs';
import { audit } from '@/lib/usb';

// Auto-generate a DRAFT packing list from a project's still-pending BOM lines. Prefills
// material_description / moc / size_spec / make from each BOM row, and qty when the BOM's free-text
// qty starts with a number ("2 Nos" → 2); leaves IBR No / Item Code / Box for the Dispatch head.
// Only pending lines are pulled (handles partial dispatch).
export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.generate');
  if (actionDenied) return actionDenied;

  const { project_id } = await req.json();
  if (!project_id) return NextResponse.json({ error: 'project_id is required' }, { status: 400 });

  const project = await queryOne('SELECT * FROM projects WHERE id = ?', [project_id]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const { readyForPacking } = await getProjectBom(project_id);
  if (!readyForPacking.length) return NextResponse.json({ error: 'No BOM lines ready to pack yet — Production hasn\'t marked any as done' }, { status: 400 });

  // readyForPacking still includes anything sitting on an existing DRAFT list — getProjectBom's
  // `pending` deliberately keeps a line "pending" until its list is actually approved (packed/
  // dispatched), so an abandoned draft doesn't strand the line. That's correct for the generic
  // Pending badge everywhere else, but left unguarded here it means clicking Generate twice while a
  // draft is still open silently duplicates every one of its lines onto a second list. Excluded here
  // — at the point of creating a NEW list — regardless of the existing list's status.
  const alreadyDrafted = await queryAll(
    `SELECT DISTINCT pi.bom_item_id FROM packing_items pi
       JOIN packing_lists pl ON pl.id = pi.packing_list_id
      WHERE pl.project_id = ? AND pi.bom_item_id IS NOT NULL`, [project_id]
  );
  const draftedIds = new Set(alreadyDrafted.map(r => r.bom_item_id));
  const newItems = readyForPacking.filter(b => !draftedIds.has(b.id));
  if (!newItems.length) {
    return NextResponse.json({ error: 'Every ready item is already on an existing packing list for this project — open it to add more, or wait for it to be approved.' }, { status: 400 });
  }

  const packing_no = await nextNumber('packing_no', 'PL');
  const pl = await execute(
    'INSERT INTO packing_lists (project_id, packing_no, customer_name, created_by) VALUES (?, ?, ?, ?)',
    [project_id, packing_no, project.customer_name, user?.username || null]
  );
  const listId = Number(pl.lastId);

  const rollupById = await getAssemblyRollupMap(project_id);
  let s = 1;
  for (const b of newItems) {
    // "2 Nos" -> 2, scaled by any Local Quantity multiplier on the item's own BOM-tree node (and
    // every node above it) times the project's own Whole-BOM Unit Count (project.unit_count,
    // already loaded above — no second query needed); non-numeric ("AS REQD") -> 1, same fallback
    // as before either multiplier existed.
    const qty = itemRollupQty(b.qty_text, b.assembly_id, rollupById, project.unit_count, !!b.qty_resolved) ?? 1;
    await execute(
      `INSERT INTO packing_items (packing_list_id, bom_item_id, s_no, material_description, moc, size_spec, make, qty, unit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [listId, b.id, s++, b.material_description, b.moc || null, b.size_spec || null, b.make || null, qty, "No's"]
    );
  }
  await audit('packing_created', { actor: user.username, detail: `${packing_no} · project ${project_id} · ${newItems.length} items` });
  return NextResponse.json({ id: listId, packing_no, items: newItems.length });
}
