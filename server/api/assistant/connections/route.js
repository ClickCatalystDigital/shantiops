import { NextResponse } from 'next/server';
import { getFreshSessionUser, isPM } from '@/lib/auth';
import { queryAll, execute } from '@/lib/db';

// My AI app connections (Claude, ChatGPT…) made through the MCP sign-in (lib/oauth.js). DELETE ?id= disconnects one.
async function me() {
  const user = await getFreshSessionUser();
  return isPM(user) && process.env.DEMO_MODE !== '1' ? user : null;
}
export async function GET() {
  const user = await me();
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const rows = await queryAll('SELECT id, name, created_at, last_used_at, expires_at FROM api_keys WHERE username = ? AND revoked = 0 ORDER BY id DESC', [user.username]);
  return NextResponse.json({ connections: rows });
}
export async function DELETE(req) {
  const user = await me();
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const id = Number(new URL(req.url).searchParams.get('id'));
  await execute('UPDATE api_keys SET revoked = 1 WHERE id = ? AND username = ?', [id, user.username]);
  return NextResponse.json({ ok: true });
}
