// /mcp — SB Ops for Claude, ChatGPT or any MCP client, acting as the person who signed in from the AI app (lib/oauth.js).
// Tools: lib/mcp-tools.js. Managers and admins only; off in the public demo.
import { handle } from '@/lib/mcp';
import { toolsFor, INSTRUCTIONS } from '@/lib/mcp-tools';
import { queryOne, execute } from '@/lib/db';
import { originOf, sha } from '@/lib/oauth';
import { isPM } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function keyUser(req) {
  const key = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!key) return null;
  const u = await queryOne(`SELECT u.*, k.id AS key_id FROM api_keys k JOIN users u ON u.username = k.username
    WHERE k.hash = ? AND k.revoked = 0 AND (k.expires_at IS NULL OR k.expires_at > ?) AND u.active = 1 AND u.pending = 0`, [sha(key), Date.now()]);
  if (!u || !isPM(u)) return null;
  execute('UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?', [u.key_id]).catch(() => {});
  const { password: _p, ...user } = u;
  return user;
}

export async function POST(req) {
  if (process.env.DEMO_MODE === '1') return new Response('Not available in the demo', { status: 404 });
  // A web page elsewhere must not drive this (the MCP spec's Origin rule); AI apps send no Origin.
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin && origin !== originOf(req)) return new Response('Forbidden', { status: 403 });
  const user = await keyUser(req);
  if (!user) return Response.json({ error: 'Sign in: connect this app from Claude or ChatGPT (managers and admins)' },
    { status: 401, headers: { 'WWW-Authenticate': `Bearer resource_metadata="${originOf(req)}/.well-known/oauth-protected-resource"` } });
  if (!req.headers.get('content-type')?.includes('application/json')) return new Response('Expected application/json', { status: 415 });
  let msg;
  try { msg = await req.json(); } catch { return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 }); }
  const res = await handle(msg, { name: 'sb-ops', tools: toolsFor(user), instructions: INSTRUCTIONS }, user);
  return res ? Response.json(res) : new Response(null, { status: 202 });
}

export const GET = () => new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
