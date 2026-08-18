import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getLeaveRequests } from '@/lib/data';
import { daysBetween, getLeaveBalance } from '@/lib/hr';
import { audit } from '@/lib/usb';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const params = new URL(req.url).searchParams;
  return NextResponse.json(await getLeaveRequests(params.get('status'), params.get('employee_id')));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'HR', 'hr.leave.request');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  if (!b.employee_id || !b.leave_type_id || !b.from_date || !b.to_date) {
    return NextResponse.json({ error: 'employee_id, leave_type_id, from_date, to_date are required' }, { status: 400 });
  }
  const halfDay = b.half_day ? 1 : 0;
  const halfDayDate = halfDay ? (b.half_day_date || b.from_date) : null;
  const days = daysBetween(b.from_date, b.to_date) - (halfDay ? 0.5 : 0);
  if (days <= 0) return NextResponse.json({ error: 'to_date must be on or after from_date' }, { status: 400 });

  // approver_id defaults from the employee's own reports_to (V3_CHANGES.md §13) but stays
  // overridable by an explicit value in the request body.
  let approverId = b.approver_id || null;
  if (!approverId) {
    const emp = await queryOne('SELECT reports_to FROM employees WHERE id = ?', [b.employee_id]);
    approverId = emp?.reports_to || null;
  }
  const year = Number(b.from_date.slice(0, 4));
  const { balance } = await getLeaveBalance(b.employee_id, b.leave_type_id, year);

  const { lastId } = await execute(
    `INSERT INTO leave_requests
       (employee_id, leave_type_id, from_date, to_date, days, reason, half_day, half_day_date, approver_id, balance_at_application, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [b.employee_id, b.leave_type_id, b.from_date, b.to_date, days, b.reason || null,
      halfDay, halfDayDate, approverId, balance, user.username]
  );
  await audit('leave_requested', { actor: user.username, detail: `employee #${b.employee_id}, ${days}d` });
  return NextResponse.json({ id: Number(lastId), days });
}
