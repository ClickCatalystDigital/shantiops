// Open or remove one uploaded file of a dispatch on this link (token = auth; the file's dispatch must belong
// to an order on the link).
import { NextResponse } from 'next/server';
import { getRfqByToken } from '@/lib/data';
import { queryOne, execute } from '@/lib/db';
import { getObjectBuffer, deleteObject } from '@/lib/r2';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { isDispatchLocked, DISPATCH_LOCKED } from '@/lib/po-dispatch';

export const runtime = 'nodejs';

async function load(token, fileId) {
  const rs = await getRfqByToken(token);
  if (!rs) return { res: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  if (rs.token_expires && rs.token_expires < Date.now()) return { res: NextResponse.json({ error: 'This link has expired' }, { status: 410 }) };
  const f = await queryOne('SELECT * FROM po_dispatch_files WHERE id = ?', [fileId]);
  const order = f && rs.orders.find(o => o.dispatches.some(d => d.id === f.dispatch_id));
  if (!order) return { res: NextResponse.json({ error: 'File not found' }, { status: 404 }) };
  return { rs, f, order };
}

export async function GET(_req, { params }) {
  const { f, res } = await load(params.token, Number(params.fileId));
  if (res) return res;
  const body = await getObjectBuffer(f.r2_key);
  return new NextResponse(body, { headers: { 'Content-Type': f.content_type, 'Content-Disposition': `inline; filename="${f.filename.replace(/"/g, '')}"` } });
}

export async function DELETE(_req, { params }) {
  const { rs, f, order, res } = await load(params.token, Number(params.fileId));
  if (res) return res;
  if (await isDispatchLocked(order.id, f.dispatch_id)) return NextResponse.json({ error: DISPATCH_LOCKED }, { status: 409 });
  await execute('DELETE FROM po_dispatch_files WHERE id = ?', [f.id]);
  try { await deleteObject(f.r2_key); } catch { /* the row is gone; an orphaned object is harmless */ }
  const user = await getFreshSessionUser();
  await audit('po_dispatch_file_removed', { actor: user && (canAccessDepartment(user, 'Procurement') || canAccessDepartment(user, 'Stores')) ? user.username : `supplier:${rs.supplier_id}`, detail: `${order.po_no} · ${f.filename}` });
  return NextResponse.json({ ok: true });
}
