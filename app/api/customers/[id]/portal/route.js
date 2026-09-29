// app/api/customers/[id]/portal/route.js — the admin per-customer toggle (§6, 2026-08-23) that
// creates a Customer Portal login and sends the initial credentials email. Turning it back off
// only stops future status-update email (lib/notify.js) — it never deletes the login, so a
// customer who was already emailed doesn't lose access over a later opt-out.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { requireCrmAction } from '@/lib/action-permissions';
import { ensurePortalLogin, issueSetupLink, emailPortalInvite } from '@/lib/portal-invite';
import { audit } from '@/lib/usb';

function canAccessCrm(user) {
  return isPM(user) || ['Sales', 'Marketing'].some(d => canAccessDepartment(user, d));
}

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  // Creates a real login and sends a real email to an external customer — had no action-key gate
  // at all (2026-09-23 isolation fix); reuses the same key POST /api/customers already enforces.
  const actionDenied = await requireCrmAction(user, 'sales.customer.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const enabled = !!b.enabled;
  const customer = await queryOne('SELECT * FROM customers WHERE id = ?', [params.id]);
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!enabled) {
    await execute('UPDATE customers SET portal_enabled = 0 WHERE id = ?', [params.id]);
    await audit('customer_portal_disabled', { actor: user.username, detail: `#${params.id}` });
    return NextResponse.json({ ok: true });
  }

  // Already on — a repeat click (or a double-submit) shouldn't regenerate a fresh setup link and
  // resend the email; that would silently invalidate a link the customer might already be mid-way
  // through using. Re-inviting a customer who lost their email is a distinct action, not this one.
  if (customer.portal_enabled) return NextResponse.json({ ok: true });

  const userId = await ensurePortalLogin(customer);
  const setupUrl = await issueSetupLink(userId, req.headers.get('origin') || new URL(req.url).origin);
  // Login exists and the switch is on even if the email can't go out yet (no mailbox, no address,
  // test mode) — the caller gets the link and the reason, and Portal Access can resend later.
  await execute('UPDATE customers SET portal_enabled = 1 WHERE id = ?', [params.id]);
  const mail = await emailPortalInvite({ customer, setupUrl, sentBy: user });
  await audit('customer_portal_enabled', { actor: user.username, detail: `#${params.id} -> user ${userId}` });
  return NextResponse.json({ ok: true, setup_url: setupUrl, mail });
}
