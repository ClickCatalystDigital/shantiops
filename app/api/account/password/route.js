import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { queryOne, execute } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { currentPassword, newPassword } = await req.json();
  if (!newPassword || newPassword.length < 6) {
    return NextResponse.json({ error: 'New password must be at least 6 characters' }, { status: 400 });
  }
  const row = await queryOne('SELECT password FROM users WHERE id = ?', [user.id]);
  if (!row || !bcrypt.compareSync(currentPassword || '', row.password)) {
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
  }
  await execute('UPDATE users SET password = ? WHERE id = ?', [bcrypt.hashSync(newPassword, 10), user.id]);
  return NextResponse.json({ ok: true });
}
