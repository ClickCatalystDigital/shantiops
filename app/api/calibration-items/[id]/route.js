import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

const EDITABLE = ['name', 'identifier', 'schedule_months', 'certificate_ref', 'last_calibrated_on', 'due_date', 'blocked'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.calibration.write');
  if (actionDenied) return actionDenied;

  const item = await queryOne('SELECT * FROM calibration_items WHERE id = ?', [params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const keys = Object.keys(b).filter(k => EDITABLE.includes(k));
  if (!keys.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  if (keys.includes('name') && !String(b.name || '').trim()) {
    return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
  }

  const changed = {};
  for (const k of keys) {
    if (k === 'blocked') { changed[k] = b[k] ? 1 : 0; continue; }
    let v = typeof b[k] === 'string' ? b[k].trim() : b[k];
    if (v === '') v = null;
    changed[k] = v;
  }
  await execute(
    `UPDATE calibration_items SET ${Object.keys(changed).map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(changed), params.id]);

  await audit('calibration_item_edit', { actor: user.username, detail: JSON.stringify({ calibration_item_id: Number(params.id), changed }) });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.calibration.delete');
  if (actionDenied) return actionDenied;

  const item = await queryOne('SELECT * FROM calibration_items WHERE id = ?', [params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await execute('DELETE FROM calibration_items WHERE id = ?', [params.id]);
  await audit('calibration_item_delete', { actor: user.username, detail: JSON.stringify({ calibration_item_id: Number(params.id), name: item.name }) });
  return NextResponse.json({ ok: true });
}
