// STERP items 34/35 (§5p) — Instrument + Jigs/Fixtures Calibration, one table with a `type` column.
// Not project-scoped (equipment, not a project record) — GET is isInternal-gated same reasoning as
// /api/inventory-items' GET (any department may need to look this up), writes are QC-only.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, isInternal, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getCalibrationItems } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await getCalibrationItems());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.calibration.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  const type = b.type === 'jig_fixture' ? 'jig_fixture' : 'instrument';

  const res = await execute(
    `INSERT INTO calibration_items (type, name, identifier, schedule_months, certificate_ref, last_calibrated_on, due_date, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [type, name, b.identifier?.trim() || null,
      b.schedule_months != null && b.schedule_months !== '' ? Number(b.schedule_months) : null,
      b.certificate_ref?.trim() || null, b.last_calibrated_on || null, b.due_date || null, user.username]);

  await audit('calibration_item_add', { actor: user.username, detail: JSON.stringify({ calibration_item_id: Number(res.lastId), type, name }) });
  return NextResponse.json({ id: Number(res.lastId) });
}
