// app/api/packing/from-bom/route.js

import { NextResponse } from 'next/server';
import { queryAll, queryOne } from '@/lib/db';
import { createPackingLists } from '@/lib/packing-generate';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getProjectBom, getAssemblyRollupMap } from '@/lib/data';
import { itemRollupQty } from '@/lib/bom-structure.mjs';
import { audit } from '@/lib/usb';
import { COMPANY_NAMES } from '@/lib/company-profiles';

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

  const { project_id, layout, bom_item_ids, company, allow_not_ready } = await req.json();
  if (!project_id) return NextResponse.json({ error: 'project_id is required' }, { status: 400 });

  const project = await queryOne('SELECT * FROM projects WHERE id = ?', [project_id]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  if (company && !COMPANY_NAMES.includes(company)) return NextResponse.json({ error: 'Unknown company' }, { status: 400 });

  const { readyForPacking, pending } = await getProjectBom(project_id);
  // Picked lines (Dispatch ticked some in Pending Items) are used as-is; a picked line that hasn't
  // arrived yet is only allowed when the caller says so (the screen asks first).
  const picked = Array.isArray(bom_item_ids) && bom_item_ids.length ? new Set(bom_item_ids.map(Number)) : null;
  let candidates = readyForPacking;
  if (picked) {
    candidates = pending.filter(b => picked.has(b.id));
    if (candidates.length !== picked.size) return NextResponse.json({ error: 'Some picked items are no longer pending — refresh and try again' }, { status: 409 });
    const notReady = candidates.filter(b => !readyForPacking.some(r => r.id === b.id));
    if (notReady.length && !allow_not_ready) {
      return NextResponse.json({ error: `${notReady.length} picked item(s) haven't been received/produced yet`, not_ready: notReady.length }, { status: 409 });
    }
  }
  if (!candidates.length) return NextResponse.json({ error: 'No BOM lines ready to pack yet — Production hasn\'t marked any as done' }, { status: 400 });

  // readyForPacking still includes anything sitting on an existing DRAFT list — getProjectBom's
  // `pending` deliberately keeps a line "pending" until its list is actually approved (packed/
  // dispatched), so an abandoned draft doesn't strand the line. That's correct for the generic
  // Pending badge everywhere else, but left unguarded here it means clicking Generate twice while a
  // draft is still open silently duplicates every one of its lines onto a second list. Excluded here
  // — at the point of creating a NEW list — regardless of the existing list's status.
  const alreadyDrafted = await queryAll(
    `SELECT DISTINCT pi.bom_item_id FROM packing_bom_links pi
       JOIN packing_lists pl ON pl.id = pi.packing_list_id
      WHERE pl.project_id = ? AND pi.bom_item_id IS NOT NULL`, [project_id]
  );
  const draftedIds = new Set(alreadyDrafted.map(r => r.bom_item_id));
  const newItems = candidates.filter(b => !draftedIds.has(b.id));
  if (!newItems.length) {
    return NextResponse.json({ error: 'Every ready item is already on an existing packing list for this project — open it to add more, or wait for it to be approved.' }, { status: 400 });
  }

  const rollupById = await getAssemblyRollupMap(project_id);
  // "2 Nos" -> 2, scaled by any Local Quantity multiplier on the item's own BOM-tree node (and every
  // node above it) times the project's Whole-BOM Unit Count; non-numeric ("AS REQD") -> 1.
  const lines = newItems.map(b => ({ b, qty: itemRollupQty(b.qty_text, b.assembly_id, rollupById, project.unit_count, !!b.qty_resolved) ?? 1 }));
  const created = await createPackingLists({ project, treeProjectId: project_id, customerName: project.customer_name, lines, user, layout: layout === 'sections' ? 'sections' : 'combined', company: company || null });
  await audit('packing_created', { actor: user.username, detail: `${created.map(c => c.packing_no).join(', ')} · project ${project_id} · ${newItems.length} items` });
  return NextResponse.json({ id: created[0].id, packing_no: created[0].packing_no, lists: created, items: newItems.length });
}
