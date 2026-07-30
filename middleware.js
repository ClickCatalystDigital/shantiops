// middleware.js
// Runs on the Edge runtime, so it only checks whether a session cookie is present —
// full JWT verification (which needs Node's crypto) happens in route handlers and
// in the root layout via lib/auth.js's getSessionUser().
import { NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login', '/d-login', '/api/login', '/api/config/brand', '/api/register'];

export function middleware(req) {
  const { pathname } = req.nextUrl;

  if (
    PUBLIC_PATHS.some(p => pathname === p) ||
    pathname.startsWith('/api/agent') || // USB agents send Bearer, no cookie; handler verifies the JWT
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get('token')?.value;

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const loginUrl = new URL('/login', req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
