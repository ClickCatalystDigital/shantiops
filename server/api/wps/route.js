// Welding Procedure Specifications. A WPS starts as a draft; QC Head approves it. A weld repair on an ITP
// point can only be dispositioned against an approved WPS (server/api/ncrs/[id]/disposition).
import { NextResponse } from 'next/server';
import { queryAll, execute } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { canRead, forbidden, err, qcOnly } from '@/lib/quality-routes';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!canRead(user)) return forbidden();
  return NextResponse.json(await queryAll('SELECT *, pdf_key IS NOT NULL AS has_pdf FROM wps ORDER BY wps_no'));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = await qcOnly(user, 'qc.wps.write');
  if (denied) return denied;
  const b = await req.json();
  const no = String(b.wps_no || '').trim().toUpperCase(), process = String(b.process || '').trim().toUpperCase();
  if (!no || !process) return err('WPS number and process are required');
  try {
    const r = await execute(`INSERT INTO wps (wps_no, process, pqr_no, base_metal, thickness, pwht, is_repair, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [no, process, ...['pqr_no', 'base_metal', 'thickness', 'pwht'].map(k => String(b[k] || '').trim() || null), b.is_repair ? 1 : 0, user.username]);
    await audit('wps_added', { actor: user.username, detail: no });
    return NextResponse.json({ id: Number(r.lastId) });
  } catch (e) {
    if (/UNIQUE/.test(e.message)) return err('That WPS number exists', 409);
    throw e;
  }
}
