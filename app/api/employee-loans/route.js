// app/api/employee-loans/route.js — structured loans (EMI, reducing-balance). emi_amount is
// computed once at disbursal via lib/payroll.js computeLoanEmi, not recalculated each payroll.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getSessionUser, requireDepartment } from '@/lib/auth';
import { getEmployeeLoans } from '@/lib/data';
import { computeLoanEmi } from '@/lib/payroll';
import { audit } from '@/lib/usb';

export async function GET(req) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const employeeId = new URL(req.url).searchParams.get('employee_id');
  return NextResponse.json(await getEmployeeLoans(employeeId));
}

export async function POST(req) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const b = await req.json();
  if (!b.employee_id || !b.principal_amount || !b.tenure_months || !b.disbursed_date) {
    return NextResponse.json({ error: 'employee_id, principal_amount, tenure_months, disbursed_date are required' }, { status: 400 });
  }
  const interestPct = b.interest_pct || 0;
  const emi = computeLoanEmi(b.principal_amount, interestPct, b.tenure_months);
  const { lastId } = await execute(
    `INSERT INTO employee_loans (employee_id, purpose, principal_amount, interest_pct, tenure_months, emi_amount, disbursed_date, outstanding_principal, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [b.employee_id, b.purpose || null, b.principal_amount, interestPct, b.tenure_months, emi, b.disbursed_date, b.principal_amount, user.username]
  );
  await audit('employee_loan_created', { actor: user.username, detail: `employee #${b.employee_id}: ${b.principal_amount}, EMI ${emi}` });
  return NextResponse.json({ id: Number(lastId), emi_amount: emi });
}
