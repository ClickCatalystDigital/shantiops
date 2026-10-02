// app/api/mail-accounts/route.js — sender mailboxes for outgoing email (lib/mail.js).
// Company mailboxes: Sales Head / PM. A user's own mailbox: that user only. The password is never
// returned, never audited; it is stored encrypted (lib/crypto.js).
import { NextResponse } from 'next/server';
import { queryAll, queryOne, execute } from '@/lib/db';
import { getFreshSessionUser, isDepartmentHead, isInternal, canAccessDepartment } from '@/lib/auth';
import { getMailMode, MAIL_PURPOSES } from '@/lib/mail';
import { encryptSecret } from '@/lib/crypto';
import { audit } from '@/lib/usb';

// ?purpose=sales (default) | procurement — each department manages its own company mailboxes.
const purposeOf = v => (MAIL_PURPOSES[v] ? v : 'sales');
const deptOf = purpose => MAIL_PURPOSES[purpose];
const canAdmin = (user, purpose = 'sales') => isDepartmentHead(user, deptOf(purpose));

function pub(a) {
  return a && { id: a.id, email: a.email, smtp_host: a.smtp_host, smtp_port: a.smtp_port, updated_at: a.updated_at,
    last_test_at: a.last_test_at, last_test_ok: a.last_test_ok, last_test_error: a.last_test_error };
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  const purpose = purposeOf(new URL(req.url).searchParams.get('purpose'));
  if (!user || !isInternal(user) || !(canAccessDepartment(user, deptOf(purpose)) || canAdmin(user, purpose))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const admin = canAdmin(user, purpose);
  const companies = admin ? await queryAll('SELECT company, legal_name FROM company_settings ORDER BY company') : [];
  const shared = admin ? await queryAll("SELECT * FROM mail_accounts WHERE scope = 'company' AND purpose = ?", [purpose]) : [];
  const mine = await queryOne("SELECT * FROM mail_accounts WHERE scope = 'user' AND user_id = ?", [user.id]);
  // Procurement sees only its own (RFQ) mail; Sales sees everything, as before.
  const log = !admin ? [] : purpose === 'procurement'
    ? await queryAll("SELECT * FROM mail_log WHERE kind = 'rfq' ORDER BY id DESC LIMIT 30")
    : await queryAll('SELECT * FROM mail_log ORDER BY id DESC LIMIT 30');
  return NextResponse.json({
    isAdmin: admin,
    purpose,
    // The test/live switch is one switch for the whole app; only the Sales Head / PM changes it.
    canChangeMode: canAdmin(user, 'sales'),
    mode: admin ? await getMailMode() : null,
    companies: companies.map(c => ({ ...c, account: pub(shared.find(a => a.company === c.company)) || null })),
    mine: pub(mine) || null,
    log,
  });
}

export async function PUT(req) {
  const user = await getFreshSessionUser();
  if (!user || !isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  const scope = b.scope === 'company' ? 'company' : 'user';
  const purpose = purposeOf(b.purpose);
  if (scope === 'company' && !canAdmin(user, purpose)) return NextResponse.json({ error: `Only the ${deptOf(purpose)} Head can set a ${deptOf(purpose).toLowerCase()} company mailbox` }, { status: 403 });
  const email = String(b.email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: 'A valid email address is required' }, { status: 400 });
  const host = String(b.smtp_host || 'smtp.zoho.in').trim();
  const port = Number(b.smtp_port) || 465;
  const company = scope === 'company' ? String(b.company || '').trim() : null;
  if (scope === 'company' && !(await queryOne('SELECT 1 FROM company_settings WHERE company = ?', [company]))) {
    return NextResponse.json({ error: 'Unknown company' }, { status: 400 });
  }
  const existing = scope === 'company'
    ? await queryOne("SELECT id FROM mail_accounts WHERE scope = 'company' AND company = ? AND purpose = ?", [company, purpose])
    : await queryOne("SELECT id FROM mail_accounts WHERE scope = 'user' AND user_id = ?", [user.id]);
  const password = String(b.password || '');
  if (!existing && !password) return NextResponse.json({ error: 'The app password is required' }, { status: 400 });
  let secret = null;
  if (password) {
    try { secret = encryptSecret(password); } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }); }
  }
  if (existing) {
    await execute(
      `UPDATE mail_accounts SET email = ?, smtp_host = ?, smtp_port = ?, ${secret ? 'secret_enc = ?,' : ''} updated_by = ?, updated_at = CURRENT_TIMESTAMP,
         last_test_at = NULL, last_test_ok = NULL, last_test_error = NULL WHERE id = ?`,
      [email, host, port, ...(secret ? [secret] : []), user.username, existing.id]);
  } else {
    await execute(
      `INSERT INTO mail_accounts (scope, company, user_id, email, smtp_host, smtp_port, secret_enc, updated_by, purpose) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [scope, company, scope === 'user' ? user.id : null, email, host, port, secret, user.username, scope === 'company' ? purpose : 'sales']);
  }
  await audit('mail_account_saved', { actor: user.username, detail: `${scope}${company ? ` ${company} (${purpose})` : ''} ${email}${password ? ' (password changed)' : ''}` });
  return NextResponse.json({ ok: true });
}
