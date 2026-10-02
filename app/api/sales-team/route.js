// GET  /api/sales-team  — the Sales people plus HR employees who could be given a login.
// POST /api/sales-team  { employeeId, username, password } — new Sales login for an HR employee in Sales.
// Sales Head / PM only.
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, isDepartmentHead } from '@/lib/auth';
import { listSalesTeam } from '@/lib/sales-team';
import { audit } from '@/lib/usb';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!user || !isDepartmentHead(user, 'Sales')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await listSalesTeam());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!user || !isDepartmentHead(user, 'Sales')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const username = String(b.username || '').trim().toLowerCase();
  const password = String(b.password || '');
  if (!b.employeeId || !username || !password) return NextResponse.json({ error: 'Employee, username and password are required' }, { status: 400 });
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) return NextResponse.json({ error: 'Username: 3–30 letters, digits, . _ -' }, { status: 400 });
  if (password.length < 6) return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });

  const employee = await queryOne('SELECT id, name, department, user_id, active FROM employees WHERE id = ?', [b.employeeId]);
  if (!employee || !employee.active || employee.department !== 'Sales') return NextResponse.json({ error: 'Pick an active HR employee in the Sales department' }, { status: 400 });
  if (employee.user_id) return NextResponse.json({ error: 'This person already has a login' }, { status: 409 });
  if (await queryOne('SELECT id FROM users WHERE username = ?', [username])) return NextResponse.json({ error: `Username ${username} is taken` }, { status: 409 });

  const r = await execute(
    'INSERT INTO users (username, password, role, display_name, departments, department_roles) VALUES (?, ?, ?, ?, ?, ?)',
    [username, bcrypt.hashSync(password, 10), 'operator', employee.name, 'Sales', JSON.stringify({ Sales: 'designer' })]
  );
  await execute("UPDATE employees SET user_id = ?, access_departments = 'Sales' WHERE id = ?", [Number(r.lastId), employee.id]);
  await audit('sales_team_member_added', { actor: user.username, detail: `${username} (${employee.name})` });
  return NextResponse.json({ id: Number(r.lastId) });
}
