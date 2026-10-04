// Up to 3 photos / files per dispatch (LR copy, invoice, loaded-truck photo), uploaded from the supplier's
// private page and stored in R2. The token is the auth; the dispatch must belong to an order on this link.
import { NextResponse } from 'next/server';
import { getRfqByToken } from '@/lib/data';
import { queryOne, execute } from '@/lib/db';
import { putObject } from '@/lib/r2';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { isDispatchLocked, DISPATCH_LOCKED } from '@/lib/po-dispatch';
import { DISPATCH_FILE_TYPES, DISPATCH_FILE_MAX, DISPATCH_FILE_BYTES } from '@/lib/po-dispatch.mjs';

export const runtime = 'nodejs';

export async function POST(req, { params }) {
  const rs = await getRfqByToken(params.token);
  if (!rs) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (rs.token_expires && rs.token_expires < Date.now()) return NextResponse.json({ error: 'This link has expired' }, { status: 410 });
  const dispatchId = Number(params.dispatchId);
  const order = rs.orders.find(o => o.dispatches.some(d => d.id === dispatchId));
  if (!order) return NextResponse.json({ error: 'Dispatch not found' }, { status: 404 });

  if (await isDispatchLocked(order.id, dispatchId)) return NextResponse.json({ error: DISPATCH_LOCKED }, { status: 409 });

  const file = (await req.formData()).get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  if (!DISPATCH_FILE_TYPES.includes(file.type)) return NextResponse.json({ error: 'Only photos (JPG/PNG) and PDF files are allowed' }, { status: 400 });
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > DISPATCH_FILE_BYTES) return NextResponse.json({ error: 'File is too large (max 8 MB)' }, { status: 400 });
  const count = await queryOne('SELECT COUNT(*) AS n FROM po_dispatch_files WHERE dispatch_id = ?', [dispatchId]);
  if (Number(count.n) >= DISPATCH_FILE_MAX) return NextResponse.json({ error: `Up to ${DISPATCH_FILE_MAX} files per dispatch` }, { status: 409 });

  const ext = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg';
  const key = `po-dispatches/${order.id}/${dispatchId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  try { await putObject(key, buffer, file.type); } catch (e) { return NextResponse.json({ error: e.message }, { status: 502 }); }
  const user = await getFreshSessionUser();
  const by = user && (canAccessDepartment(user, 'Procurement') || canAccessDepartment(user, 'Stores')) ? user.username : `supplier:${rs.supplier_id}`;
  const name = String(file.name || `file.${ext}`).replace(/[\r\n"]/g, '').slice(0, 120);
  const r = await execute(
    'INSERT INTO po_dispatch_files (dispatch_id, r2_key, filename, content_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)',
    [dispatchId, key, name, file.type, buffer.length, by]);
  await audit('po_dispatch_file_added', { actor: by, detail: `${order.po_no} · dispatch ${dispatchId} · ${name}` });
  return NextResponse.json({ ok: true, id: Number(r.lastId) });
}
