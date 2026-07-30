import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { queryOne } from '@/lib/db';
import { signToken, COOKIE_OPTS, postLoginHome } from '@/lib/auth';

export async function POST(req) {
  const { username, password } = await req.json();
  const user = await queryOne('SELECT * FROM users WHERE username = ?', [username]);
  if (!user || !bcrypt.compareSync(password || '', user.password)) {
    return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
  }
  if (!user.active) {
    return NextResponse.json({ error: 'This account has been deactivated' }, { status: 403 });
  }
  if (user.pending) {
    return NextResponse.json({ error: 'Your account is awaiting approval' }, { status: 403 });
  }
  // `home` so the client lands on the right tab directly — Production runs its day off the
  // calendar, everyone else keeps '/'. postLoginHome reads users.departments, which signToken
  // parses into the JWT, so it's the same source of truth the nav uses.
  const res = NextResponse.json({ ok: true, role: user.role, home: postLoginHome(user) });
  res.cookies.set(COOKIE_OPTS.name, signToken(user), COOKIE_OPTS);
  return res;
}
