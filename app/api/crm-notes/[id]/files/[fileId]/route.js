// app/api/crm-notes/[id]/files/[fileId]/route.js — proxied read-back + delete, same shape as
// calc-drawings' own [id]/files/[fileId] route. Access is inherited from the parent note (any CRM
// user with Sales/Marketing access), never a broader "any logged-in internal user" shortcut.
import { hiddenSalesRecord } from '@/lib/sales-visibility';
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { getObjectBuffer, deleteObject } from '@/lib/r2';
import { audit } from '@/lib/usb';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const hidden = await hiddenSalesRecord(user, 'note', params.id); // plan 2a — a member sees only their own
  if (hidden) return hidden;
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const file = await queryOne('SELECT file_key, file_name FROM crm_note_files WHERE id = ? AND note_id = ?', [params.fileId, params.id]);
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    const buffer = await getObjectBuffer(file.file_key);
    return new NextResponse(buffer, {
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${file.file_name}"` },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const hidden = await hiddenSalesRecord(user, 'note', params.id); // plan 2a — a member sees only their own
  if (hidden) return hidden;
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const file = await queryOne('SELECT file_key FROM crm_note_files WHERE id = ? AND note_id = ?', [params.fileId, params.id]);
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    await deleteObject(file.file_key);
  } catch {
    // R2 not configured or object already gone — the DB row below is still the source of truth.
  }
  await execute('DELETE FROM crm_note_files WHERE id = ?', [params.fileId]);
  await audit('crm_note_file_deleted', { actor: user.username, detail: `file ${params.fileId}` });
  return NextResponse.json({ ok: true });
}
