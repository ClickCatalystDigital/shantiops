// app/api/bom-templates/route.js — reusable per-boiler-model material lists (Requests' Templates
// tab), so a new project's BOM can start from a real starting point instead of a blank form every
// time. Same department gate as raising a PR (PrWorkspace.jsx) — templating a material list is the
// same kind of BOM-authoring work.
import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';

const TEMPLATE_DEPARTMENTS = ['Engineering', 'Design', 'Stores'];
function canTouch(user) { return TEMPLATE_DEPARTMENTS.some(d => canAccessDepartment(user, d)); }

export async function GET() {
  const user = await getFreshSessionUser();
  if (!canTouch(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const templates = await queryAll(
    `SELECT t.*, (SELECT COUNT(*) FROM bom_template_items i WHERE i.template_id = t.id) AS item_count
       FROM bom_templates t ORDER BY t.name`
  );
  return NextResponse.json(templates);
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!canTouch(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const { lastId } = await execute(
    'INSERT INTO bom_templates (name, series, description, created_by) VALUES (?, ?, ?, ?)',
    [name, b.series?.trim() || null, b.description?.trim() || null, user.username]
  );
  const templateId = Number(lastId);

  const items = Array.isArray(b.items) ? b.items : [];
  let sortOrder = 0;
  for (const it of items) {
    if (!it.material_description?.trim()) continue;
    const categoryFieldsJson = it.category && it.category_fields ? JSON.stringify(it.category_fields) : null;
    await execute(
      `INSERT INTO bom_template_items (template_id, section, material_description, moc, size_spec, qty_text, sort_order, item_id, category, category_fields_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [templateId, it.section?.trim() || null, it.material_description.trim(), it.moc?.trim() || null,
        it.size_spec?.trim() || null, it.qty_text?.trim() || null, sortOrder++,
        it.item_id ? Number(it.item_id) : null, it.category || null, categoryFieldsJson]
    );
  }
  return NextResponse.json({ id: templateId });
}
