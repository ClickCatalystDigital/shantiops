// Public self-registration: creates a pending account that a manager/admin/executive must
// approve (see PATCH /api/users/[id]) before it can log in. Always a department head — manager/
// admin/executive/customer accounts are created internally, never through this form (see
// Manmohan incident: self-registering as "Project Manager" got someone full PM access with no
// device-setup gate).
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { execute, queryOne } from '@/lib/db';
import { DEPARTMENTS } from '@/lib/milestones';
import { audit } from '@/lib/usb';
import { registerRateLimited } from '@/lib/enroll';

export async function POST(req) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  if (registerRateLimited(ip)) return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });

  const b = await req.json();
  const username = String(b.username || '').trim();
  const password = String(b.password || '');
  const displayName = String(b.display_name || '').trim();
  const role = 'operator';
  const departments = Array.isArray(b.departments) ? b.departments.filter(d => DEPARTMENTS.includes(d)) : [];

  if (!username || !password || !displayName) {
    return NextResponse.json({ error: 'Name, username, and password are required' }, { status: 400 });
  }
  if (departments.length === 0) {
    return NextResponse.json({ error: 'Pick at least one department' }, { status: 400 });
  }

  const existing = await queryOne('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) return NextResponse.json({ error: `Username ${username} is already taken` }, { status: 409 });

  await execute(
    `INSERT INTO users (username, password, role, departments, display_name, pending)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [username, bcrypt.hashSync(password, 10), role, departments.join(',') || null, displayName]
  );
  await audit('user_registered', { actor: username, detail: `${role}${departments.length ? ':' + departments.join(',') : ''}` });
  return NextResponse.json({ ok: true });
}
