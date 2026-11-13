import { NextResponse } from 'next/server';
import { queryOne, execute } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { err, qcOnly } from '@/lib/quality-routes';

export async function POST(_req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const denied = await qcOnly(user, 'qc.wps.approve');
  if (denied) return denied;
  const w = await queryOne('SELECT wps_no, pdf_key FROM wps WHERE id = ?', [params.id]);
  if (!w) return err('Not found', 404);
  if (!w.pdf_key) return err('Attach the signed WPS PDF before approving', 409);
  const r = await execute("UPDATE wps SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'draft'", [user.username, params.id]);
  if (!r.changes) return err('Already approved', 409);
  await audit('wps_approved', { actor: user.username, detail: w.wps_no });
  return NextResponse.json({ ok: true });
}
