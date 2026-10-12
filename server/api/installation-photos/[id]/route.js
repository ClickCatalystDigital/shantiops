import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { PHOTO_STAGES } from '@/lib/installation-photo-stages.mjs';
import { deleteObject } from '@/lib/r2';
import { audit } from '@/lib/usb';

async function guard() {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Installation')) return { res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  const denied = await requireAction(user, 'Installation', 'installation.photo.write');
  return denied ? { res: denied } : { user };
}

export async function PATCH(req, { params }) {
  const { user, res } = await guard();
  if (res) return res;
  const { id } = await params;
  const row = await queryOne('SELECT * FROM installation_photos WHERE id = ?', [id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const b = await req.json();
  const visitId = b.visit_id !== undefined ? (Number(b.visit_id) || null) : row.visit_id;
  if (visitId && !(await queryOne('SELECT id FROM installation_visits WHERE id = ? AND project_id = ?', [visitId, row.project_id]))) {
    return NextResponse.json({ error: 'That visit does not belong to this project' }, { status: 400 });
  }
  const stage = b.stage !== undefined ? (PHOTO_STAGES.includes(b.stage) ? b.stage : null) : row.stage;
  const remarks = b.remarks !== undefined ? (String(b.remarks).trim() || null) : row.remarks;
  await execute('UPDATE installation_photos SET visit_id = ?, stage = ?, remarks = ? WHERE id = ?', [visitId, stage, remarks, id]);
  await audit('installation_photo_edit', { actor: user.username, detail: `photo ${id}` });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const { user, res } = await guard();
  if (res) return res;
  const { id } = await params;
  const row = await queryOne('SELECT file_key FROM installation_photos WHERE id = ?', [id]);
  if (!row) return NextResponse.json({ ok: true });
  await execute('DELETE FROM installation_photos WHERE id = ?', [id]);
  try { await deleteObject(row.file_key); } catch { /* row is gone; an orphaned object is harmless */ }
  await audit('installation_photo_deleted', { actor: user.username, detail: `photo ${id}` });
  return NextResponse.json({ ok: true });
}
