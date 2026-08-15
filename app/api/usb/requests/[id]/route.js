// Manager decisions on a USB request: approve (TOTP-gated) / reject / revoke.
// Operators may only set `reason` on a pending request for their own machine.
import { NextResponse } from 'next/server';
import { queryOne, execute } from '@/lib/db';
import { getFreshSessionUser, isPM, isHead } from '@/lib/auth';
import { effectiveStatus, verifyTotp, audit, APPROVAL_MINUTES_DEFAULT } from '@/lib/usb';

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isPM(user) && !isHead(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();

  const row = await queryOne('SELECT * FROM usb_requests WHERE id = ?', [params.id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const status = effectiveStatus(row);

  // Operator branch: only their own machine's pending request, only the reason field.
  if (!isPM(user)) {
    const machine = await queryOne('SELECT id FROM machines WHERE id = ? AND user_id = ?', [row.machine_id, user.id]);
    if (!machine || typeof b.reason !== 'string') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (status !== 'pending') return NextResponse.json({ error: `Request is ${status}` }, { status: 409 });
    await execute('UPDATE usb_requests SET reason = ? WHERE id = ?', [b.reason.slice(0, 200), row.id]);
    return NextResponse.json({ ok: true });
  }

  switch (b.action) {
    case 'approve': {
      if (status !== 'pending') return NextResponse.json({ error: `Request is ${status}` }, { status: 409 });
      const totp = await verifyTotp(user.id, b.totp);
      if (!totp.ok) return NextResponse.json({ error: totp.error }, { status: totp.status });
      const minutes = Math.min(60, Math.max(5, Number(b.minutes) || APPROVAL_MINUTES_DEFAULT));
      const expires = Date.now() + minutes * 60 * 1000;
      await execute(
        `UPDATE usb_requests SET status = 'approved', decided_at = CURRENT_TIMESTAMP, decided_by = ?, expires_at = ?
         WHERE id = ?`,
        [user.username, expires, row.id]
      );
      await audit('approved', {
        request_id: row.id, machine_id: row.machine_id, actor: user.username, detail: `${minutes} min`,
      });
      return NextResponse.json({ ok: true, expires_at: expires });
    }
    case 'reject': {
      // Denying needs less ceremony than granting — no TOTP for reject/revoke.
      if (status !== 'pending') return NextResponse.json({ error: `Request is ${status}` }, { status: 409 });
      await execute(
        `UPDATE usb_requests SET status = 'rejected', decided_at = CURRENT_TIMESTAMP, decided_by = ? WHERE id = ?`,
        [user.username, row.id]
      );
      await audit('rejected', { request_id: row.id, machine_id: row.machine_id, actor: user.username });
      return NextResponse.json({ ok: true });
    }
    case 'revoke': {
      if (status !== 'approved') return NextResponse.json({ error: `Request is ${status}` }, { status: 409 });
      await execute(
        `UPDATE usb_requests SET status = 'revoked', decided_at = CURRENT_TIMESTAMP, decided_by = ? WHERE id = ?`,
        [user.username, row.id]
      );
      await audit('revoked', { request_id: row.id, machine_id: row.machine_id, actor: user.username });
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
}
