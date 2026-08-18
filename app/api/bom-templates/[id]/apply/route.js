// Applies a BOM template's items onto a real project's BOM — same materialization shape a normal
// PR line gets (purchase_status='Enquiry', pending_review=1, so Stores still reviews before
// Procurement sees it — a template doesn't bypass that gate, it just seeds the starting rows).
import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { notifyDepartment } from '@/lib/notify';

const TEMPLATE_DEPARTMENTS = ['Engineering', 'Design', 'Stores'];
function canTouch(user) { return TEMPLATE_DEPARTMENTS.some(d => canAccessDepartment(user, d)); }

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canTouch(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  if (!b.project_id) return NextResponse.json({ error: 'project_id is required' }, { status: 400 });

  const project = await queryOne('SELECT id FROM projects WHERE id = ?', [b.project_id]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  const items = await queryAll('SELECT * FROM bom_template_items WHERE template_id = ? ORDER BY sort_order, id', [params.id]);
  if (!items.length) return NextResponse.json({ error: 'This template has no items' }, { status: 400 });

  // Continue the project's own sort_order sequence rather than restarting at 0, so applied items
  // land after whatever's already on the BOM instead of interleaving at the top.
  const maxRow = await queryOne('SELECT MAX(sort_order) AS m FROM bom_items WHERE project_id = ?', [b.project_id]);
  let n = (maxRow?.m ?? -1) + 1;
  for (const it of items) {
    await execute(
      `INSERT INTO bom_items (project_id, section, material_description, moc, size_spec, qty_text, purchase_status, pending_review, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, 'Enquiry', 1, ?)`,
      [b.project_id, it.section, it.material_description, it.moc, it.size_spec, it.qty_text, n]
    );
    n++;
  }
  const inserted = n - ((maxRow?.m ?? -1) + 1);
  if (inserted > 0) {
    try {
      const project = await queryOne('SELECT project_no FROM projects WHERE id = ?', [b.project_id]);
      await notifyDepartment('Stores', {
        kind: 'bom_released', title: `New BOM: ${project?.project_no || b.project_id}`,
        body: `${inserted} item(s) from a template`, dedupe_key: `bom_template_apply:${params.id}:${b.project_id}`,
      });
      // Engineering owns the BOM definition (same ownership precedent as the project-creation
      // notify block) — a template being applied is a BOM taking shape they should know about,
      // whether or not they're the ones who applied it.
      await notifyDepartment('Engineering', {
        kind: 'bom_template_applied', title: `BOM template applied: ${project?.project_no || b.project_id}`,
        body: `${inserted} item(s) from a template`, dedupe_key: `bom_template_apply_eng:${params.id}:${b.project_id}`,
      }, { except: user.id });
    } catch (err) { /* notification is best-effort */ }
  }
  return NextResponse.json({ inserted });
}
