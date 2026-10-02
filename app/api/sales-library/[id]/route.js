// app/api/sales-library/[id]/route.js — download (proxied from R2) and delete a Sales Library file.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isDepartmentHead } from '@/lib/auth';
import { getObjectBuffer, deleteObject } from '@/lib/r2';
import { audit } from '@/lib/usb';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Sales')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const f = await queryOne('SELECT file_key, file_name FROM sales_library_files WHERE id = ?', [params.id]);
  if (!f) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const buffer = await getObjectBuffer(f.file_key);
    return new NextResponse(buffer, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${f.file_name.replace(/"/g, '')}"` } });
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 502 }); }
}

// The Sales Head / PM can delete anything; anyone else only their own uploads.
export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Sales')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const f = await queryOne('SELECT file_key, uploaded_by, title FROM sales_library_files WHERE id = ?', [params.id]);
  if (!f) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!isDepartmentHead(user, 'Sales') && f.uploaded_by !== user.username) return NextResponse.json({ error: 'Only the uploader or the Sales Head can delete this' }, { status: 403 });
  try { await deleteObject(f.file_key); } catch { /* object already gone — the row is the source of truth */ }
  await execute('DELETE FROM sales_library_files WHERE id = ?', [params.id]);
  await audit('sales_library_deleted', { actor: user.username, detail: JSON.stringify({ id: Number(params.id), title: f.title }) });
  return NextResponse.json({ ok: true });
}
