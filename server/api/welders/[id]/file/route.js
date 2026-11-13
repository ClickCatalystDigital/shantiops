// A welder's performance qualification record (WPQ PDF, hashed). Replacing it keeps the old key + hash in the audit log.
import { NextResponse } from 'next/server';
import { queryOne, execute } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { getObjectBuffer } from '@/lib/r2';
import { storePdf } from '@/lib/pdf-upload';
import { audit } from '@/lib/usb';
import { canRead, forbidden, err, qcOnly } from '@/lib/quality-routes';

export async function GET(_req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  if (!canRead(user)) return forbidden();
  const w = await queryOne('SELECT wpq_pdf_key FROM welders WHERE id = ?', [params.id]);
  if (!w?.wpq_pdf_key) return err('No file', 404);
  return new NextResponse(await getObjectBuffer(w.wpq_pdf_key), { headers: { 'Content-Type': 'application/pdf' } });
}

export async function POST(req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const denied = await qcOnly(user, 'qc.welder.write');
  if (denied) return denied;
  const w = await queryOne('SELECT * FROM welders WHERE id = ?', [params.id]);
  if (!w) return err('Not found', 404);
  const up = await storePdf((await req.formData()).get('file'), 'wpq');
  if (up.error) return err(up.error);
  await execute('UPDATE welders SET wpq_pdf_key = ?, wpq_sha256 = ? WHERE id = ?', [up.key, up.sha256, w.id]);
  await audit('welder_wpq_uploaded', { actor: user.username, detail: JSON.stringify({ stamp: w.stamp, sha256: up.sha256, replaced: w.wpq_pdf_key ? { key: w.wpq_pdf_key, sha256: w.wpq_sha256 } : null }) });
  return NextResponse.json({ ok: true, sha256: up.sha256 });
}
