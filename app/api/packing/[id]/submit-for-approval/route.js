// Inward QC/Production Approval Workflow — Dispatch submits a Packing List for its pre-dispatch
// review. Serves both first-submit and resubmit (matching the requirement's own wording): the
// latest existing cycle (if any) must be 'rejected' or absent — a fresh submission over an already-
// pending or already-approved cycle is refused rather than silently creating a duplicate one.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { execute, queryOne } from '@/lib/db';
import { notifyDepartmentHeads } from '@/lib/notify';
import { audit } from '@/lib/usb';

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
  if (latest && latest.status !== 'rejected') {
    return NextResponse.json({ error: latest.status === 'approved' ? 'Already approved' : 'Already submitted — awaiting a decision' }, { status: 400 });
  }

  const { lastId } = await execute(
    'INSERT INTO pre_dispatch_approvals (packing_list_id, project_id, submitted_by, resubmission_of_id) VALUES (?, ?, ?, ?)',
    [list.id, list.project_id, user.username, latest?.id || null]
  );
  const id = Number(lastId);

  await audit('predispatch_submitted', { actor: user.username, detail: `list ${list.id} (${list.packing_no})${latest ? ` — resubmission of ${latest.id}` : ''}` });
  try {
    const note = {
      kind: 'predispatch_submitted', title: `Packing List ${list.packing_no} ready for review`,
      project_id: list.project_id, dedupe_key: `predispatch_submitted:${id}`,
    };
    await notifyDepartmentHeads('QC', note);
    await notifyDepartmentHeads('Production', note);
  } catch (err) { /* notification is best-effort */ }

  return NextResponse.json({ ok: true, id });
}
