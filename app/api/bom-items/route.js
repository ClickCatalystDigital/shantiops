import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { BOM_FIELDS } from '@/lib/bom-fields.mjs';

// Add a single BOM item in-app (materials get added mid-project — the BOM definition is
// Engineering's, so this is Engineering/PM-gated like upload).
export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Engineering');
  if (denied) return denied;

  const b = await req.json();
  if (!b.project_id || !b.material_description?.trim()) {
    return NextResponse.json({ error: 'project_id and material_description are required' }, { status: 400 });
  }
  const project = await queryOne('SELECT id FROM projects WHERE id = ?', [b.project_id]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const max = await queryOne(
    'SELECT MAX(sort_order) AS m FROM bom_items WHERE project_id = ?', [b.project_id]);
  const fields = ['material_description', ...BOM_FIELDS.filter(f => f !== 'material_description')];
  const values = fields.map(f =>
    typeof b[f] === 'string' && b[f].trim() ? b[f].trim() : null);
  values[0] = b.material_description.trim();

  const res = await execute(
    `INSERT INTO bom_items (project_id, sort_order, ${fields.join(', ')})
     VALUES (?, ?, ${fields.map(() => '?').join(', ')})`,
    [b.project_id, (max?.m ?? -1) + 1, ...values]);

  await audit('bom_item_add', {
    actor: user.username,
    detail: JSON.stringify({ bom_item_id: Number(res.lastId), project_id: b.project_id, description: values[0] }),
  });
  return NextResponse.json({ id: Number(res.lastId) });
}
