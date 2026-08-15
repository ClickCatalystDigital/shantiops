// Downloads a per-machine shanti-enroll.json (server URL + live enroll code). Either a PM sends
// this to the employee directly, or the employee grabs it themselves from the device-setup gate
// (root layout) once their admin has registered the machine. Leak risk is bounded: single-use,
// 24h expiry, and an enrolled machine does nothing without manager TOTP.
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, isPM } from '@/lib/auth';
import { ensureEnrollCode } from '@/lib/enroll';

export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const machine = await queryOne('SELECT id, name, user_id FROM machines WHERE id = ?', [Number(params.id)]);
  if (!machine) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!isPM(user) && machine.user_id !== user?.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const code = await ensureEnrollCode(machine.id);
  // req.url's origin reflects how Render's proxy forwards the request internally
  // (localhost:$PORT), not the public domain — RENDER_EXTERNAL_URL is the real one.
  const server_url = process.env.RENDER_EXTERNAL_URL || new URL(req.url).origin;
  const body = JSON.stringify({ server_url, enroll_code: code }, null, 2);

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="shanti-enroll.json"',
    },
  });
}
