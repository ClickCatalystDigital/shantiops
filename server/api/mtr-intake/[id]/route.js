// One uploaded MTR: GET with its extracted lines; PATCH { action: 'reject' | 'reopen' }.
import { NextResponse } from 'next/server';
import { queryOne, execute } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { forbidden, err, qcOnly } from '@/lib/quality-routes';
import { parseJson } from '@/lib/quality';

export async function GET(_req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'QC')) return forbidden();
  const m = await queryOne('SELECT * FROM mtr_intake WHERE id = ?', [params.id]);
  if (!m) return err('Not found', 404);
  return NextResponse.json({ ...m, extracted: parseJson(m.extracted_json, null), extracted_json: undefined });
}

export async function PATCH(req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const denied = await qcOnly(user, 'qc.certificate.write');
  if (denied) return denied;
  const { action, reason } = await req.json();
  const m = await queryOne('SELECT id, status, file_name FROM mtr_intake WHERE id = ?', [params.id]);
  if (!m) return err('Not found', 404);
  if (m.status === 'accepted') return err('Already accepted: its certificates are in the bank', 409);
  if (action === 'reject') {
    await execute("UPDATE mtr_intake SET status = 'rejected', error = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?",
      [String(reason || '').trim() || null, user.username, m.id]);
  } else if (action === 'reopen') {
    if (!['rejected', 'not_mtr', 'failed'].includes(m.status)) return err('Nothing to reopen', 409);
    await execute("UPDATE mtr_intake SET status = CASE WHEN extracted_json IS NULL THEN 'uploaded' ELSE 'extracted' END, reviewed_by = NULL, reviewed_at = NULL WHERE id = ?", [m.id]);
  } else return err('Unknown action');
  await audit(`mtr_${action}`, { actor: user.username, detail: JSON.stringify({ id: m.id, file: m.file_name, reason: reason || null }) });
  return NextResponse.json({ ok: true });
}
