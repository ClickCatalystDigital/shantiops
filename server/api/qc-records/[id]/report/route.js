// The signed report behind one inspection (an RT report, a hydro chart…): PDF only, hashed, kept in R2.
// Replacing it keeps the old file and writes its key and hash to the audit log.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getObjectBuffer } from '@/lib/r2';
import { storePdf } from '@/lib/pdf-upload';
import { audit } from '@/lib/usb';

const canTouch = (user, t) => (/hydro/i.test(t || '') ? canAccessDepartment(user, 'Production') : canAccessDepartment(user, 'QC'));

export async function GET(_req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'QC') && !canAccessDepartment(user, 'Production')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const r = await queryOne('SELECT report_key FROM qc_records WHERE id = ?', [params.id]);
  if (!r?.report_key) return NextResponse.json({ error: 'No report' }, { status: 404 });
  return new NextResponse(await getObjectBuffer(r.report_key), { headers: { 'Content-Type': 'application/pdf' } });
}

export async function POST(req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const rec = await queryOne('SELECT id, test_type, report_key, report_sha256 FROM qc_records WHERE id = ?', [params.id]);
  if (!rec) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canTouch(user, rec.test_type)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!/hydro/i.test(rec.test_type)) { const d = await requireAction(user, 'QC', 'qc.test.write'); if (d) return d; }
  const up = await storePdf((await req.formData()).get('file'), 'qc-reports');
  if (up.error) return NextResponse.json({ error: up.error }, { status: 400 });
  await execute('UPDATE qc_records SET report_key = ?, report_sha256 = ? WHERE id = ?', [up.key, up.sha256, rec.id]);
  await audit('qc_report_uploaded', { actor: user.username, detail: JSON.stringify({ qc_record_id: rec.id, sha256: up.sha256, replaced: rec.report_key ? { key: rec.report_key, sha256: rec.report_sha256 } : null }) });
  return NextResponse.json({ ok: true, sha256: up.sha256 });
}
