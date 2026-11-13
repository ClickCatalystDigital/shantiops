// Batch MTR intake (docs/gulf-coast-asme-plan.md, Phase 1b). The browser sends one PDF per request, so a
// batch of 20 never hits a request-size or time limit, and a closed tab leaves every row in its state.
// A file whose bytes were already uploaded (or are already on a certificate) is saved as 'duplicate' and
// not stored again.
import { NextResponse } from 'next/server';
import { queryAll, queryOne, execute } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { readPdf, putPdf } from '@/lib/pdf-upload';
import { audit } from '@/lib/usb';
import { forbidden, err, qcOnly } from '@/lib/quality-routes';
import { canAccessDepartment } from '@/lib/auth';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'QC')) return forbidden();
  const all = new URL(req.url).searchParams.get('all') === '1';
  return NextResponse.json(await queryAll(`SELECT m.id, m.file_name, m.size, m.status, m.doc_type, m.error, m.uploaded_by, m.uploaded_at,
      m.reviewed_by, m.reviewed_at, m.duplicate_of_id, m.duplicate_cert_id, d.file_name AS duplicate_of_name, c.certificate_no AS duplicate_cert_no,
      (SELECT COUNT(*) FROM test_certificates t WHERE t.intake_id = m.id) AS certificates
    FROM mtr_intake m LEFT JOIN mtr_intake d ON d.id = m.duplicate_of_id LEFT JOIN test_certificates c ON c.id = m.duplicate_cert_id
    ${all ? '' : "WHERE m.status NOT IN ('accepted', 'rejected', 'duplicate') OR m.uploaded_at > datetime('now', '-14 days')"}
    ORDER BY m.id DESC LIMIT 300`));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = await qcOnly(user, 'qc.certificate.write');
  if (denied) return denied;
  const file = (await req.formData()).get('file');
  const pdf = await readPdf(file);
  if (pdf.error) return err(pdf.error);
  const name = String(file.name || 'mtr.pdf').slice(0, 200);
  const prior = await queryOne("SELECT id FROM mtr_intake WHERE sha256 = ? AND status != 'duplicate' ORDER BY id LIMIT 1", [pdf.sha256]);
  const onCert = prior ? null : await queryOne('SELECT id FROM test_certificates WHERE pdf_sha256 = ? LIMIT 1', [pdf.sha256]);
  if (prior || onCert) {
    const r = await execute(`INSERT INTO mtr_intake (file_name, sha256, size, status, duplicate_of_id, duplicate_cert_id, uploaded_by)
      VALUES (?, ?, ?, 'duplicate', ?, ?, ?)`, [name, pdf.sha256, pdf.size, prior?.id || null, onCert?.id || null, user.username]);
    return NextResponse.json({ id: Number(r.lastId), status: 'duplicate' }, { status: 201 });
  }
  let key;
  try { key = await putPdf(pdf, 'mtr'); } catch (e) { return err(e.message, 409); }
  const r = await execute('INSERT INTO mtr_intake (file_name, pdf_key, sha256, size, uploaded_by) VALUES (?, ?, ?, ?, ?)',
    [name, key, pdf.sha256, pdf.size, user.username]);
  await audit('mtr_uploaded', { actor: user.username, detail: JSON.stringify({ id: Number(r.lastId), file: name, sha256: pdf.sha256 }) });
  return NextResponse.json({ id: Number(r.lastId), status: 'uploaded' }, { status: 201 });
}
