// Meta calls this address: GET once to verify it (hub.challenge), POST for every incoming message and
// delivery status. Public (middleware.js) — the verify token and the X-Hub-Signature-256 check (app
// secret) are the auth. Always answers fast; Meta retries anything that is not a 200.
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { handleWebhook } from '@/lib/whatsapp';

export async function GET(req) {
  const q = new URL(req.url).searchParams;
  const token = q.get('hub.verify_token');
  const ok = q.get('hub.mode') === 'subscribe' && token && await queryOne('SELECT 1 FROM whatsapp_accounts WHERE verify_token = ?', [token]);
  return ok ? new Response(q.get('hub.challenge') || '', { status: 200 }) : new Response('Forbidden', { status: 403 });
}

export async function POST(req) {
  const raw = await req.text();
  try {
    const r = await handleWebhook(raw, req.headers.get('x-hub-signature-256'));
    return NextResponse.json({ ok: r.ok }, { status: r.status });
  } catch (e) {
    console.error('whatsapp webhook', e);
    return NextResponse.json({ ok: false }, { status: 500 }); // Meta retries
  }
}
