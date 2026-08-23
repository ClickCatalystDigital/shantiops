// lib/mail.js — the one place the app sends real email from (Customer Portal credentials +
// status-update notifications, 2026-08-23). Provider is deliberately not wired up yet: the user
// has an existing provider but hasn't decided the sending identity (which email address customer
// mail should come from). Per instruction ("no workarounds"), this does not fake success — it
// throws a clear, actionable error until MAIL_PROVIDER/MAIL_FROM are set, so a caller (the portal
// toggle, the notification wrapper) surfaces a real "not configured" failure instead of silently
// pretending an email went out.
//
// To wire up the real provider once decided: add a case below and set the two env vars. No other
// file needs to change — every caller already goes through sendMail().
export async function sendMail({ to, subject, text }) {
  const provider = process.env.MAIL_PROVIDER;
  const from = process.env.MAIL_FROM;
  if (!provider || !from) {
    throw new Error('Email is not configured yet — set MAIL_PROVIDER and MAIL_FROM once the sending identity is decided (see lib/mail.js).');
  }
  throw new Error(`lib/mail.js: no dispatch implemented for MAIL_PROVIDER="${provider}" yet.`);
}
