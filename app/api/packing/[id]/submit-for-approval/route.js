// Inward QC/Production Approval Workflow — Dispatch submits a Packing List for its pre-dispatch
// review. Serves both first-submit and resubmit (matching the requirement's own wording): the
// latest existing cycle (if any) must be 'rejected' or absent — a fresh submission over an already-
// pending or already-approved cycle is refused rather than silently creating a duplicate one.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { execute, queryOne, queryAll } from '@/lib/db';
import { notifyDepartmentHeads } from '@/lib/notify';
import { audit } from '@/lib/usb';
import { tabLink } from '@/lib/alert-links.mjs';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.submit_approval');
  if (actionDenied) return actionDenied;

  const list = await queryOne('SELECT id, status, project_id, packing_no FROM packing_lists WHERE id = ?', [params.id]);
  if (!list) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (list.status !== 'packed') {
    return NextResponse.json({ error: 'Only a packed list can be submitted for review' }, { status: 400 });
  }

  const latest = await queryOne(
    'SELECT * FROM pre_dispatch_approvals WHERE packing_list_id = ? ORDER BY id DESC LIMIT 1', [list.id]);
  if (latest && latest.status !== 'rejected' && latest.status !== 'withdrawn') {
    return NextResponse.json({ error: latest.status === 'approved' ? 'Already approved' : 'Already submitted — awaiting a decision' }, { status: 400 });
  }

  const { lastId } = await execute(
    'INSERT INTO pre_dispatch_approvals (packing_list_id, project_id, submitted_by, resubmission_of_id) VALUES (?, ?, ?, ?)',
    [list.id, list.project_id, user.username, latest?.id || null]
  );
  const id = Number(lastId);

  // Production already answered "approve for dispatch?" when it handed the items over. If every
  // handed-over line on this list was approved, Production's slot is filled in now; otherwise it stays
  // open for Production to decide from Approvals.
  try {
    const hand = await queryAll(
      `SELECT DISTINCT h.id, h.production_approved, h.approved_by FROM production_handovers h
         JOIN packing_bom_links pb ON pb.bom_item_id = h.bom_item_id
        WHERE pb.packing_list_id = ? AND (h.child_project_id IS NULL OR h.child_project_id = ?)`, [list.id, list.project_id]);
    if (hand.length && hand.every(h => h.production_approved)) {
      await execute(
        `UPDATE pre_dispatch_approvals SET production_decision = 'approved', production_decided_by = ?, production_decided_at = CURRENT_TIMESTAMP,
                production_reason = 'Approved when handed over' WHERE id = ?`, [hand[hand.length - 1].approved_by || 'production', id]);
    }
  } catch { /* the review still works without the pre-fill */ }

  await audit('predispatch_submitted', { actor: user.username, detail: `list ${list.id} (${list.packing_no})${latest ? ` — resubmission of ${latest.id}` : ''}` });
  try {
    const note = {
      kind: 'predispatch_submitted', title: `Packing List ${list.packing_no} ready for review`,
      project_id: list.project_id, dedupe_key: `predispatch_submitted:${id}`,
    };
    await notifyDepartmentHeads('QC', { ...note, link: tabLink('/qc', 'predispatch-approvals', { highlight: list.packing_no }) });
    await notifyDepartmentHeads('Production', { ...note, link: tabLink('/production/shop', 'approvals', { highlight: list.packing_no }) });
  } catch (err) { /* notification is best-effort */ }

  return NextResponse.json({ ok: true, id });
}
