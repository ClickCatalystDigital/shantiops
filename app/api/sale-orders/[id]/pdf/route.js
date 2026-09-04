// app/api/sale-orders/[id]/pdf/route.js — attach/replace the source Order Acknowledgement / Scope
// of Supply PDF for an existing Sale Order. Mirrors app/api/test-certificates/[id]/pdf/route.js
// exactly (same R2 upload/replace/proxied-read shape, single file per record) — same gate as the
// other Sale Order edit routes (sales.saleorder.status).
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, isPM } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { putObject, getObjectBuffer, deleteObject } from '@/lib/r2';

function denyUnlessSales(user) {
  if (isPM(user)) return null;
  return requireDepartment(user, 'Sales');
}

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = denyUnlessSales(user);
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Sales', 'sales.saleorder.status');
  if (actionDenied) return actionDenied;

  const so = await queryOne('SELECT id FROM sale_orders WHERE id = ?', [params.id]);
  if (!so) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'No PDF provided' }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const key = `sale-orders/${params.id}.pdf`;

  let url;
  try {
    url = await putObject(key, buffer, 'application/pdf');
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }

  await execute('UPDATE sale_orders SET pdf_key = ?, pdf_url = ? WHERE id = ?', [key, url, params.id]);
  await audit('sale_order_pdf_upload', { actor: user.username, detail: JSON.stringify({ sale_order_id: Number(params.id) }) });
  return NextResponse.json({ ok: true, pdf_url: url });
}

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = denyUnlessSales(user);
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Sales', 'sales.saleorder.status');
  if (actionDenied) return actionDenied;

  const so = await queryOne('SELECT id, pdf_key FROM sale_orders WHERE id = ?', [params.id]);
  if (!so) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!so.pdf_key) return NextResponse.json({ error: 'No PDF on file for this Sale Order' }, { status: 404 });

  try { await deleteObject(so.pdf_key); }
  catch (e) { /* R2 not configured or object already gone — still clear the DB pointer below */ }

  await execute('UPDATE sale_orders SET pdf_key = NULL, pdf_url = NULL WHERE id = ?', [params.id]);
  await audit('sale_order_pdf_remove', { actor: user.username, detail: JSON.stringify({ sale_order_id: Number(params.id) }) });
  return NextResponse.json({ ok: true });
}

// Proxied read — works whether or not R2_PUBLIC_DOMAIN_URL is set. Any internal user can view (same
// read-visibility precedent as Costing — commercial documents aren't Sales-only to look at).
export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const so = await queryOne('SELECT pdf_key FROM sale_orders WHERE id = ?', [params.id]);
  if (!so) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!so.pdf_key) return NextResponse.json({ error: 'No PDF on file for this Sale Order' }, { status: 404 });

  try {
    const buffer = await getObjectBuffer(so.pdf_key);
    return new NextResponse(buffer, { headers: { 'Content-Type': 'application/pdf' } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
