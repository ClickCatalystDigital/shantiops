// Admin registers a machine and gets its agent token — shown once, never stored.
// Revocation = machines.active flag (checked on every agent call), not token expiry.
import { NextResponse } from 'next/server';
import { queryOne, execute } from '@/lib/db';
import { getFreshSessionUser, signAgentToken } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { issueEnrollCode } from '@/lib/enroll';

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!['admin', 'executive'].includes(user?.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();

  const name = String(b.name || '').trim().slice(0, 64);
  if (!name) return NextResponse.json({ error: 'Machine name required' }, { status: 400 });
  const owner = await queryOne('SELECT id FROM users WHERE username = ?', [String(b.username || '')]);
  if (!owner) return NextResponse.json({ error: 'Unknown user' }, { status: 400 });

  const { lastId } = await execute('INSERT INTO machines (name, user_id) VALUES (?, ?)', [name, owner.id]);
  const machineId = Number(lastId);
  const code = await issueEnrollCode(machineId);
  await audit('token_issued', { machine_id: machineId, actor: user.username, detail: name });
  // token retained as the manual fallback path; code is the zero-typing default.
  return NextResponse.json({ id: machineId, code, token: signAgentToken(machineId) });
}

// Kill switch / reactivate.
export async function PATCH(req) {
  const user = await getFreshSessionUser();
  if (!['admin', 'executive'].includes(user?.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  const machine = await queryOne('SELECT * FROM machines WHERE id = ?', [Number(b.id)]);
  if (!machine) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await execute('UPDATE machines SET active = ? WHERE id = ?', [b.active ? 1 : 0, machine.id]);
  await audit(b.active ? 'machine_enabled' : 'machine_disabled', { machine_id: machine.id, actor: user.username });
  return NextResponse.json({ ok: true });
}
