import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requirePM } from '@/lib/auth';

// Create a functional-head account (PM only). Departments are granted afterward via the access matrix.
export async function POST(req) {
  const denied = requirePM(await getFreshSessionUser());
  if (denied) return denied;
  const b = await req.json();
  if (!b.employeeId || !b.username?.trim() || !b.password?.trim()) {
    return NextResponse.json({ error: 'HR employee, username, and password are required' }, { status: 400 });
  }
  const employee = await queryOne('SELECT id, name, department, user_id, active FROM employees WHERE id = ?', [b.employeeId]);
  if (!employee || !employee.active) return NextResponse.json({ error: 'Select an active employee from HR' }, { status: 400 });
  if (employee.user_id) return NextResponse.json({ error: 'This HR employee already has system access' }, { status: 409 });
  const existing = await queryOne('SELECT id FROM users WHERE username = ?', [b.username.trim()]);
  if (existing) return NextResponse.json({ error: `User ${b.username} already exists` }, { status: 409 });

  const r = await execute(
    'INSERT INTO users (username, password, role, display_name, departments) VALUES (?, ?, ?, ?, ?)',
    [b.username.trim(), bcrypt.hashSync(b.password, 10), 'operator', employee.name, employee.department || null]
  );
  await execute('UPDATE employees SET user_id = ? WHERE id = ?', [Number(r.lastId), employee.id]);
  return NextResponse.json({ id: Number(r.lastId) });
}
