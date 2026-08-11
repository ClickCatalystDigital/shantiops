// app/api/additional-salary/route.js — one-off arrears/bonus lines, folded into whichever slip
// covers employee+period at generation time (lib/payroll.js computeSalarySlip).
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getSessionUser, requireDepartment } from '@/lib/auth';
import { getAdditionalSalary } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function GET(req) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const employeeId = new URL(req.url).searchParams.get('employee_id');
  return NextResponse.json(await getAdditionalSalary(employeeId));
}

export async function POST(req) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const b = await req.json();
  if (!b.employee_id || !b.name || !['earning', 'deduction'].includes(b.component_type) || !b.amount || !b.period_month || !b.period_year) {
    return NextResponse.json({ error: 'employee_id, name, component_type, amount, period_month, period_year are required' }, { status: 400 });
  }
  const { lastId } = await execute(
    `INSERT INTO additional_salary (employee_id, name, component_type, amount, period_month, period_year, reason, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [b.employee_id, b.name, b.component_type, b.amount, b.period_month, b.period_year, b.reason || null, user.username]
  );
  await audit('additional_salary_created', { actor: user.username, detail: `employee #${b.employee_id}: ${b.name} ${b.amount}` });
  return NextResponse.json({ id: Number(lastId) });
}
