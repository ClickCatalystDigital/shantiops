// The signed WPS document (PDF, hashed). Replaceable only while the WPS is a draft.
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
  const w = await queryOne('SELECT pdf_key FROM wps WHERE id = ?', [params.id]);
  if (!w?.pdf_key) return err('No file', 404);
  return new NextResponse(await getObjectBuffer(w.pdf_key), { headers: { 'Content-Type': 'application/pdf' } });
}

export async function POST(req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const denied = await qcOnly(user, 'qc.wps.write');
  if (denied) return denied;
  const w = await queryOne('SELECT * FROM wps WHERE id = ?', [params.id]);
  if (!w) return err('Not found', 404);
  if (w.status === 'approved') return err('An approved WPS keeps its file', 409);
  const up = await storePdf((await req.formData()).get('file'), 'wps');
  if (up.error) return err(up.error);
  await execute('UPDATE wps SET pdf_key = ?, pdf_sha256 = ? WHERE id = ?', [up.key, up.sha256, w.id]);
  await audit('wps_file_uploaded', { actor: user.username, detail: JSON.stringify({ wps_no: w.wps_no, sha256: up.sha256, replaced: w.pdf_key ? { key: w.pdf_key, sha256: w.pdf_sha256 } : null }) });
  return NextResponse.json({ ok: true, sha256: up.sha256 });
}
