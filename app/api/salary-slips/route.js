// app/api/salary-slips/route.js — list, plus ad-hoc single-employee slip generation (outside a
// batch payroll run) via the same lib/payroll.js generateSalarySlip entrypoint.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getSalarySlips } from '@/lib/data';
import { generateSalarySlip } from '@/lib/payroll';
import { audit } from '@/lib/usb';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const employeeId = new URL(req.url).searchParams.get('employee_id');
  return NextResponse.json(await getSalarySlips(employeeId));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'HR', 'hr.payroll.run');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  const periodMonth = Number(b.period_month);
  const periodYear = Number(b.period_year);
  if (!b.employee_id || !periodMonth || !periodYear) {
    return NextResponse.json({ error: 'employee_id, period_month, period_year are required' }, { status: 400 });
  }
  try {
    const res = await generateSalarySlip(b.employee_id, periodMonth, periodYear, { createdBy: user.username });
    await audit('salary_slip_generated', { actor: user.username, detail: `employee #${b.employee_id}, ${periodMonth}/${periodYear}` });
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
