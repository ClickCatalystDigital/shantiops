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

export class MailNotConfigured extends Error {}

const DEFAULT_COMPANY = 'Shanti Boilers';

export async function getMailMode() {
  const mode = (await getAppSetting('mail_mode')) === 'live' ? 'live' : 'test';
  return { mode, testTo: (await getAppSetting('mail_test_to')) || '' };
}

// Returns { account, source } or throws MailNotConfigured.
export async function pickAccount({ userId = null, company = null } = {}) {
  if (userId) {
    const own = await queryOne("SELECT * FROM mail_accounts WHERE scope = 'user' AND user_id = ?", [userId]);
    if (own) return { account: own, source: 'user' };
  }
  const co = company || DEFAULT_COMPANY;
  const shared = await queryOne("SELECT * FROM mail_accounts WHERE scope = 'company' AND company = ?", [co]);
  if (shared) return { account: shared, source: 'company' };
  throw new MailNotConfigured(
    `No sender mailbox for ${co}. Add the company's Zoho address and app password in Sales → Setup → Email` +
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
    auth: { user: account.email, pass: decryptSecret(account.secret_enc) },
  });
}

// fromUser: { id, username } of the person sending (optional). company: whose mailbox to fall back to
// (use the order/project's company for system mail, not the viewer's).
export async function sendMail({ to, subject, text, attachments, fromUser = null, company = null, kind = 'general' }) {
  const sentBy = fromUser?.username || 'system';
  const { mode, testTo } = await getMailMode();
  const base = { to, subject, kind, company, sentBy };
  let picked;
  try { picked = await pickAccount({ userId: fromUser?.id, company }); }
  catch (err) { await logMail({ ...base, ok: false, error: err.message }); throw err; }
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
  }
  try {
    await transportFor(account).sendMail({ from: account.email, to: realTo, subject: realSubject, text, attachments });
  } catch (err) {
    const msg = err.code === 'EAUTH' ? 'The mailbox rejected the password (check the Zoho app password and that SMTP is enabled)' : err.message;
    await logMail({ ...base, redirectedTo: realTo !== to ? realTo : null, sender: account.email, ok: false, error: msg });
    throw new Error(`Email could not be sent: ${msg}`);
  }
  await logMail({ ...base, redirectedTo: realTo !== to ? realTo : null, sender: account.email, ok: true });
  return { live: mode === 'live', sent: true };
}
