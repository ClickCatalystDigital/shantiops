import { NextResponse } from 'next/server';
import { ownerPassToken, passMatches, passLocked, passFailed } from '@/lib/demo-leads';

// Public demo: the owner pass (lib/demo-leads.js). The secret comes in the POST body from the page's #pass=…, so it is
// never in a URL a server or analytics sees. A wrong pass changes nothing.
export async function POST(req) {
  if (process.env.DEMO_MODE !== '1') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { pass } = await req.json().catch(() => ({}));
  const ip = req.headers.get('cf-connecting-ip') || 'unknown';
  if (await passLocked(ip)) return NextResponse.json({ error: 'Too many tries. Try again tomorrow.' }, { status: 429 });
  if (!passMatches(pass)) { await passFailed(ip); return NextResponse.json({ error: 'That pass is not valid.' }, { status: 403 }); }
  const res = NextResponse.json({ ok: true });
  res.cookies.set('demo_lead', ownerPassToken(), { path: '/', httpOnly: true, sameSite: 'lax', secure: true, maxAge: 60 * 60 * 24 * 365 });
  return res;
}
