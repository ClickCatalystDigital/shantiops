// app/api/leave-requests/[id]/route.js — V3_CHANGES.md §12 Phase 3d. Approve is blocked once it
// would exceed the computed balance (lib/hr.js getLeaveBalance — never a stored counter). On
// approve, stamps attendance_days as 'leave' for every day in range via the same upsert shape
// app/api/attendance/route.js uses, so the attendance view and leave calendar never disagree.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getLeaveBalance } from '@/lib/hr';
import { toISODate } from '@/lib/date';
import { audit } from '@/lib/usb';

const STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;

  const request = await queryOne('SELECT * FROM leave_requests WHERE id = ?', [params.id]);
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  if (!STATUSES.includes(b.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });

  if (b.status === 'approved') {
    const year = Number(request.from_date.slice(0, 4));
    const { balance } = await getLeaveBalance(request.employee_id, request.leave_type_id, year);
    if (request.days > balance) {
      return NextResponse.json({ error: `Exceeds available balance (${balance} day(s) left)` }, { status: 409 });
    }
  }

  await execute(
    `UPDATE leave_requests SET status = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [b.status, user.username, params.id]
  );

  if (b.status === 'approved') {
    const cur = new Date(request.from_date + 'T00:00:00');
    const end = new Date(request.to_date + 'T00:00:00');
    while (cur <= end) {
      // toISODate, not .toISOString().slice(0,10) — see lib/hr.js's countWorkingDays comment;
      // this exact bug shifted stamped dates back by a day under IST, found live during
      // V3_CHANGES.md §12 verification (the fix that prompted both comments).
      const iso = toISODate(cur);
      await execute(
        `INSERT INTO attendance_days (employee_id, date, status, leave_request_id, created_by) VALUES (?, ?, 'leave', ?, ?)
         ON CONFLICT(employee_id, date) DO UPDATE SET status = 'leave', project_id = NULL, milestone_id = NULL, leave_request_id = excluded.leave_request_id`,
        [request.employee_id, iso, params.id, user.username]
      );
      cur.setDate(cur.getDate() + 1);
    }
  }

  await audit(`leave_${b.status}`, { actor: user.username, detail: `#${params.id}` });
  return NextResponse.json({ ok: true });
}
