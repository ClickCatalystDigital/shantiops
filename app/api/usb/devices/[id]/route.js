// Whitelist toggle. Enabling is a standing grant → TOTP required; disabling is free.
import { NextResponse } from 'next/server';
import { queryOne, queryAll, execute } from '@/lib/db';
import { getFreshSessionUser, requirePM } from '@/lib/auth';
import { verifyTotp, audit, effectiveStatus, APPROVAL_MINUTES_DEFAULT } from '@/lib/usb';

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const guard = requirePM(user);
  if (guard) return guard;
  const b = await req.json();

  const device = await queryOne('SELECT * FROM usb_devices WHERE id = ?', [params.id]);
  if (!device) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const on = b.whitelisted ? 1 : 0;

  if (on) {
    const totp = await verifyTotp(user.id, b.totp);
    if (!totp.ok) return NextResponse.json({ error: totp.error }, { status: totp.status });
  }

  await execute('UPDATE usb_devices SET whitelisted = ? WHERE id = ?', [on, device.id]);
  await audit(on ? 'whitelist_on' : 'whitelist_off', {
    actor: user.username, detail: `${device.vendor_id}:${device.product_id} ${device.serial}`.trim(),
  });

  // Whitelisting shouldn't strand an employee already waiting — approve their pending request too.
  if (on) {
    const pending = await queryAll('SELECT * FROM usb_requests WHERE device_id = ? AND status = ?', [device.id, 'pending']);
    for (const r of pending.filter(r => effectiveStatus(r) === 'pending')) {
      const expires = Date.now() + APPROVAL_MINUTES_DEFAULT * 60 * 1000;
      await execute(
        `UPDATE usb_requests SET status = 'approved', decided_at = CURRENT_TIMESTAMP, decided_by = ?, expires_at = ?
         WHERE id = ?`,
        [user.username, expires, r.id]
      );
      await audit('approved', { request_id: r.id, machine_id: r.machine_id, actor: user.username, detail: 'via whitelist' });
    }
  }
  return NextResponse.json({ ok: true });
}
