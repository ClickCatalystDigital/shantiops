// lib/mail.js — the one place the app sends real email from. SMTP via nodemailer (Zoho by default).
//
// Sender, in order: the sending user's own saved mailbox → the company's shared mailbox → a clear
// MailNotConfigured error naming exactly what is missing. Passwords live encrypted in
// mail_accounts (lib/crypto.js). Every attempt is written to mail_log.
//
// Safety switch: app_settings.mail_mode is 'test' (default) or 'live'. In test mode nothing reaches the
// real recipient — the mail goes to app_settings.mail_test_to (subject tagged [TEST]) or, if that is
// blank, is only logged. sendMail returns { live } so callers can avoid recording "sent" for a test.
import nodemailer from 'nodemailer';
import { queryOne, execute, getAppSetting } from './db';
import { decryptSecret } from './crypto';
import { defaultCompany } from './company-profiles.js';

export class MailNotConfigured extends Error {}



export async function getMailMode() {
  const mode = (await getAppSetting('mail_mode')) === 'live' ? 'live' : 'test';
  return { mode, testTo: (await getAppSetting('mail_test_to')) || '' };
}

// Returns { account, source } or throws MailNotConfigured.
// purpose: 'sales' (default) or 'procurement'. No fallback between them — a procurement send with no
// procurement mailbox is an error, not a quiet send from the sales address.
export const MAIL_PURPOSES = { sales: 'Sales', procurement: 'Procurement' };

// Staff alert emails (Settings → Alerts) go out from the platform's own sender, not a client mailbox:
// ALERTS_SMTP_USER / ALERTS_SMTP_PASS (+ optional ALERTS_SMTP_HOST, ALERTS_SMTP_PORT, ALERTS_FROM),
// set on the server by Ahrom Labs. Same test/live switch as every other email.
function alertsAccount() {
  const user = process.env.ALERTS_SMTP_USER, pass = process.env.ALERTS_SMTP_PASS;
  if (!user || !pass) return null;
  return { email: process.env.ALERTS_FROM || user, smtp_user: user, pass,
    smtp_host: process.env.ALERTS_SMTP_HOST || (/@gmail\.com$/i.test(user) ? 'smtp.gmail.com' : 'smtp.zoho.in'),
    smtp_port: Number(process.env.ALERTS_SMTP_PORT) || 465 };
}
export const MAIL_FOOTER = '\n\n—\nSB Ops — an ahromlabs.com product · https://ahromlabs.com\n© Ahrom Labs. All rights reserved.';

export async function pickAccount({ userId = null, company = null, purpose = 'sales' } = {}) {
  if (purpose === 'alerts') {
    const acc = alertsAccount();
    if (acc) return { account: acc, source: 'platform' };
    throw new MailNotConfigured('Alert emails are not set up on the server yet (ALERTS_SMTP_USER / ALERTS_SMTP_PASS).');
  }
  if (userId) {
    const own = await queryOne("SELECT * FROM mail_accounts WHERE scope = 'user' AND user_id = ?", [userId]);
    if (own) return { account: own, source: 'user' };
  }
  const co = company || defaultCompany();
  const shared = await queryOne("SELECT * FROM mail_accounts WHERE scope = 'company' AND company = ? AND purpose = ?", [co, purpose]);
  if (shared) return { account: shared, source: 'company' };
  const dept = MAIL_PURPOSES[purpose] || 'Sales';
  throw new MailNotConfigured(
    `No ${dept} mailbox for ${co}. Add the company's ${dept.toLowerCase()} address and app password in Settings → ${dept} → Email` +
    (userId ? ', or save your own in "My email".' : '.'));
}

async function logMail(row) {
  try {
    await execute(
      `INSERT INTO mail_log (to_addr, redirected_to, subject, kind, company, sender, ok, error, sent_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.to, row.redirectedTo || null, row.subject, row.kind, row.company || null, row.sender || null, row.ok ? 1 : 0, row.error || null, row.sentBy || null]);
  } catch { /* logging must never break a send */ }
}

export function transportFor(account) {
  return nodemailer.createTransport({
    host: account.smtp_host, port: account.smtp_port, secure: Number(account.smtp_port) === 465,
    auth: { user: account.smtp_user || account.email, pass: account.pass ?? decryptSecret(account.secret_enc) },
  });
}

// fromUser: { id, username } of the person sending (optional). company: whose mailbox to fall back to
// (use the order/project's company for system mail, not the viewer's).
export async function sendMail({ to, subject, text, html, attachments, fromUser = null, company = null, kind = 'general', purpose = 'sales' }) {
  const sentBy = fromUser?.username || 'system';
  const { mode, testTo } = await getMailMode();
  const base = { to, subject, kind, company, sentBy };
  let picked;
  try { picked = await pickAccount({ userId: fromUser?.id, company, purpose }); }
  catch (err) {
    // Test mode with no mailbox yet (demo/dev): nothing could reach a customer anyway, so log and carry on.
    if (mode !== 'live' && err instanceof MailNotConfigured) {
      await logMail({ ...base, ok: true, error: 'test mode — not sent (no mailbox set up yet)' });
      return { live: false, sent: false };
    }
    await logMail({ ...base, ok: false, error: err.message }); throw err;
  }
  const { account } = picked;

  let realTo = to, realSubject = subject;
  if (mode !== 'live') {
    if (!testTo) {
      await logMail({ ...base, sender: account.email, ok: true, error: 'test mode — not sent (no test address set)' });
      return { live: false, sent: false };
    }
    realTo = testTo;
    realSubject = `[TEST] ${subject}`;
    text = `(Test mode — this would have gone to ${to})\n\n${text}`;
    if (html) html = html.replace(/<body[^>]*>/, m => `${m}<div style="max-width:560px;margin:0 auto 10px;font:12px sans-serif;color:#71717a;text-align:center;">Test mode — this would have gone to ${to}</div>`);
  }
  try {
    await transportFor(account).sendMail({ from: account.email, to: realTo, subject: realSubject, text, html, attachments });
  } catch (err) {
    const msg = err.code === 'EAUTH' ? 'The mailbox rejected the password (check the app password and that SMTP sending is enabled for this mailbox)' : err.message;
    await logMail({ ...base, redirectedTo: realTo !== to ? realTo : null, sender: account.email, ok: false, error: msg });
    throw new Error(`Email could not be sent: ${msg}`);
  }
  await logMail({ ...base, redirectedTo: realTo !== to ? realTo : null, sender: account.email, ok: true });
  return { live: mode === 'live', sent: true };
}
