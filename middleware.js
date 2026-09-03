// middleware.js
// Runs on the Edge runtime, so it only checks whether a session cookie is present —
// full JWT verification (which needs Node's crypto) happens in route handlers and
// in the root layout via lib/auth.js's getSessionUser().
import { NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login', '/d-login', '/api/login', '/api/config/brand', '/api/register', '/set-password', '/api/set-password', '/acc-bpmn'];

export function middleware(req) {
  const { pathname } = req.nextUrl;

  if (
    PUBLIC_PATHS.some(p => pathname === p) ||
    pathname.startsWith('/api/agent') || // USB agents send Bearer, no cookie; handler verifies the JWT
    pathname === '/api/statutory-rates/sync' || // cron-triggered; handler checks x-sync-key itself
    pathname.startsWith('/rfq/') ||      // supplier portal page (V2-CHANGES.md Phase 5.1, D12) — token is the auth, no login
    pathname.startsWith('/api/rfq/') ||  // ...and its API — singular, distinct segment from the authenticated /api/rfqs
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
