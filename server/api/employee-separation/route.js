// app/api/employee-separation/route.js — V3_CHANGES.md §12 Phase 3f. Mirrors
// app/api/employees/route.js's onboarding auto-seed, for the reverse lifecycle event.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { DEFAULT_SEPARATION_TASKS } from '@/lib/hr';
import { audit } from '@/lib/usb';

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'HR', 'hr.separation.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  if (!b.employee_id) return NextResponse.json({ error: 'employee_id is required' }, { status: 400 });

  const { lastId } = await execute(
    'INSERT INTO employee_separation (employee_id, reason) VALUES (?, ?)',
    [b.employee_id, b.reason || null]
  );
  const separationId = Number(lastId);
  let sortOrder = 0;
  for (const task of DEFAULT_SEPARATION_TASKS) {
    await execute('INSERT INTO separation_tasks (separation_id, task, sort_order) VALUES (?, ?, ?)', [separationId, task, sortOrder++]);
  }
  await audit('employee_separation_started', { actor: user.username, detail: `employee #${b.employee_id}` });
  return NextResponse.json({ id: separationId });
}
