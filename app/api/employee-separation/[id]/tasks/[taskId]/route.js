// app/api/employee-separation/[id]/tasks/[taskId]/route.js — V3_CHANGES.md §12 Phase 3f.
// On completing every task: stamps employees.date_of_exit + active=0 (the actual offboarding),
// and returns `offerLoginDeactivation: true` if the employee has a linked user_id — the caller
// (UI) SURFACES that as a choice, it is never auto-run here. This is the manual offboarding seam
// named in the risk analysis: Ops-side deactivation is one click away, not automatic.
import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;

  const b = await req.json();
  if (!['pending', 'done'].includes(b.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });

  await execute('UPDATE separation_tasks SET status = ? WHERE id = ? AND separation_id = ?', [b.status, params.taskId, params.id]);

  const remaining = await queryAll("SELECT 1 FROM separation_tasks WHERE separation_id = ? AND status != 'done'", [params.id]);
  const separation = await queryOne('SELECT * FROM employee_separation WHERE id = ?', [params.id]);
  let offerLoginDeactivation = false;
  if (separation && remaining.length === 0 && separation.status !== 'completed') {
    await execute('UPDATE employee_separation SET status = ? WHERE id = ?', ['completed', params.id]);
    const employee = await queryOne('SELECT * FROM employees WHERE id = ?', [separation.employee_id]);
    await execute(
      `UPDATE employees SET date_of_exit = date('now'), active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [separation.employee_id]
    );
    offerLoginDeactivation = !!employee?.user_id;
    await audit('employee_separation_completed', { actor: user.username, detail: `employee #${separation.employee_id}` });
  }
  return NextResponse.json({ ok: true, completed: remaining.length === 0, offerLoginDeactivation });
}
