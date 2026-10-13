import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { signToken, COOKIE_OPTS, postLoginHome } from '@/lib/auth';
import { DEMO_ROLES } from '@/lib/demo-roles';

// Public demo: sign in as one of the sample department heads (only after the entry form).
export async function POST(req) {
  if (process.env.DEMO_MODE !== '1') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!req.cookies.get('demo_lead')?.value) return NextResponse.json({ error: 'Fill in the form first' }, { status: 403 });
  const { username } = await req.json().catch(() => ({}));
  if (!DEMO_ROLES.some(r => r.username === username)) return NextResponse.json({ error: 'Unknown role' }, { status: 400 });
  const user = await queryOne('SELECT * FROM users WHERE username = ? AND active = 1 AND pending = 0', [username]);
  if (!user) return NextResponse.json({ error: 'Demo data is being reset, try again in a minute' }, { status: 503 });
  const res = NextResponse.json({ ok: true, home: postLoginHome(user) });
  res.cookies.set(COOKIE_OPTS.name, signToken(user), COOKIE_OPTS);
  res.cookies.set('view_dept', '', { path: '/', maxAge: 0 });
  return res;
}
