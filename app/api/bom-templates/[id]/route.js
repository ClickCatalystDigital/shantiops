import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll } from '@/lib/db';
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

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canTouch(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  await execute('DELETE FROM bom_template_items WHERE template_id = ?', [params.id]);
  await execute('DELETE FROM bom_templates WHERE id = ?', [params.id]);
  return NextResponse.json({ ok: true });
}
