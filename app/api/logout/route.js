import { NextResponse } from 'next/server';
import { COOKIE_OPTS, VIEW_DEPT_COOKIE } from '@/lib/auth';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_OPTS.name, '', { ...COOKIE_OPTS, maxAge: 0 });
  res.cookies.set(VIEW_DEPT_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
