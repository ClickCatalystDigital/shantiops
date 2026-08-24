// Applies a BOM template's items onto a real project's BOM — same materialization shape a normal
// PR line gets (purchase_status='Enquiry', pending_review=1, so Stores still reviews before
// Procurement sees it — a template doesn't bypass that gate, it just seeds the starting rows).
import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { notifyDepartment } from '@/lib/notify';
import { matchAndReserve } from '@/lib/remnant-match';

const TEMPLATE_DEPARTMENTS = ['Engineering', 'Design', 'Stores'];
function canTouch(user) { return TEMPLATE_DEPARTMENTS.some(d => canAccessDepartment(user, d)); }

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canTouch(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  if (!b.project_id) return NextResponse.json({ error: 'project_id is required' }, { status: 400 });

  // 'pr' templates never reach here through the UI (Templates tab hands them to "Use in Raise PR",
  // which pre-fills the Raise PR form and submits through /api/purchase-requisitions instead) — a
  // direct insert would silently skip the real PR record that kind is supposed to produce, so it's
  // rejected outright rather than only relied on the UI never offering the button.
  const template = await queryOne('SELECT kind FROM bom_templates WHERE id = ?', [params.id]);
  if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  if (template.kind !== 'bom') return NextResponse.json({ error: 'This is a PR template — use "Use in Raise PR" instead' }, { status: 400 });

  const project = await queryOne('SELECT id FROM projects WHERE id = ?', [b.project_id]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  const items = await queryAll('SELECT * FROM bom_template_items WHERE template_id = ? ORDER BY sort_order, id', [params.id]);
  if (!items.length) return NextResponse.json({ error: 'This template has no items' }, { status: 400 });

  // Applying is always additive (project material lines below never get deleted/replaced — the
  // point of "apply Template A, then Template B, then Template C" is a bigger BOM, not a swapped
  // one) — but re-applying the same or an overlapping template onto a project it's already been
  // applied to is very likely a mistake, not intent. Detect via item_id (the real catalog identity,
  // §3.2/§5k) rather than description text, and require an explicit confirm before inserting a
  // second copy of something already on the BOM.
  const itemIds = items.map(it => it.item_id).filter(Boolean);
  if (itemIds.length && !b.confirm) {
    const dupes = await queryAll(
      `SELECT DISTINCT it.item_name FROM bom_items bi JOIN items it ON it.id = bi.item_id
        WHERE bi.project_id = ? AND bi.item_id IN (${itemIds.map(() => '?').join(',')})`,
      [b.project_id, ...itemIds]
    );
    if (dupes.length) {
      return NextResponse.json({ needsConfirm: true, duplicates: dupes.map(d => d.item_name) });
    }
  }

  // Continue the project's own sort_order sequence rather than restarting at 0, so applied items
  // land after whatever's already on the BOM instead of interleaving at the top.
  const maxRow = await queryOne('SELECT MAX(sort_order) AS m FROM bom_items WHERE project_id = ?', [b.project_id]);
  let n = (maxRow?.m ?? -1) + 1;
  // Cutting & Remnant Management (§5k) — a template item's category/dims/item_id (now carried
  // through, same fields a hand-composed BOM line gets) is what makes an applied line remnant-
  // matchable at all; if the project's BOM was already released, run the exact same late-add
  // check the single bom-item POST route already does, so a template applied after Release BOM
  // isn't a silent gap in matching coverage.
  const released = await queryOne(
    `SELECT 1 FROM milestones WHERE project_id = ? AND milestone_key = 'release_bom' AND status = 'done'`,
    [b.project_id]
  );
  for (const it of items) {
    const { lastId } = await execute(
      `INSERT INTO bom_items (project_id, section, material_description, moc, size_spec, qty_text, purchase_status, pending_review, sort_order, item_id, category, category_fields_json, named_parts_json, template_id)
       VALUES (?, ?, ?, ?, ?, ?, 'Enquiry', 1, ?, ?, ?, ?, ?, ?)`,
      [b.project_id, it.section, it.material_description, it.moc, it.size_spec, it.qty_text, n,
        it.item_id, it.category, it.category_fields_json, it.named_parts_json, Number(params.id)]
    );
    n++;
    if (released) {
      try {
        const bomItem = await queryOne('SELECT * FROM bom_items WHERE id = ?', [Number(lastId)]);
        await matchAndReserve(bomItem, user.username);
      } catch (err) { /* best-effort, same stance as the release-bom hook */ }
    }
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
