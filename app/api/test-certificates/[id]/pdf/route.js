import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getSessionUser, requireDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { putObject, getObjectBuffer } from '@/lib/r2';

// V2-CHANGES.md Group 1 — attach/replace the source PDF for an existing certificate row. Separate
// from the create/edit routes (which stay JSON-only, unchanged) — this is called right after
// POST/PATCH /api/test-certificates succeeds, if a PDF was picked. Best-effort: if R2 isn't
// configured yet, the certificate row itself is already saved (this route failing doesn't undo
// that) — the caller just shows "couldn't upload the PDF yet" instead of blocking the save.
export async function POST(req, { params }) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;

  const cert = await queryOne('SELECT id, pdf_key FROM test_certificates WHERE id = ?', [params.id]);
  if (!cert) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'No PDF provided' }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const key = `test-certificates/${params.id}.pdf`;

  let url;
  try {
    url = await putObject(key, buffer, 'application/pdf');
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }

  await execute('UPDATE test_certificates SET pdf_key = ?, pdf_url = ? WHERE id = ?', [key, url, params.id]);
  await audit('test_certificate_pdf_upload', { actor: user.username, detail: JSON.stringify({ test_certificate_id: Number(params.id) }) });
  return NextResponse.json({ ok: true, pdf_url: url });
}

// Proxied read — PdfPreview.jsx does a plain fetch(url), so this route just needs to return the
// bytes with the right content type; works whether or not R2_PUBLIC_DOMAIN_URL is set.
export async function GET(req, { params }) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;

  const cert = await queryOne('SELECT pdf_key FROM test_certificates WHERE id = ?', [params.id]);
  if (!cert) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!cert.pdf_key) return NextResponse.json({ error: 'No PDF on file for this certificate' }, { status: 404 });

  try {
    const buffer = await getObjectBuffer(cert.pdf_key);
    return new NextResponse(buffer, { headers: { 'Content-Type': 'application/pdf' } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
