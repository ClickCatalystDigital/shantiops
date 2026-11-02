// GET ?company_id= — starts Intuit's OAuth 2.0 authorization-code flow. A random `state` and who
// asked go in a short-lived httpOnly cookie; /api/quickbooks/callback checks both.
import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getFreshSessionUser } from '@/lib/auth';
import { qboConfig, redirectUri, manageDenied, companyById } from '@/lib/quickbooks';
import { authorizeUrl, STATE_TTL_MS } from '@/lib/quickbooks.mjs';

const back = (req, q) => NextResponse.redirect(new URL(`/accounts?${new URLSearchParams(q)}`, req.url));

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!user) return NextResponse.redirect(new URL('/login', req.url));
  const cfg = qboConfig();
  if (!cfg) return back(req, { qbo_error: 'QuickBooks is not set up on this server' });
  const why = await manageDenied(user);
  if (why) return back(req, { qbo_error: why });
  const co = await companyById(new URL(req.url).searchParams.get('company_id'));
  if (!co) return back(req, { qbo_error: 'Company not found' });

  const state = randomBytes(32).toString('base64url');
  const res = NextResponse.redirect(authorizeUrl({ clientId: cfg.clientId, redirectUri: redirectUri(req), state }));
  const cookie = Buffer.from(JSON.stringify({ state, userId: user.id, companyId: co.id, exp: Date.now() + STATE_TTL_MS })).toString('base64url');
  res.cookies.set('qbo_state', cookie, {
    path: '/api/quickbooks', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: STATE_TTL_MS / 1000,
  });
  return res;
}
