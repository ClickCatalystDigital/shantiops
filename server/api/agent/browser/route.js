// Agent-facing browser requests. Bearer agent auth. machine_id from the token only.
import { NextResponse } from 'next/server';
import { queryAll, queryOne, execute } from '@/lib/db';
import { getUserFromRequest, isAgent } from '@/lib/auth';
import { effectiveStatus, isLive, audit } from '@/lib/usb';
import { normalizeDomain, matchPolicy } from '@/lib/browser';

export const dynamic = 'force-dynamic';

async function getMachine(req) {
  const claims = getUserFromRequest(req);
  if (!isAgent(claims) || !claims.machine_id) return null;
  const machine = await queryOne('SELECT * FROM machines WHERE id = ? AND active = 1', [claims.machine_id]);
  if (!machine) return null;
  await execute('UPDATE machines SET last_seen = CURRENT_TIMESTAMP WHERE id = ?', [machine.id]);
  return machine;
}

// Extension asked to open an approval-required domain → create (or return) a pending request.
export async function POST(req) {
  const machine = await getMachine(req);
  if (!machine) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let domain;
  try {
    domain = normalizeDomain((await req.json()).domain);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  // Only approval-required domains get a request; allow/block/unlisted don't.
  const policies = await queryAll("SELECT target, action FROM approval_policies WHERE kind = 'browser'");
  const action = matchPolicy(domain, policies);
  if (action !== 'approval') return NextResponse.json({ status: action || 'allow' });

  // Idempotent: a live request for this machine+domain returns itself.
  const last = await queryOne(
    'SELECT * FROM browser_requests WHERE machine_id = ? AND domain = ? ORDER BY id DESC LIMIT 1',
    [machine.id, domain]
  );
  if (last && isLive(last)) {
    return NextResponse.json({ id: last.id, domain, status: effectiveStatus(last), expires_at: last.expires_at });
  }

  const { lastId } = await execute(
    'INSERT INTO browser_requests (machine_id, domain) VALUES (?, ?)', [machine.id, domain]
  );
  await audit('browser_requested', { request_id: Number(lastId), machine_id: machine.id, actor: machine.name, detail: domain });
  return NextResponse.json({ id: Number(lastId), domain, status: 'pending', expires_at: null });
}

// Poll: this machine's live browser requests (pending + approved-unexpired) for the agent's grant cache.
export async function GET(req) {
  const machine = await getMachine(req);
  if (!machine) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const rows = await queryAll(
    'SELECT * FROM browser_requests WHERE machine_id = ? ORDER BY id DESC', [machine.id]
  );
  const requests = rows
    .map(r => ({ id: r.id, domain: r.domain, status: effectiveStatus(r), expires_at: r.expires_at }))
    .filter(r => r.status === 'pending' || r.status === 'approved');
  return NextResponse.json({ requests });
}
