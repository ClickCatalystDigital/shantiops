// app/api/packing/from-bom/route.js

import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne, nextNumber } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getProjectBom } from '@/lib/data';
import { audit } from '@/lib/usb';

// Auto-generate a DRAFT packing list from a project's still-pending BOM lines. Prefills
// material_description / moc / size_spec / make from each BOM row, and qty when the BOM's free-text
// qty starts with a number ("2 Nos" → 2); leaves IBR No / Item Code / Box for the Dispatch head.
// Only pending lines are pulled (handles partial dispatch).
export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;

  const { project_id } = await req.json();
  if (!project_id) return NextResponse.json({ error: 'project_id is required' }, { status: 400 });

  const project = await queryOne('SELECT * FROM projects WHERE id = ?', [project_id]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const { pending } = await getProjectBom(project_id);
  if (!pending.length) return NextResponse.json({ error: 'No pending BOM lines to pack' }, { status: 400 });

  const packing_no = await nextNumber('packing_no', 'PL');
  const pl = await execute(
    'INSERT INTO packing_lists (project_id, packing_no, customer_name, created_by) VALUES (?, ?, ?, ?)',
    [project_id, packing_no, project.customer_name, user?.username || null]
  );
  const listId = Number(pl.lastId);

  let s = 1;
  for (const b of pending) {
    const qty = parseFloat(b.qty_text) || 1; // "2 Nos" → 2; non-numeric ("AS REQD") → 1
    await execute(
      `INSERT INTO packing_items (packing_list_id, bom_item_id, s_no, material_description, moc, size_spec, make, qty, unit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [listId, b.id, s++, b.material_description, b.moc || null, b.size_spec || null, b.make || null, qty, "No's"]
    );
  }
  await audit('packing_created', { actor: user.username, detail: `${packing_no} · project ${project_id} · ${pending.length} items` });
  return NextResponse.json({ id: listId, packing_no, items: pending.length });
}
