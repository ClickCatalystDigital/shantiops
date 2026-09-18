// app/api/scope-of-supply/[id]/file/route.js — attach/replace/remove the ONE real document a
// customer/Sales already has for this Scope of Supply (a scan, offline PDF, etc.) — distinct from
// this table's own generated priced-line-item PDF (lib/sos-pdf.js). Same shape as
// app/api/test-certificates/[id]/pdf/route.js: one key per row, overwritten on re-upload.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { putObject, getObjectBuffer, deleteObject } from '@/lib/r2';

function canEditScope(user) {
  return canAccessDepartment(user, 'Design') || canAccessDepartment(user, 'Engineering');
}

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canEditScope(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const existing = await queryOne('SELECT id, pdf_key FROM scope_of_supply WHERE id = ?', [params.id]);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.name && file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
  const key = `scope-of-supply/${params.id}${ext}`;
  const contentType = file.type || 'application/octet-stream';

  // Replacing a file whose extension changed would otherwise leave the old object orphaned in R2 —
  // clean it up first (best-effort; a missing/unconfigured object here shouldn't block the upload).
  if (existing.pdf_key && existing.pdf_key !== key) {
    try { await deleteObject(existing.pdf_key); } catch { /* best-effort */ }
  }

  let url;
  try {
    url = await putObject(key, buffer, contentType);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }

  await execute('UPDATE scope_of_supply SET pdf_key = ?, pdf_url = ?, pdf_content_type = ? WHERE id = ?',
    [key, url, contentType, params.id]);
  await audit('sos_pdf_upload', { actor: user.username, detail: JSON.stringify({ scope_of_supply_id: Number(params.id) }) });
  return NextResponse.json({ ok: true, pdf_key: key, pdf_url: url });
}

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canEditScope(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const existing = await queryOne('SELECT id, pdf_key FROM scope_of_supply WHERE id = ?', [params.id]);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!existing.pdf_key) return NextResponse.json({ error: 'No file attached' }, { status: 404 });

  try { await deleteObject(existing.pdf_key); }
  catch { /* R2 not configured or object already gone — still clear the DB pointer below */ }

  await execute('UPDATE scope_of_supply SET pdf_key = NULL, pdf_url = NULL, pdf_content_type = NULL WHERE id = ?', [params.id]);
  await audit('sos_pdf_remove', { actor: user.username, detail: JSON.stringify({ scope_of_supply_id: Number(params.id) }) });
  return NextResponse.json({ ok: true });
}

// Proxied read — works whether or not R2_PUBLIC_DOMAIN_URL is set (same reasoning as the sibling
// test-certificates route).
export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canEditScope(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const existing = await queryOne('SELECT pdf_key, pdf_content_type FROM scope_of_supply WHERE id = ?', [params.id]);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!existing.pdf_key) return NextResponse.json({ error: 'No file attached' }, { status: 404 });

  try {
    const buffer = await getObjectBuffer(existing.pdf_key);
    return new NextResponse(buffer, { headers: { 'Content-Type': existing.pdf_content_type || 'application/octet-stream' } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
