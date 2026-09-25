// app/api/sale-orders/[id]/attachments/[fileId]/route.js — proxied read-back + delete, same shape
// as crm-notes'/calc-drawings' own file routes.
import { hiddenSalesRecord } from '@/lib/sales-visibility';
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, isInternal, requireDepartment, isPM } from '@/lib/auth';
import { getObjectBuffer, deleteObject } from '@/lib/r2';
import { audit } from '@/lib/usb';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const hidden = await hiddenSalesRecord(user, 'sale_order', params.id); // plan 2a: own records only
  if (hidden) return hidden;
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const file = await queryOne('SELECT file_key, file_name FROM sale_order_files WHERE id = ? AND sale_order_id = ?', [params.fileId, params.id]);
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
  const hidden = await hiddenSalesRecord(user, 'sale_order', params.id); // plan 2a: own records only
  if (hidden) return hidden;
  if (!isPM(user)) {
    const denied = requireDepartment(user, 'Sales');
    if (denied) return denied;
  }
  const file = await queryOne('SELECT file_key FROM sale_order_files WHERE id = ? AND sale_order_id = ?', [params.fileId, params.id]);
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    await deleteObject(file.file_key);
  } catch {
    // R2 not configured or object already gone — the DB row below is still the source of truth.
  }
  await execute('DELETE FROM sale_order_files WHERE id = ?', [params.fileId]);
  await audit('sale_order_file_deleted', { actor: user.username, detail: `file ${params.fileId}` });
  return NextResponse.json({ ok: true });
}
