import { NextResponse } from 'next/server';
import { queryOne, execute } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { err, qcOnly } from '@/lib/quality-routes';
import { cleanProcesses } from '@/lib/welding.mjs';

export async function PATCH(req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const denied = await qcOnly(user, 'qc.welder.write');
  if (denied) return denied;
  const w = await queryOne('SELECT * FROM welders WHERE id = ?', [params.id]);
  if (!w) return err('Not found', 404);
  const b = await req.json();
  const sets = [], args = [];
  if ('name' in b) { if (!String(b.name).trim()) return err('Name is required'); sets.push('name = ?'); args.push(String(b.name).trim()); }
  if ('wpq_no' in b) { sets.push('wpq_no = ?'); args.push(String(b.wpq_no || '').trim() || null); }
  if ('active' in b) { sets.push('active = ?'); args.push(b.active ? 1 : 0); }
  if ('processes' in b) {
    const p = cleanProcesses(b.processes);
    if (p.error) return err(p.error);
    sets.push('processes_json = ?'); args.push(JSON.stringify(p.processes));
  }
  if (!sets.length) return err('Nothing to update');
  await execute(`UPDATE welders SET ${sets.join(', ')} WHERE id = ?`, [...args, w.id]);
  await audit('welder_edited', { actor: user.username, detail: JSON.stringify({ stamp: w.stamp, before: { wpq_no: w.wpq_no, processes: w.processes_json, active: w.active }, changed: b }) });
  return NextResponse.json({ ok: true });
}
