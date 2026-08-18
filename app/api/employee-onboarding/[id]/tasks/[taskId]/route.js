// app/api/employee-onboarding/[id]/tasks/[taskId]/route.js — V3_CHANGES.md §12 Phase 3f.
// Auto-completes the onboarding record once every task is done, same auto-complete-on-last-item
// precedent Workflow Stages already uses for milestones (SYSTEM.md §3c).
import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'HR', 'hr.onboarding.task');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  if (!['pending', 'done'].includes(b.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });

  await execute('UPDATE onboarding_tasks SET status = ? WHERE id = ? AND onboarding_id = ?', [b.status, params.taskId, params.id]);

  const remaining = await queryAll("SELECT 1 FROM onboarding_tasks WHERE onboarding_id = ? AND status != 'done'", [params.id]);
  const onboarding = await queryOne('SELECT * FROM employee_onboarding WHERE id = ?', [params.id]);
  if (onboarding) {
    const nextStatus = remaining.length === 0 ? 'completed' : 'in_progress';
    if (onboarding.status !== nextStatus) {
      await execute('UPDATE employee_onboarding SET status = ? WHERE id = ?', [nextStatus, params.id]);
    }
  }
  return NextResponse.json({ ok: true, completed: remaining.length === 0 });
}
