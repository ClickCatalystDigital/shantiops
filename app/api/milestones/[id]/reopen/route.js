// Send a closed milestone back for rework — the direct replacement for "raise a rework ticket,
// then resolving it reopens the milestone as a side effect" (the old two-hop dance). Any internal
// user can call this against any department's milestone: it's inherently the OTHER department
// filing it, not the owner (mirrors the old POST /api/tickets, which only checked isInternal, never
// gated to the milestone's own department — see lib/notify.js for why).
import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne } from '@/lib/db';
import { getSessionUser, isInternal } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { notifyDepartment } from '@/lib/notify';
import { handoffTarget } from '@/lib/handoff.mjs';

const MILESTONE_DONE = "(actual_end IS NOT NULL OR status = 'done')";

export async function POST(req, { params }) {
  const user = getSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const b = await req.json();
  const reason = String(b.reason || '').trim();
  if (!reason) return NextResponse.json({ error: 'A reason is required' }, { status: 400 });

  const milestone = await queryOne(
    `SELECT id, project_id, sort_order, department, milestone_label FROM milestones WHERE id = ? AND ${MILESTONE_DONE}`,
    [params.id]
  );
  if (!milestone) return NextResponse.json({ error: 'Milestone not found, or not yet closed' }, { status: 404 });

  // Was already closed (that's what MILESTONE_DONE just confirmed), which means the milestones
  // PATCH route already ran fireHandoff for it at least once — so re-deriving who's downstream from
  // the live chain (same handoffTarget the original handoff used) tells us who to re-notify.
  // Simpler and more correct than trying to recover a stored to_department: notifications are
  // per-recipient rows, they never carried a department column the way the old tickets table did.
  const chain = await queryAll(
    `SELECT id, sort_order, department, milestone_label FROM milestones WHERE project_id = ?`,
    [milestone.project_id]
  );
  const downstream = handoffTarget(chain, milestone);

  await execute(
    `UPDATE milestones
        SET actual_end = NULL, status = 'in_progress', reopened_at = CURRENT_TIMESTAMP,
            reopen_reason = ?, reopened_by = ?, reopen_count = reopen_count + 1
      WHERE id = ?`,
    [reason, user.username, milestone.id]
  );

  await audit('milestone_reopened', {
    actor: user.username,
    detail: `project ${milestone.project_id} · ${milestone.milestone_label}: ${reason}`,
  });

  await notifyDepartment(milestone.department, {
    kind: 'reopened',
    milestone_id: milestone.id,
    title: `${milestone.milestone_label} reopened`,
    body: reason,
  }, { except: user.id });

  if (downstream) {
    await notifyDepartment(downstream.department, {
      kind: 'reopened',
      milestone_id: milestone.id,
      title: `${milestone.milestone_label} reopened`,
      body: `${milestone.milestone_label} in ${milestone.department} was reopened for rework — it's no longer finished.`,
    }, { except: user.id });
  }

  return NextResponse.json({ ok: true });
}
