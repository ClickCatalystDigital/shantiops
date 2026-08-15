// app/api/salary-structure-assignments/route.js — HR completion bundle. Assigning a new structure
// supersedes the employee's prior active assignment (deactivated, to_date closed the day before)
// so computeSalarySlip's "one active assignment" lookup never has to pick between two.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getSalaryStructureAssignments } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function GET() {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  return NextResponse.json(await getSalaryStructureAssignments());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const b = await req.json();
  if (!b.employee_id || !b.salary_structure_id || !b.from_date || !b.base) {
    return NextResponse.json({ error: 'employee_id, salary_structure_id, from_date, base are required' }, { status: 400 });
  }
  await execute(
    `UPDATE salary_structure_assignments SET active = 0, to_date = date(?, '-1 day')
      WHERE employee_id = ? AND active = 1`,
    [b.from_date, b.employee_id]
  );
  const { lastId } = await execute(
    'INSERT INTO salary_structure_assignments (employee_id, salary_structure_id, base, from_date) VALUES (?, ?, ?, ?)',
    [b.employee_id, b.salary_structure_id, b.base, b.from_date]
  );
  await audit('salary_structure_assigned', { actor: user.username, detail: `employee #${b.employee_id}` });
  return NextResponse.json({ id: Number(lastId) });
}
