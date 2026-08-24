import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll, withTransaction } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';

const TEMPLATE_DEPARTMENTS = ['Engineering', 'Design', 'Stores'];
function canTouch(user) { return TEMPLATE_DEPARTMENTS.some(d => canAccessDepartment(user, d)); }

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canTouch(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const template = await queryOne('SELECT * FROM bom_templates WHERE id = ?', [params.id]);
  if (!template) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const items = await queryAll('SELECT * FROM bom_template_items WHERE template_id = ? ORDER BY sort_order, id', [params.id]);
  return NextResponse.json({ ...template, items });
}

// Edit — this is also what powers "view a template's items" (the New/Edit form pre-filled and
// left untouched is a perfectly good read-only look). name/series only; kind is deliberately not
// editable here (the UI fixes it at creation via which section's "+ New" button was used — no
// picker in the edit form, no reason a template should switch kind mid-life). Items are always
// replaced whole, never diffed: same "read/written whole" shape the original POST already used,
// and nothing else references an individual bom_template_items.id. Wrapped in one transaction so a
// failure partway through an item re-insert can't leave the template with its old items gone and
// none of the new ones in.
export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canTouch(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const existing = await queryOne('SELECT id FROM bom_templates WHERE id = ?', [params.id]);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  const items = Array.isArray(b.items) ? b.items.filter(it => it.material_description?.trim()) : [];

  await withTransaction(async tx => {
    await tx.execute({
      sql: 'UPDATE bom_templates SET name = ?, series = ? WHERE id = ?',
      args: [name, b.series?.trim() || null, params.id],
    });
    await tx.execute({ sql: 'DELETE FROM bom_template_items WHERE template_id = ?', args: [params.id] });
    let sortOrder = 0;
    for (const it of items) {
      const categoryFieldsJson = it.category && it.category_fields ? JSON.stringify(it.category_fields) : null;
      const namedPartsJson = it.category && it.named_parts?.length ? JSON.stringify(it.named_parts) : null;
      await tx.execute({
        sql: `INSERT INTO bom_template_items (template_id, section, material_description, moc, size_spec, qty_text, sort_order, item_id, category, category_fields_json, named_parts_json)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [params.id, it.section?.trim() || null, it.material_description.trim(), it.moc?.trim() || null,
          it.size_spec?.trim() || null, it.qty_text?.trim() || null, sortOrder++,
          it.item_id ? Number(it.item_id) : null, it.category || null, categoryFieldsJson, namedPartsJson],
      });
    }
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canTouch(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  await execute('DELETE FROM bom_template_items WHERE template_id = ?', [params.id]);
  await execute('DELETE FROM bom_templates WHERE id = ?', [params.id]);
  return NextResponse.json({ ok: true });
}
