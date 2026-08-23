// app/api/set-password/route.js — public route, the other end of the Customer Portal's
// credentials-setup link (POST /api/customers/[id]/portal). No session required: possession of the
// unguessable token IS the auth for this one action, same as any password-reset-link pattern.
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { execute, queryOne } from '@/lib/db';
import { signToken, COOKIE_OPTS, postLoginHome } from '@/lib/auth';

export async function POST(req) {
  const { token, password } = await req.json();
  if (!token || !password || password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }
  const user = await queryOne(
    `SELECT * FROM users WHERE password_setup_token = ? AND password_setup_expires > CURRENT_TIMESTAMP
       AND active = 1`, [token]);
  if (!user) return NextResponse.json({ error: 'This link is invalid or has expired' }, { status: 400 });

  await execute(
    'UPDATE users SET password = ?, password_setup_token = NULL, password_setup_expires = NULL WHERE id = ?',
    [bcrypt.hashSync(password, 10), user.id]
  );
  const fresh = { ...user, password_setup_token: null };
  const res = NextResponse.json({ ok: true, home: postLoginHome(fresh) });
  res.cookies.set(COOKIE_OPTS.name, signToken(fresh), COOKIE_OPTS);
  return res;
}
