import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requirePM } from '@/lib/auth';
import { audit } from '@/lib/usb';

// Create an account (PM only): department head by default, or manager/executive (admin/executive only). Departments are granted afterward via the access matrix.
export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requirePM(user);
  if (denied) return denied;
  const b = await req.json();
  if (!b.employeeId || !b.username?.trim() || !b.password?.trim()) {
    return NextResponse.json({ error: 'HR employee, username, and password are required' }, { status: 400 });
  }
  const role = b.role || 'operator';
  if (!['operator', 'manager', 'executive'].includes(role)) return NextResponse.json({ error: 'Invalid level' }, { status: 400 });
  // Same hierarchy as approvals (canApproveUser): only admin/executive create manager/executive logins.
  if (role !== 'operator' && !['admin', 'executive'].includes(user.role)) {
    return NextResponse.json({ error: 'Only admin or executive can create a manager or executive' }, { status: 403 });
  }
  const employee = await queryOne('SELECT id, name, department, user_id, active FROM employees WHERE id = ?', [b.employeeId]);
  if (!employee || !employee.active) return NextResponse.json({ error: 'Select an active employee from HR' }, { status: 400 });
  if (employee.user_id) return NextResponse.json({ error: 'This HR employee already has system access' }, { status: 409 });
  const existing = await queryOne('SELECT id FROM users WHERE username = ?', [b.username.trim()]);
  if (existing) return NextResponse.json({ error: `User ${b.username} already exists` }, { status: 409 });

  const r = await execute(
    'INSERT INTO users (username, password, role, display_name, departments) VALUES (?, ?, ?, ?, ?)',
    // PM-tier logins carry no departments (department notifications skip them by design).
    [b.username.trim(), bcrypt.hashSync(b.password, 10), role, employee.name, role === 'operator' ? employee.department || null : null]
  );
  await execute('UPDATE employees SET user_id = ? WHERE id = ?', [Number(r.lastId), employee.id]);
  await audit('user_created', { actor: user.username, detail: `${b.username.trim()} (${role})` });
  return NextResponse.json({ id: Number(r.lastId) });
}
