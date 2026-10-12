// Agent-facing: the browser policy list the local agent caches and serves to its extension.
// Bearer agent auth (same posture as app/api/agent/requests). Single-tenant → global list.
import { NextResponse } from 'next/server';
import { queryAll, queryOne, execute } from '@/lib/db';
import { getUserFromRequest, isAgent } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function getMachine(req) {
  const claims = getUserFromRequest(req);
  if (!isAgent(claims) || !claims.machine_id) return null;
  const machine = await queryOne('SELECT * FROM machines WHERE id = ? AND active = 1', [claims.machine_id]);
  if (!machine) return null;
  await execute('UPDATE machines SET last_seen = CURRENT_TIMESTAMP WHERE id = ?', [machine.id]);
  return machine;
}

export async function GET(req) {
  const machine = await getMachine(req);
  if (!machine) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const policies = await queryAll(
    "SELECT target, action FROM approval_policies WHERE kind = 'browser' ORDER BY target"
  );
  return NextResponse.json({ policies });
}
