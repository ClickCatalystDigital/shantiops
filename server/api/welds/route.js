// The weld register for one project: weld number, joint, WPS, welder stamps, the NDE each weld needs, and the
// two BOM lines it joins (so a weld shows the heats of both parts). Per-weld ITP points read the NDE list.
// Saving a weld with a date moves each welder's "last weld" for the WPS process forward (QW-322 continuity).
// The response lists qualification problems (unqualified or lapsed welder): warned, not refused, until the
// customer says otherwise.
import { NextResponse } from 'next/server';
import { queryAll, queryOne, execute, withTransaction } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { weldMapProblems } from '@/lib/qc-asme.mjs';
import { todayISO } from '@/lib/date';
import { audit } from '@/lib/usb';
import { canRead, forbidden, err, canWriteWelds } from '@/lib/quality-routes';
import { getProjectWelds, weldingData } from '@/lib/quality';
import { cleanWeld, applyLastWeld } from '@/lib/weld-write';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!canRead(user)) return forbidden();
  const projectId = Number(new URL(req.url).searchParams.get('project_id'));
  if (!projectId) return err('project_id is required');
  const [welds, heats] = await Promise.all([
    getProjectWelds(projectId),
    queryAll(`SELECT DISTINCT sp.bom_item_id, COALESCE(sp.heat_no, tc.cast_no) AS heat, tc.certificate_no
      FROM stock_pieces sp LEFT JOIN test_certificates tc ON tc.id = sp.test_certificate_id
      JOIN bom_items b ON b.id = sp.bom_item_id WHERE b.project_id = ? AND COALESCE(sp.heat_no, tc.cast_no) IS NOT NULL`, [projectId]),
  ]);
  const heatsOf = id => heats.filter(h => h.bom_item_id === id).map(h => ({ heat: h.heat, certificate_no: h.certificate_no }));
  const problems = weldMapProblems(await weldingData(projectId), todayISO());
  return NextResponse.json({ welds: welds.map(w => ({ ...w, heats_a: heatsOf(w.part_a_bom_item_id), heats_b: heatsOf(w.part_b_bom_item_id) })), problems });
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = await canWriteWelds(user);
  if (denied) return denied;
  const b = await req.json();
  const projectId = Number(b.project_id);
  if (!projectId || !(await queryOne('SELECT 1 FROM projects WHERE id = ?', [projectId]))) return err('Project not found', 404);
  const w = await cleanWeld(b, projectId);
  if (w.error) return err(w.error);
  try {
    const id = await withTransaction(async tx => {
      const r = await tx.execute({ sql: `INSERT INTO welds (project_id, weld_no, joint, category, type, wps_id, welder_stamps, nde,
        part_a_bom_item_id, part_b_bom_item_id, welded_on, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [projectId, w.weld_no, w.joint, w.category, w.type, w.wps_id, w.welder_stamps, w.nde, w.part_a_bom_item_id, w.part_b_bom_item_id, w.welded_on, user.username] });
      await applyLastWeld(tx, w);
      return Number(r.lastInsertRowid);
    });
    await audit('weld_added', { actor: user.username, detail: `project ${projectId} · ${w.weld_no}` });
    const problems = weldMapProblems(await weldingData(projectId), todayISO()).filter(p => p.startsWith(`${w.weld_no}:`));
    return NextResponse.json({ id, problems });
  } catch (e) {
    if (/UNIQUE/.test(e.message)) return err('That weld number is already on this project', 409);
    throw e;
  }
}
