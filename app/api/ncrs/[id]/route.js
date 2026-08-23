// NCR detail — field edits and delete, both restricted to status='open' (once dispositioned, the
// record is a real decision on paper and shouldn't be silently rewritten).
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

const EDITABLE = ['description', 'severity'];

function canTouch(user) {
  return canAccessDepartment(user, 'QC') || canAccessDepartment(user, 'Production');
}

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canTouch(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const actionDenied = await requireAction(user, canAccessDepartment(user, 'QC') ? 'QC' : 'Production', 'qc.ncr.write');
  if (actionDenied) return actionDenied;

  const ncr = await queryOne('SELECT id, status FROM ncr_records WHERE id = ?', [params.id]);
  if (!ncr) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (ncr.status !== 'open') return NextResponse.json({ error: 'Only an open NCR can be edited' }, { status: 400 });

  const b = await req.json();
  const keys = Object.keys(b).filter(k => EDITABLE.includes(k));
  if (!keys.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  if (keys.includes('description') && !String(b.description || '').trim()) {
    return NextResponse.json({ error: 'Description cannot be empty' }, { status: 400 });
  }
  if (keys.includes('severity') && !['minor', 'major', 'critical'].includes(b.severity)) {
    return NextResponse.json({ error: 'Invalid severity' }, { status: 400 });
  }

  const args = keys.map(k => k === 'description' ? String(b.description).trim() : b[k]);
  args.push(params.id);
  await execute(`UPDATE ncr_records SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, args);
  await audit('ncr_updated', { actor: user.username, detail: `#${params.id} · ${keys.join(',')}` });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canTouch(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const actionDenied = await requireAction(user, canAccessDepartment(user, 'QC') ? 'QC' : 'Production', 'qc.ncr.write');
  if (actionDenied) return actionDenied;

  const ncr = await queryOne('SELECT id, status, rework_job_card_id, ncr_no FROM ncr_records WHERE id = ?', [params.id]);
  if (!ncr) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (ncr.status !== 'open' || ncr.rework_job_card_id) {
    return NextResponse.json({ error: 'Only an open NCR with no rework card can be deleted' }, { status: 400 });
  }

  await execute('DELETE FROM ncr_records WHERE id = ?', [params.id]);
  await audit('ncr_deleted', { actor: user.username, detail: ncr.ncr_no });
  return NextResponse.json({ ok: true });
}
