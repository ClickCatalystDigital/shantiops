// Manager CRUD for browser domain policies. PM-only.
import { NextResponse } from 'next/server';
import { queryAll, execute } from '@/lib/db';
import { getFreshSessionUser, requirePM } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { normalizeDomain, POLICY_ACTIONS } from '@/lib/browser';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getFreshSessionUser();
  const guard = requirePM(user);
  if (guard) return guard;
  const policies = await queryAll("SELECT * FROM approval_policies WHERE kind = 'browser' ORDER BY target");
  return NextResponse.json({ policies });
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const guard = requirePM(user);
  if (guard) return guard;
  const b = await req.json();
  if (!POLICY_ACTIONS.includes(b.action)) return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  let domain;
  try {
    domain = normalizeDomain(b.target);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  await execute(
    `INSERT INTO approval_policies (kind, target, action) VALUES ('browser', ?, ?)
     ON CONFLICT(kind, target) DO UPDATE SET action = excluded.action`,
    [domain, b.action]
  );
  await audit('policy_set', { actor: user.username, detail: `browser ${domain} → ${b.action}` });
  return NextResponse.json({ ok: true, target: domain });
}

export async function DELETE(req) {
  const user = await getFreshSessionUser();
  const guard = requirePM(user);
  if (guard) return guard;
  const b = await req.json();
  const domain = String(b.target || '');
  await execute("DELETE FROM approval_policies WHERE kind = 'browser' AND target = ?", [domain]);
  await audit('policy_removed', { actor: user.username, detail: `browser ${domain}` });
  return NextResponse.json({ ok: true });
}
