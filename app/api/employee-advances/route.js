import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getSessionUser, requireDepartment } from '@/lib/auth';
import { getEmployeeAdvances } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function GET(req) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const employeeId = new URL(req.url).searchParams.get('employee_id');
  return NextResponse.json(await getEmployeeAdvances(employeeId));
}

export async function POST(req) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const b = await req.json();
  if (!b.employee_id || !b.amount || !b.advance_date) {
    return NextResponse.json({ error: 'employee_id, amount, advance_date are required' }, { status: 400 });
  }
  const { lastId } = await execute(
    'INSERT INTO employee_advances (employee_id, purpose, amount, advance_date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)',
    [b.employee_id, b.purpose || null, b.amount, b.advance_date, b.notes || null, user.username]
  );
  await audit('employee_advance_requested', { actor: user.username, detail: `employee #${b.employee_id}: ${b.amount}` });
  return NextResponse.json({ id: Number(lastId) });
}
