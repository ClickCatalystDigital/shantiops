// middleware.js
// Runs on the Edge runtime, so it only checks whether a session cookie is present —
// full JWT verification (which needs Node's crypto) happens in route handlers and
// in the root layout via lib/auth.js's getSessionUser().
import { NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login', '/d-login', '/api/login', '/api/config/brand', '/api/register', '/set-password', '/api/set-password', '/acc-bpmn'];

// Public demo (DEMO_MODE=1, never set on a customer deployment): visitors enter through /demo, and
// changes to logins, mailboxes, connections, company and device security are refused. Anything that
// would message the outside world (email, WhatsApp, AI) is refused too.
const DEMO_PUBLIC = ['/demo', '/api/demo/lead', '/api/demo/enter'];
const DEMO_BLOCKED = ['/api/users', '/api/account/password', '/api/account/avatar', '/api/change-password', '/api/set-password',
  '/api/register', '/api/mail-accounts', '/api/whatsapp', '/api/assistant', '/api/lead-sources', '/api/statutory-rates',
  '/api/sales-team', '/api/portal-access', '/api/settings', '/api/company-settings', '/api/email-templates', '/api/agent',
  '/api/usb', '/api/browser'];
function demoGuard(req, pathname) {
  if (process.env.DEMO_MODE !== '1') return null;
  if (pathname === '/login' || pathname === '/d-login') return NextResponse.redirect(new URL('/demo', req.url));
  if (DEMO_PUBLIC.includes(pathname)) return NextResponse.next();
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const sends = /\/send-(email|whatsapp)$/.test(pathname);
  if ((write && DEMO_BLOCKED.some(p => pathname === p || pathname.startsWith(p + '/'))) || sends) {
    return NextResponse.json({ error: 'Not available in the demo' }, { status: 403 });
  }
  return null;
}

export function middleware(req) {
  const { pathname } = req.nextUrl;
  const demo = demoGuard(req, pathname);
  if (demo) return demo;

  if (
    PUBLIC_PATHS.some(p => pathname === p) ||
    pathname.startsWith('/api/agent') || // USB agents send Bearer, no cookie; handler verifies the JWT
    pathname === '/api/statutory-rates/sync' || // cron-triggered; handler checks x-sync-key itself
    pathname === '/api/sales/quotation-reminders' || // cron-triggered (plan 2d); handler checks x-sync-key itself
    pathname.startsWith('/rfq/') ||      // supplier portal page (V2-CHANGES.md Phase 5.1, D12) — token is the auth, no login
    pathname === '/api/whatsapp/webhook' || // Meta's WhatsApp webhook — verify token + signed body are the auth
    pathname.startsWith('/api/lead-hooks/') || // JustDial / website lead push — the secret token in the path is the auth
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
    const loginUrl = new URL(process.env.DEMO_MODE === '1' ? '/demo' : '/login', req.url);
    // Come back here after signing in (e.g. a scanned nameplate QR that opens /portal/<id>).
    if (pathname !== '/') loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
