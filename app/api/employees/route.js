// app/api/employees/route.js — V3_CHANGES.md §12 Phase 3b. The single people master. GET open to
// HR|PM; POST HR-only (single-department gate, unlike CRM's two-department pattern).
import { NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, canAccessDepartment, isPM } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getEmployees } from '@/lib/data';
import { createEmployeeWithOnboarding } from '@/lib/hr';
import { audit } from '@/lib/usb';

function canAccessHr(user) {
  return isPM(user) || canAccessDepartment(user, 'HR');
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!canAccessHr(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const search = new URL(req.url).searchParams.get('search');
  if (search) {
    return NextResponse.json(await queryAll(
      "SELECT * FROM employees WHERE name LIKE ? OR employee_code LIKE ? ORDER BY name LIMIT 20",
      [`%${search}%`, `%${search}%`]
    ));
  }
  return NextResponse.json(await getEmployees());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'HR', 'hr.employee.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const { employeeId, employeeCode } = await createEmployeeWithOnboarding({ ...b, name });
  await audit('employee_created', { actor: user.username, detail: `${employeeCode} · ${name}` });
  return NextResponse.json({ id: employeeId, employee_code: employeeCode });
}
