import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getLeaveBalance } from '@/lib/hr';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const sp = new URL(req.url).searchParams;
  const employeeId = sp.get('employee_id');
  const year = Number(sp.get('year')) || new Date().getFullYear();
  if (!employeeId) return NextResponse.json({ error: 'employee_id is required' }, { status: 400 });

  const types = await queryAll('SELECT * FROM leave_types WHERE active = 1 ORDER BY name');
  const balances = await Promise.all(types.map(async t => ({
    leave_type_id: t.id, leave_type_name: t.name,
    ...(await getLeaveBalance(employeeId, t.id, year)),
  })));
  return NextResponse.json(balances);
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const b = await req.json();
  if (!b.employee_id || !b.leave_type_id || !b.year) {
    return NextResponse.json({ error: 'employee_id, leave_type_id, year are required' }, { status: 400 });
  }
  await execute(
    `INSERT INTO leave_allocations (employee_id, leave_type_id, year, allocated) VALUES (?, ?, ?, ?)
     ON CONFLICT(employee_id, leave_type_id, year) DO UPDATE SET allocated = excluded.allocated`,
    [b.employee_id, b.leave_type_id, b.year, Number(b.allocated) || 0]
  );
  return NextResponse.json({ ok: true });
}
