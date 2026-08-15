// app/api/attendance/route.js — V3_CHANGES.md §12 Phase 3c. Reuses the exact upsert shape from
// the old app/api/production/worker-days/route.js, now employee-keyed and open to any employee
// (not hardcoded to Production). The client must POST the complete row every time — the upsert
// overwrites every column via excluded.*, same documented behavior the old route had.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getAttendanceForDate, getAttendanceHistory } from '@/lib/data';
import { deriveAttendanceMetrics, getShiftForDate } from '@/lib/hr';

const STATUSES = ['present', 'half', 'absent', 'leave'];

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const params = new URL(req.url).searchParams;
  const date = params.get('date');
  const employeeId = params.get('employee_id');
  if (date) return NextResponse.json(await getAttendanceForDate(date));
  if (employeeId) return NextResponse.json(await getAttendanceHistory(employeeId));
  return NextResponse.json({ error: 'date or employee_id is required' }, { status: 400 });
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;

  const b = await req.json();
  if (!b.employee_id || !b.date) return NextResponse.json({ error: 'employee_id and date are required' }, { status: 400 });
  const status = STATUSES.includes(b.status) ? b.status : 'present';
  // absent/leave nulls project_id/milestone_id/notes/punch-times server-side — same guard the old
  // worker-days route applied for 'absent'.
  const clearContext = status === 'absent' || status === 'leave';

  const inTime = clearContext ? null : (b.in_time || null);
  const outTime = clearContext ? null : (b.out_time || null);
  let workingHours = null, lateEntry = 0, earlyExit = 0;
  if (inTime || outTime) {
    const shift = await getShiftForDate(b.employee_id, b.date);
    ({ workingHours, lateEntry, earlyExit } = deriveAttendanceMetrics(inTime, outTime, shift?.start_time, shift?.end_time, shift?.grace_minutes || 0));
  }

  await execute(
    `INSERT INTO attendance_days
       (employee_id, date, status, project_id, milestone_id, notes, in_time, out_time, working_hours, late_entry, early_exit, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(employee_id, date) DO UPDATE SET
       status = excluded.status, project_id = excluded.project_id,
       milestone_id = excluded.milestone_id, notes = excluded.notes,
       in_time = excluded.in_time, out_time = excluded.out_time, working_hours = excluded.working_hours,
       late_entry = excluded.late_entry, early_exit = excluded.early_exit`,
    [b.employee_id, b.date, status, clearContext ? null : (b.project_id || null),
      clearContext ? null : (b.milestone_id || null), clearContext ? null : (b.notes || null),
      inTime, outTime, workingHours, lateEntry, earlyExit, user.username]
  );
  return NextResponse.json({ ok: true });
}
