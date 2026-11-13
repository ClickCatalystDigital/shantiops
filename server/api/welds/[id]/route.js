import { NextResponse } from 'next/server';
import { queryOne, execute, withTransaction } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { weldMapProblems } from '@/lib/qc-asme.mjs';
import { todayISO } from '@/lib/date';
import { audit } from '@/lib/usb';
import { err, canWriteWelds } from '@/lib/quality-routes';
import { weldingData } from '@/lib/quality';
import { cleanWeld, applyLastWeld } from '@/lib/weld-write';

const usedBy = id => queryOne('SELECT 1 FROM qc_records WHERE weld_id = ? UNION SELECT 1 FROM ncr_records WHERE weld_id = ? LIMIT 1', [id, id]);

export async function PATCH(req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const denied = await canWriteWelds(user);
  if (denied) return denied;
  const prev = await queryOne('SELECT * FROM welds WHERE id = ?', [params.id]);
  if (!prev) return err('Not found', 404);
  const b = await req.json();
  // Inspections and NCRs name this weld: its number is then fixed.
  if (('weld_no' in b && String(b.weld_no).trim().toUpperCase() !== prev.weld_no) && (await usedBy(prev.id))) return err('Inspections refer to this weld number: it cannot be renamed', 409);
  const w = await cleanWeld(b, prev.project_id, prev);
  if (w.error) return err(w.error);
  try {
    await withTransaction(async tx => {
      await tx.execute({ sql: `UPDATE welds SET weld_no = ?, joint = ?, category = ?, type = ?, wps_id = ?, welder_stamps = ?, nde = ?,
        part_a_bom_item_id = ?, part_b_bom_item_id = ?, welded_on = ? WHERE id = ?`,
        args: [w.weld_no, w.joint, w.category, w.type, w.wps_id, w.welder_stamps, w.nde, w.part_a_bom_item_id, w.part_b_bom_item_id, w.welded_on, prev.id] });
      await applyLastWeld(tx, w);
    });
  } catch (e) {
    if (/UNIQUE/.test(e.message)) return err('That weld number is already on this project', 409);
    throw e;
  }
  await audit('weld_edited', { actor: user.username, detail: JSON.stringify({ weld: prev.weld_no, before: prev, changed: b }) });
  const problems = weldMapProblems(await weldingData(prev.project_id), todayISO()).filter(p => p.startsWith(`${w.weld_no}:`));
  return NextResponse.json({ ok: true, problems });
}

export async function DELETE(_req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const denied = await canWriteWelds(user);
  if (denied) return denied;
  const w = await queryOne('SELECT * FROM welds WHERE id = ?', [params.id]);
  if (!w) return err('Not found', 404);
  if (await usedBy(w.id)) return err('Inspections or NCRs refer to this weld: it is kept', 409);
  await execute('DELETE FROM welds WHERE id = ?', [w.id]);
  await audit('weld_deleted', { actor: user.username, detail: `project ${w.project_id} · ${w.weld_no}` });
  return NextResponse.json({ ok: true });
}
