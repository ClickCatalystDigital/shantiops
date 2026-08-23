// Job card detail + status/qty updates. Auto-stamps actual_start/actual_end on status transitions
// so the foreman never has to set a timestamp by hand.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getJobCardDetail } from '@/lib/data';
import { audit } from '@/lib/usb';
import { syncProductionMilestoneById } from '@/lib/milestone-auto';
import { notifyDepartment } from '@/lib/notify';

const STATUSES = ['pending', 'progress', 'done'];
const EDITABLE = ['workstation_id', 'qty_planned', 'qty_done', 'qty_rejected', 'status', 'is_paused', 'planned_start', 'planned_end', 'notes'];

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const detail = await getJobCardDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Production', 'production.jobcard.edit');
  if (actionDenied) return actionDenied;

  const card = await queryOne(
    'SELECT id, status, milestone_id, project_id, requires_qc_hold, qc_released_at FROM job_cards WHERE id = ?', [params.id]);
  if (!card) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const keys = Object.keys(b).filter(k => EDITABLE.includes(k));
  if (!keys.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  if (keys.includes('status') && !STATUSES.includes(b.status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }
  // Hold-point gate (plan §5d) — requires_qc_hold is deliberately not in EDITABLE, so Production
  // can never clear it directly; only POST /api/job-cards/[id]/qc-release can. The block below
  // doubles as the real "ready for inspection" signal to QC — Production hitting this wall is the
  // moment the piece is actually done and waiting on QC, not an earlier point in the flow.
  if (keys.includes('status') && b.status === 'done' && card.requires_qc_hold && !card.qc_released_at) {
    try {
      await notifyDepartment('QC', {
        kind: 'qc_hold', title: `Job card #${params.id} ready for QC hold-point release`,
        project_id: card.project_id, dedupe_key: `qc_hold:${params.id}`,
      });
    } catch (err) { /* notification is best-effort */ }
    return NextResponse.json({ error: 'Held for QC — awaiting QC release' }, { status: 400 });
  }
  if (b.is_paused && card.status !== 'progress' && b.status !== 'progress') {
    return NextResponse.json({ error: 'Only an in-progress card can be paused' }, { status: 400 });
  }

  const fields = ['updated_at = CURRENT_TIMESTAMP'];
  const args = [];
  for (const k of keys) {
    if (k === 'is_paused') { fields.push('is_paused = ?'); args.push(b.is_paused ? 1 : 0); continue; }
    if (k === 'notes') { fields.push('notes = ?'); args.push(String(b.notes || '').trim() || null); continue; }
    fields.push(`${k} = ?`);
    args.push(b[k]);
  }
  // Auto-stamp timestamps and clear the pause flag on a status change — one less thing to forget.
  if (keys.includes('status')) {
    if (b.status === 'progress' && card.status === 'pending') fields.push("actual_start = CURRENT_TIMESTAMP");
    if (b.status === 'done') { fields.push("actual_end = CURRENT_TIMESTAMP", 'is_paused = 0'); }
  }
  args.push(params.id);
  await execute(`UPDATE job_cards SET ${fields.join(', ')} WHERE id = ?`, args);
  await audit('job_card_updated', { actor: user.username, detail: `#${params.id} · ${keys.join(',')}` });
  // A milestone's own work is done once every job card raised against it is — check on every
  // transition into 'done', not just once, since this is often the LAST card to close.
  if (keys.includes('status') && b.status === 'done') {
    await syncProductionMilestoneById(card.milestone_id, user.username);
  }
  return NextResponse.json({ ok: true });
}
