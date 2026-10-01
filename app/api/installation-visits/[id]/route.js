import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

async function guard() {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Installation')) return { res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  const denied = await requireAction(user, 'Installation', 'installation.visit.write');
  return denied ? { res: denied } : { user };
}

export async function PATCH(req, { params }) {
  const { user, res } = await guard();
  if (res) return res;
  const { id } = await params;
  const row = await queryOne('SELECT * FROM installation_visits WHERE id = ?', [id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const b = await req.json();
  const description = b.description !== undefined ? String(b.description).trim() : row.description;
  if (!description) return NextResponse.json({ error: 'Description is required' }, { status: 400 });
  const pick = (k) => (b[k] !== undefined ? (b[k] || null) : row[k]);
  await execute(
    `UPDATE installation_visits SET description = ?, visit_date = ?, visit_time = ?, visited_by = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [description, pick('visit_date'), pick('visit_time'), pick('visited_by'), b.status === 'done' ? 'done' : b.status === 'planned' ? 'planned' : row.status, id]
  );
  await audit('installation_visit_edit', { actor: user.username, detail: `visit ${id}` });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const { user, res } = await guard();
  if (res) return res;
  const { id } = await params;
  await execute('DELETE FROM installation_visits WHERE id = ?', [id]);
  await audit('installation_visit_deleted', { actor: user.username, detail: `visit ${id}` });
  return NextResponse.json({ ok: true });
}
