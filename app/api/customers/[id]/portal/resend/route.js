// POST — a fresh setup link for a customer who already has a portal login (lost/expired invite).
// Returns the link too, so it can be shared by hand while email is not set up.
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { issueSetupLink, emailPortalInvite } from '@/lib/portal-invite';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Sales')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const customer = await queryOne('SELECT * FROM customers WHERE id = ?', [params.id]);
  if (!customer?.portal_user_id) return NextResponse.json({ error: 'This customer has no portal login yet — enable it first' }, { status: 400 });
  const setupUrl = await issueSetupLink(customer.portal_user_id, req.headers.get('origin') || new URL(req.url).origin);
  const body = await req.json().catch(() => ({}));
  const mail = body.link_only ? null : await emailPortalInvite({ customer, setupUrl, sentBy: user });
  await audit('customer_portal_invite_reissued', { actor: user.username, detail: `#${params.id}${body.link_only ? ' (link only)' : ''}` });
  return NextResponse.json({ ok: true, setup_url: setupUrl, mail });
}
