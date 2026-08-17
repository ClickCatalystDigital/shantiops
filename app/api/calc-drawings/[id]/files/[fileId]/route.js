import { NextResponse } from 'next/server';
import { getFreshSessionUser, hasActiveDesignResponsibility, isCustomer, canAccessProject } from '@/lib/auth';
import { requireCalcAccess } from '@/lib/calc';
import { queryOne, execute } from '@/lib/db';
import { getObjectBuffer, deleteObject } from '@/lib/r2';
import { audit } from '@/lib/usb';

// Proxied read-back — works without a public R2 bucket URL, same shape as
// app/api/test-certificates/[id]/pdf/route.js's GET. A drawing under review or beyond is also
// downloadable by the owning project's customer — same visibility rule as the portal's drawings
// list (getCustomerView), since approving a drawing you can't view is hollow.
export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const drawing = await queryOne('SELECT project_id, status, customer_visible FROM calc_drawings WHERE id = ?', [params.id]);
  if (!drawing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (isCustomer(user)) {
    const visible = drawing.customer_visible && ['under_review', 'approved', 'as_built'].includes(drawing.status);
    if (!visible || !canAccessProject(user, drawing.project_id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else {
    const denied = requireCalcAccess(user);
    if (denied) return denied;
  }

  const file = await queryOne('SELECT file_key, file_name FROM calc_drawing_files WHERE id = ? AND drawing_id = ?', [params.fileId, params.id]);
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
  const denied = requireCalcAccess(user);
  if (denied) return denied;
  if (!(await hasActiveDesignResponsibility(user, 'head'))) return NextResponse.json({ error: 'Only the Design Head can delete files' }, { status: 403 });

  const file = await queryOne('SELECT file_key FROM calc_drawing_files WHERE id = ? AND drawing_id = ?', [params.fileId, params.id]);
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    await deleteObject(file.file_key);
  } catch (e) {
    // R2 not configured or object already gone — the DB row below is still the source of truth.
  }
  await execute('DELETE FROM calc_drawing_files WHERE id = ?', [params.fileId]);
  await audit('calc_drawing_file_deleted', { actor: user.username, detail: `file ${params.fileId}` });
  return NextResponse.json({ ok: true });
}
