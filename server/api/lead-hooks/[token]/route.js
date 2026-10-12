// Public lead intake for push sources (JustDial, website / other forms). The long random token in the
// address is the only credential — it identifies one lead_source_accounts row. Accepts JSON (one lead,
// an array, or { leads: [...] }) or ordinary form fields. Always answers quickly; a duplicate is a
// success ("already have it"), so a provider's retry never loops.
import { NextResponse } from 'next/server';
import { queryOne, execute } from '@/lib/db';
import { LEAD_SOURCES, MAPPERS } from '@/lib/lead-sources.mjs';
import { ingestLeads } from '@/lib/lead-ingest';

async function readBody(req) {
  const type = req.headers.get('content-type') || '';
  if (type.includes('application/json')) return await req.json();
  if (type.includes('form')) return Object.fromEntries((await req.formData()).entries());
  // JustDial has been seen sending leads as query parameters on a GET/POST with no body.
  return Object.fromEntries(new URL(req.url).searchParams.entries());
}

async function handle(req, { params }) {
  const account = await queryOne('SELECT * FROM lead_source_accounts WHERE webhook_token = ?', [params.token]);
  if (!account || LEAD_SOURCES[account.source]?.kind !== 'push') return NextResponse.json({ error: 'Unknown address' }, { status: 404 });
  if (!account.enabled) return NextResponse.json({ ok: true, paused: true });
  let body;
  try { body = await readBody(req); } catch { return NextResponse.json({ error: 'Could not read the lead' }, { status: 400 }); }
  const rows = (Array.isArray(body) ? body : Array.isArray(body?.leads) ? body.leads : [body]).filter(r => r && typeof r === 'object').slice(0, 200);
  if (!rows.length || !Object.keys(rows[0]).length) return NextResponse.json({ ok: true, received: 0 }); // a bare ping
  try {
    const result = await ingestLeads(account, rows.map(MAPPERS[account.source]));
    const n = result.added + result.merged;
    await execute(
      `UPDATE lead_source_accounts SET last_sync_at = CURRENT_TIMESTAMP, last_success_at = CURRENT_TIMESTAMP, last_error = NULL, last_added = ?, total_added = total_added + ? WHERE id = ?`,
      [n, n, account.id]);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    await execute('UPDATE lead_source_accounts SET last_sync_at = CURRENT_TIMESTAMP, last_error = ? WHERE id = ?', [String(err.message).slice(0, 300), account.id]);
    return NextResponse.json({ error: 'Could not save the lead' }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
