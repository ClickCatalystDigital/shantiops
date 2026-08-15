import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, signToken, COOKIE_OPTS } from '@/lib/auth';

export async function PATCH(req) {
  const user = await getFreshSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { display_name, contact_number } = await req.json();
  await execute(
    'UPDATE users SET display_name = ?, contact_number = ? WHERE id = ?',
    [display_name || null, contact_number || null, user.id]
  );
  // Re-sign the session cookie so the new display name shows up without a re-login.
  const row = await queryOne('SELECT * FROM users WHERE id = ?', [user.id]);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_OPTS.name, signToken(row), COOKIE_OPTS);
  return res;
}
