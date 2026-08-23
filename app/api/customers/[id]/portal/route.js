// app/api/customers/[id]/portal/route.js — the admin per-customer toggle (§6, 2026-08-23) that
// creates a Customer Portal login and sends the initial credentials email. Turning it back off
// only stops future status-update email (lib/notify.js) — it never deletes the login, so a
// customer who was already emailed doesn't lose access over a later opt-out.
import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { execute, queryOne, queryAll } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { sendMail } from '@/lib/mail';
import { audit } from '@/lib/usb';

function canAccessCrm(user) {
  return isPM(user) || ['Sales', 'Marketing'].some(d => canAccessDepartment(user, d));
}

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

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

  if (!customer.email?.trim()) {
    return NextResponse.json({ error: 'This customer has no email on file — add one first' }, { status: 400 });
  }

  let userId = customer.portal_user_id;
  if (!userId) {
    // Every project this customer already owns, by the real FK where it exists (customer_id),
    // falling back to the free-text name match for projects created before that column existed
    // (§7 — projects.customer_id is additive/nullable).
    const projects = await queryAll(
      'SELECT id FROM projects WHERE customer_id = ? OR customer_name = ?', [params.id, customer.name]);
    const projectIds = [...new Set(projects.map(p => String(p.id)))].join(',') || null;

    let username = customer.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `customer${params.id}`;
    let candidate = username, n = 1;
    while (await queryOne('SELECT id FROM users WHERE username = ?', [candidate])) candidate = `${username}${++n}`;
    username = candidate;

    // Random, unusable password — this account can't log in until the customer follows the setup
    // link below and sets their own. Never logged, never stored anywhere but this one bcrypt hash.
    const placeholder = randomBytes(24).toString('hex');
    const token = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const r = await execute(
      `INSERT INTO users (username, password, role, display_name, project_ids, password_setup_token, password_setup_expires)
       VALUES (?, ?, 'customer', ?, ?, ?, ?)`,
      [username, bcrypt.hashSync(placeholder, 10), customer.name, projectIds, token, expires]
    );
    userId = Number(r.lastId);
    await execute('UPDATE customers SET portal_user_id = ? WHERE id = ?', [userId, params.id]);
  } else {
    // Re-enabling — no existing login to disturb, but a fresh setup link in case the original one
    // expired or was never used.
    const token = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    await execute('UPDATE users SET password_setup_token = ?, password_setup_expires = ? WHERE id = ?', [token, expires, userId]);
  }

  const freshUser = await queryOne('SELECT password_setup_token FROM users WHERE id = ?', [userId]);
  const origin = req.headers.get('origin') || new URL(req.url).origin;
  const setupUrl = `${origin}/set-password?token=${freshUser.password_setup_token}`;

  try {
    await sendMail({
      to: customer.email,
      subject: 'Set up your Shanti Boilers order portal access',
      text: `Hello ${customer.name},\n\nYou can now track your order(s) online. Set your password to get started:\n${setupUrl}\n\nThis link expires in 7 days.`,
    });
  } catch (err) {
    return NextResponse.json({ error: `Login created, but the email failed to send: ${err.message}` }, { status: 502 });
  }

  await execute('UPDATE customers SET portal_enabled = 1, initial_email_sent_at = CURRENT_TIMESTAMP WHERE id = ?', [params.id]);
  await audit('customer_portal_enabled', { actor: user.username, detail: `#${params.id} -> user ${userId}` });
  return NextResponse.json({ ok: true });
}
