// GET — Intuit redirects here with ?code&state&realmId (or ?error). Register this exact URL in the
// Intuit app: https://<host>/api/quickbooks/callback (and http://localhost:3000/... for development).
import { NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { completeConnection, manageDenied, companyById } from '@/lib/quickbooks';
import { checkState } from '@/lib/quickbooks.mjs';

function back(req, q) {
  const res = NextResponse.redirect(new URL(`/accounts?${new URLSearchParams(q)}`, req.url));
  res.cookies.set('qbo_state', '', { path: '/api/quickbooks', maxAge: 0 });
  return res;
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!user) return NextResponse.redirect(new URL('/login', req.url));
  const sp = new URL(req.url).searchParams;
  if (sp.get('error')) return back(req, { qbo_error: sp.get('error') === 'access_denied' ? 'Connection cancelled in QuickBooks' : sp.get('error') });

  let cookie = null;
  try { cookie = JSON.parse(Buffer.from(req.cookies.get('qbo_state')?.value || '', 'base64url').toString()); } catch { /* bad cookie = expired */ }
  const bad = checkState({ cookie, state: sp.get('state'), userId: user.id });
  if (bad) return back(req, { qbo_error: bad });
  const why = await manageDenied(user);
  if (why) return back(req, { qbo_error: why });
  const co = await companyById(cookie.companyId);
  const code = sp.get('code');
  const realmId = sp.get('realmId');
  if (!co || !code || !realmId) return back(req, { qbo_error: 'QuickBooks did not send back a company' });

  try {
    await completeConnection({ company: co.company, code, realmId, req, user });
  } catch (err) {
    return back(req, { qbo_error: err.message });
  }
  await audit('quickbooks_connected', { actor: user.username, detail: `${co.company} → realm ${realmId}` });
  return back(req, { qbo: 'connected' });
}
