// POST { scope, company? } — sends a test message from that mailbox to the caller's own address (or to
// the mailbox itself), regardless of test/live mode, and records the result on the account.
import { NextResponse } from 'next/server';
import { queryOne, execute } from '@/lib/db';
import { getFreshSessionUser, isDepartmentHead, isInternal } from '@/lib/auth';
import { transportFor, MAIL_PURPOSES } from '@/lib/mail';

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!user || !isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  let acc;
  if (b.scope === 'company') {
    const purpose = MAIL_PURPOSES[b.purpose] ? b.purpose : 'sales';
    if (!isDepartmentHead(user, MAIL_PURPOSES[purpose])) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    acc = await queryOne("SELECT * FROM mail_accounts WHERE scope = 'company' AND company = ? AND purpose = ?", [b.company, purpose]);
  } else {
    acc = await queryOne("SELECT * FROM mail_accounts WHERE scope = 'user' AND user_id = ?", [user.id]);
  }
  if (!acc) return NextResponse.json({ error: 'Save the mailbox first' }, { status: 400 });
  try {
    await transportFor(acc).sendMail({ from: acc.email, to: acc.email, subject: 'SB Ops — mailbox test', text: 'This mailbox is set up correctly for sending from SB Ops.' });
    await execute('UPDATE mail_accounts SET last_test_at = CURRENT_TIMESTAMP, last_test_ok = 1, last_test_error = NULL WHERE id = ?', [acc.id]);
    return NextResponse.json({ ok: true, sentTo: acc.email });
  } catch (err) {
    const msg = err.code === 'EAUTH' ? 'The mailbox rejected the password — check the app password and that SMTP sending is enabled for this mailbox' : err.message;
    await execute('UPDATE mail_accounts SET last_test_at = CURRENT_TIMESTAMP, last_test_ok = 0, last_test_error = ? WHERE id = ?', [msg, acc.id]);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
