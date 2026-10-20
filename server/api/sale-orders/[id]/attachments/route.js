// app/api/sale-orders/[id]/attachments/route.js — Phase 2.4 "Attach Files". Deliberately named
// `attachments`, distinct from the existing single-file GET/POST .../pdf route (sale_orders.pdf_key
// — the Order Acknowledgement source document, replaced not accumulated). Same upload shape as
// calc-drawings'/crm-notes' own upload routes.
import { hiddenSalesRecord } from '@/lib/sales-visibility';
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, isPM, isCustomer } from '@/lib/auth';
import { portalCustomerId } from '@/lib/data';
import { isTradeOrder } from '@/lib/portal-invite';
import { notifyDepartment } from '@/lib/notify';
import { putObject } from '@/lib/r2';
import { audit } from '@/lib/usb';

export async function POST(req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const hidden = await hiddenSalesRecord(user, 'sale_order', params.id); // plan 2a: own records only
  if (hidden) return hidden;
  // The customer may upload their own PO to their own open order from the portal (optional for them).
  const customer = isCustomer(user);
  if (!customer && !isPM(user)) {
    const denied = requireDepartment(user, 'Sales');
    if (denied) return denied;
  }
  const so = await queryOne('SELECT id, so_no, customer_id, status FROM sale_orders WHERE id = ?', [params.id]);
  if (!so) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (customer) {
    const mine = so.customer_id && so.customer_id === await portalCustomerId(user);
    if (!mine || isTradeOrder(so.so_no)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (so.status === 'cancelled') return NextResponse.json({ error: 'This order was cancelled' }, { status: 409 });
  }

  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }
  if (customer && (file.size > 10 * 1024 * 1024 || !/^(application\/pdf|image\/(png|jpeg))$/.test(file.type))) {
    return NextResponse.json({ error: 'Upload a PDF, PNG or JPG up to 10 MB' }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = String(file.name || 'file').replace(/[^\w.\- ]+/g, '_').slice(-120);
  const fileName = customer ? `Customer PO - ${safeName}` : file.name;
  const key = `sale-orders/${params.id}/${Date.now()}-${customer ? safeName : file.name}`;

  let url;
  try {
    url = await putObject(key, buffer, file.type || 'application/octet-stream');
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }

  const { lastId } = await execute(
    `INSERT INTO sale_order_files (sale_order_id, file_name, file_size, file_key, file_url, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [params.id, fileName, buffer.length, key, url, user.username]
  );
  await audit('sale_order_file_uploaded', { actor: user.username, detail: `SO ${params.id}: ${fileName}` });
  if (customer) {
    try {
      await notifyDepartment('Sales', { kind: 'customer_po_uploaded', title: `Customer PO uploaded: ${so.so_no}`, body: user.display_name || user.username, link: '/sales', dedupe_key: `customer_po:${lastId}` });
    } catch (err) { /* best-effort */ }
  }
  return NextResponse.json({ id: Number(lastId), fileUrl: url });
}
