// A signed-in portal customer picks their own password (required after a phone-number/reset password).
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, isCustomer } from '@/lib/auth';
import { encryptSecret } from '@/lib/crypto';

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!isCustomer(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { current, password } = await req.json();
  if (!password || password.length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  const row = await queryOne('SELECT password FROM users WHERE id = ?', [user.id]);
  if (!(await bcrypt.compare(current || '', row.password))) return NextResponse.json({ error: 'Your current password is not right' }, { status: 400 });
  if (password === current) return NextResponse.json({ error: 'Pick a different password from the current one' }, { status: 400 });
  let enc = null;
  try { enc = encryptSecret(password); } catch { /* no SECRETS_KEY: no read-back copy */ }
  await execute('UPDATE users SET password = ?, portal_password_enc = ?, must_change_password = 0 WHERE id = ?', [bcrypt.hashSync(password, 10), enc, user.id]);
  return NextResponse.json({ ok: true });
}
