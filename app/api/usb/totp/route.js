// TOTP self-enrollment for approvers, two-phase so a mis-scan can't lock anyone out:
// POST {}       → new secret into totp_pending_secret, returns otpauth URL + QR data-URL
// POST {code}   → verify against pending, promote to totp_secret
import { NextResponse } from 'next/server';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { queryOne, execute } from '@/lib/db';
import { getFreshSessionUser, requirePM } from '@/lib/auth';

export async function POST(req) {
  const user = await getFreshSessionUser();
  const guard = requirePM(user);
  if (guard) return guard;
  const b = await req.json();

  if (!b.code) {
    const secret = authenticator.generateSecret();
    await execute('UPDATE users SET totp_pending_secret = ? WHERE id = ?', [secret, user.id]);
    const otpauth = authenticator.keyuri(user.username, 'Shanti Ops', secret);
    const qr = await QRCode.toDataURL(otpauth);
    return NextResponse.json({ otpauth, qr });
  }

  const row = await queryOne('SELECT totp_pending_secret FROM users WHERE id = ?', [user.id]);
  if (!row?.totp_pending_secret) return NextResponse.json({ error: 'No setup in progress' }, { status: 400 });
  authenticator.options = { window: 1 };
  if (!authenticator.check(String(b.code).trim(), row.totp_pending_secret)) {
    return NextResponse.json({ error: 'Invalid code — try again' }, { status: 403 });
  }
  await execute(
    `UPDATE users SET totp_secret = totp_pending_secret, totp_pending_secret = NULL,
            totp_fails = 0, totp_lock_until = NULL, totp_last_code = NULL WHERE id = ?`,
    [user.id]
  );
  return NextResponse.json({ ok: true });
}
