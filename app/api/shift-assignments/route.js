import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getShiftAssignments, getShiftHistory } from '@/lib/data';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const employeeId = new URL(req.url).searchParams.get('employee_id');
  // V3_CHANGES.md §13 — employee_id returns full history (current + past); no filter returns
  // only current assignments (getShiftAssignments' existing behavior, unchanged).
  return NextResponse.json(employeeId ? await getShiftHistory(employeeId) : await getShiftAssignments());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const b = await req.json();
  if (!b.employee_id || !b.shift_type_id || !b.from_date) {
    return NextResponse.json({ error: 'employee_id, shift_type_id, from_date are required' }, { status: 400 });
  }
  const { lastId } = await execute(
    'INSERT INTO shift_assignments (employee_id, shift_type_id, from_date, to_date, created_by) VALUES (?, ?, ?, ?, ?)',
    [b.employee_id, b.shift_type_id, b.from_date, b.to_date || null, user.username]
  );
  return NextResponse.json({ id: Number(lastId) });
}
