// Edit a WPS while it is a draft. An approved WPS is kept as approved: issue a new revision number instead.
import { NextResponse } from 'next/server';
import { queryOne, execute } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { err, qcOnly } from '@/lib/quality-routes';

export async function PATCH(req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const denied = await qcOnly(user, 'qc.wps.write');
  if (denied) return denied;
  const w = await queryOne('SELECT * FROM wps WHERE id = ?', [params.id]);
  if (!w) return err('Not found', 404);
  if (w.status === 'approved') return err('An approved WPS is not edited — add a new revision', 409);
  const b = await req.json();
  const sets = [], args = [];
  for (const k of ['process', 'pqr_no', 'base_metal', 'thickness', 'pwht']) if (k in b) { sets.push(`${k} = ?`); args.push(String(b[k] || '').trim() || null); }
  if ('is_repair' in b) { sets.push('is_repair = ?'); args.push(b.is_repair ? 1 : 0); }
  if (!sets.length) return err('Nothing to update');
  if ('process' in b && !String(b.process || '').trim()) return err('Process is required');
  await execute(`UPDATE wps SET ${sets.join(', ')} WHERE id = ?`, [...args, w.id]);
  await audit('wps_edited', { actor: user.username, detail: JSON.stringify({ wps_no: w.wps_no, changed: b }) });
  return NextResponse.json({ ok: true });
}
