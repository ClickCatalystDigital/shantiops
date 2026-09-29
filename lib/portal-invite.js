// lib/portal-invite.js — Customer Portal login creation + setup-link invite (shared by the enable and
// resend routes). No password is ever emailed: the login starts with an unusable random password and
// the customer sets their own through /set-password?token=… (7-day link).
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { execute, queryOne, queryAll } from './db';
import { sendMail } from './mail';
import { encryptSecret } from './crypto';

const WEEK_MS = 7 * 24 * 3600 * 1000;

// Customer's phone digits (last 10 when longer, e.g. +91…); null if fewer than 6 — too short to be a phone.
export function phonePassword(customer) {
  const d = String(customer.phone || '').replace(/\D/g, '');
  return d.length >= 6 ? d.slice(-10) : null;
}
export function portalUsernameBase(customer) {
  const first = String(customer.name || '').trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  return first || `customer${customer.id}`;
}
function safeEncrypt(v) { try { return encryptSecret(v); } catch { return null; } } // no SECRETS_KEY: login still works, no read-back

async function customerProjects(customer) {
  return queryAll('SELECT id, company FROM projects WHERE customer_id = ? OR customer_name = ?', [customer.id, customer.name]);
}

// Creates the login if the customer has none; returns its user id.
export async function ensurePortalLogin(customer) {
  if (customer.portal_user_id) return customer.portal_user_id;
  const projects = await customerProjects(customer);
  const projectIds = [...new Set(projects.map(p => String(p.id)))].join(',') || null;
  // Username = first word of the organization name, lowercase letters/digits (any input case works).
  const username = portalUsernameBase(customer);
  const pw = phonePassword(customer); // null when there's no usable phone: the setup link is the fallback
  let candidate = username, n = 1, r;
  for (;;) {
    while (await queryOne('SELECT id FROM users WHERE username = ?', [candidate])) candidate = `${username}${++n}`;
    try {
      r = await execute(
        `INSERT INTO users (username, password, role, display_name, project_ids, portal_password_enc, must_change_password) VALUES (?, ?, 'customer', ?, ?, ?, ?)`,
        [candidate, bcrypt.hashSync(pw || randomBytes(24).toString('hex'), 10), customer.name, projectIds, pw ? safeEncrypt(pw) : null, pw ? 1 : 0]);
      break;
    } catch (err) { if (!String(err).toLowerCase().includes('unique')) throw err; } // lost a race for the name: try the next
  }
  const userId = Number(r.lastId);
  await execute('UPDATE customers SET portal_user_id = ? WHERE id = ?', [userId, customer.id]);
  return userId;
}

// A fresh 7-day link (replaces any earlier one).
export async function issueSetupLink(userId, origin) {
  const token = randomBytes(32).toString('hex');
  await execute('UPDATE users SET password_setup_token = ?, password_setup_expires = ? WHERE id = ?',
    [token, new Date(Date.now() + WEEK_MS).toISOString(), userId]);
  return `${origin}/set-password?token=${token}`;
}

// Emails the link. Never throws: returns { sent, live, error } so the caller can still hand the link over.
export async function emailPortalInvite({ customer, setupUrl, sentBy }) {
  if (!customer.email?.trim()) return { sent: false, live: false, error: 'This customer has no email on file' };
  const projects = await customerProjects(customer);
  try {
    const r = await sendMail({
      to: customer.email.trim(),
      subject: 'Set up your order portal access',
      text: `Hello ${customer.name},\n\nYou can now track your order(s) online. Set your password to get started:\n${setupUrl}\n\nThis link expires in 7 days.`,
      fromUser: sentBy, company: projects[0]?.company || null, kind: 'portal_invite',
    });
    if (r.live) await execute('UPDATE customers SET initial_email_sent_at = CURRENT_TIMESTAMP WHERE id = ?', [customer.id]);
    return { sent: r.sent, live: r.live, error: null };
  } catch (err) {
    return { sent: false, live: false, error: err.message };
  }
}
