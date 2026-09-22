// app/api/sale-orders/[id]/attachments/route.js — Phase 2.4 "Attach Files". Deliberately named
// `attachments`, distinct from the existing single-file GET/POST .../pdf route (sale_orders.pdf_key
// — the Order Acknowledgement source document, replaced not accumulated). Same upload shape as
// calc-drawings'/crm-notes' own upload routes.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, isPM } from '@/lib/auth';
import { putObject } from '@/lib/r2';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isPM(user)) {
    const denied = requireDepartment(user, 'Sales');
    if (denied) return denied;
  }
  const so = await queryOne('SELECT id FROM sale_orders WHERE id = ?', [params.id]);
  if (!so) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const key = `sale-orders/${params.id}/${Date.now()}-${file.name}`;

  let url;
  try {
    url = await putObject(key, buffer, file.type || 'application/octet-stream');
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }

  const { lastId } = await execute(
    `INSERT INTO sale_order_files (sale_order_id, file_name, file_size, file_key, file_url, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [params.id, file.name, buffer.length, key, url, user.username]
  );
  await audit('sale_order_file_uploaded', { actor: user.username, detail: `SO ${params.id}: ${file.name}` });
  return NextResponse.json({ id: Number(lastId), fileUrl: url });
}
