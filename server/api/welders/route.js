// Welders and their qualifications (stamp, WPQ, processes with the date last welded). Continuity per
// process is computed by lib/qc-asme.mjs continuityRows (six months without the process = lapsed).
import { NextResponse } from 'next/server';
import { queryAll, execute } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { continuityRows } from '@/lib/qc-asme.mjs';
import { todayISO } from '@/lib/date';
import { audit } from '@/lib/usb';
import { canRead, forbidden, err, qcOnly } from '@/lib/quality-routes';
import { parseJson } from '@/lib/quality';
import { cleanProcesses } from '@/lib/welding.mjs';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!canRead(user)) return forbidden();
  const rows = await queryAll('SELECT * FROM welders ORDER BY active DESC, stamp');
  const asOf = todayISO();
  return NextResponse.json(rows.map(w => {
    const processes = parseJson(w.processes_json, {});
    return { ...w, processes, continuity: continuityRows([{ stamp: w.stamp, name: w.name, wpq: w.wpq_no, processes }], asOf) };
  }));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = await qcOnly(user, 'qc.welder.write');
  if (denied) return denied;
  const b = await req.json();
  const stamp = String(b.stamp || '').trim().toUpperCase(), name = String(b.name || '').trim();
  if (!stamp || !name) return err('Stamp and name are required');
  const p = cleanProcesses(b.processes);
  if (p.error) return err(p.error);
  try {
    const r = await execute('INSERT INTO welders (stamp, name, wpq_no, processes_json, employee_id) VALUES (?, ?, ?, ?, ?)',
      [stamp, name, String(b.wpq_no || '').trim() || null, JSON.stringify(p.processes), b.employee_id ? Number(b.employee_id) : null]);
    await audit('welder_added', { actor: user.username, detail: `${stamp} ${name}` });
    return NextResponse.json({ id: Number(r.lastId) });
  } catch (e) {
    if (/UNIQUE/.test(e.message)) return err('That stamp is already used', 409);
    throw e;
  }
}
