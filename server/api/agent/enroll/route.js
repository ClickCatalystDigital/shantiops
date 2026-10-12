// Unauthenticated: an agent redeems a single-use enroll code for its long-lived machine token.
// Bypassed from the cookie-required middleware (path starts with /api/agent). Rate-limited + audited.
import { NextResponse } from 'next/server';
import { queryOne, execute } from '@/lib/db';
import { signAgentToken } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { enrollRateLimited } from '@/lib/enroll';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  if (enrollRateLimited(ip)) return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });

  const code = String((await req.json()).code || '').trim().toUpperCase();
  if (!code) return NextResponse.json({ error: 'Code required' }, { status: 400 });

  const machine = await queryOne(
    'SELECT id, name FROM machines WHERE enroll_code = ? AND enroll_expires > ? AND active = 1',
    [code, Date.now()]
  );
  if (!machine) {
    await audit('enroll_failed', { actor: 'agent', detail: `ip=${ip}` });
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 403 });
  }

  // Single-use: clear the code so it can't be replayed.
  await execute('UPDATE machines SET enroll_code = NULL, enroll_expires = NULL, enrolled_at = CURRENT_TIMESTAMP WHERE id = ?',
    [machine.id]);
  await audit('enrolled', { machine_id: machine.id, actor: 'agent', detail: `ip=${ip}` });
  return NextResponse.json({ token: signAgentToken(machine.id) });
}
