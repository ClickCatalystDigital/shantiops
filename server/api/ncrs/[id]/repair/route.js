// Production records the repair or rework done on a dispositioned NCR (ITP points only; the old job-card
// NCRs keep their rework card). QC then re-inspects and verifies (POST .../verify).
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { notifyDepartment } from '@/lib/notify';
import { tabLink } from '@/lib/alert-links.mjs';

export async function POST(req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Production')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const denied = await requireAction(user, 'Production', 'production.ncr.repair');
  if (denied) return denied;
  const ncr = await queryOne('SELECT * FROM ncr_records WHERE id = ?', [params.id]);
  if (!ncr) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!ncr.job_sheet_stage_id) return NextResponse.json({ error: 'This NCR is not on an ITP point' }, { status: 400 });
  if (ncr.status !== 'dispositioned' || !['rework', 'repair'].includes(ncr.disposition)) {
    return NextResponse.json({ error: 'Only an NCR dispositioned for rework or repair takes a repair record' }, { status: 409 });
  }
  const notes = String((await req.json()).notes || '').trim();
  if (!notes) return NextResponse.json({ error: 'Describe the repair' }, { status: 400 });
  const r = await execute(`UPDATE ncr_records SET repair_by = ?, repair_at = CURRENT_TIMESTAMP, repair_notes = ?
    WHERE id = ? AND repair_at IS NULL`, [user.username, notes, ncr.id]);
  if (!r.changes) return NextResponse.json({ error: 'The repair is already recorded' }, { status: 409 });
  await audit('ncr_repair_recorded', { actor: user.username, detail: `${ncr.ncr_no} · ${notes}` });
  try {
    await notifyDepartment('QC', { kind: 'ncr_repaired', title: `${ncr.ncr_no}: repair done, ready for re-inspection`,
      project_id: ncr.project_id, link: tabLink('/qc', 'ncr'), dedupe_key: `ncr_repaired:${ncr.id}` });
  } catch { /* best-effort */ }
  return NextResponse.json({ ok: true });
}
