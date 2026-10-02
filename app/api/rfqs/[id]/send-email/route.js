// app/api/rfqs/[id]/send-email/route.js — email one supplier their RFQ from the app, through the
// company's Procurement mailbox (lib/mail.js, purpose 'procurement'). In test mode nothing reaches the
// supplier, so the supplier is only marked sent when the mail really went out.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getRfqDetail } from '@/lib/data';
import { sendMail } from '@/lib/mail';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Procurement', 'procurement.rfq.record');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const rfq = await getRfqDetail(params.id);
  if (!rfq) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (rfq.status === 'closed') return NextResponse.json({ error: 'This RFQ is cancelled' }, { status: 400 });
  const rs = rfq.suppliers.find(s => s.supplier_id === Number(b.supplier_id));
  if (!rs) return NextResponse.json({ error: 'Supplier is not on this RFQ' }, { status: 404 });
  const to = String(b.to || rs.email || '').trim();
  const subject = String(b.subject || '').trim();
  const body = String(b.body || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return NextResponse.json({ error: 'A valid supplier email address is required' }, { status: 400 });
  if (!subject || !body) return NextResponse.json({ error: 'Subject and message are required' }, { status: 400 });

  let sent;
  try {
    sent = await sendMail({ to, subject, text: body, fromUser: user, company: rfq.company, kind: 'rfq', purpose: 'procurement' });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
  if (!sent.live) return NextResponse.json({ ok: true, live: false, note: 'Email is in test mode — it was not sent to the supplier.' });

  await execute('UPDATE rfq_suppliers SET sent_at = CURRENT_TIMESTAMP WHERE id = ?', [rs.id]);
  await execute("UPDATE rfqs SET status = 'sent' WHERE id = ? AND status = 'draft'", [params.id]);
  await audit('rfq_emailed', { actor: user.username, detail: `${rfq.rfq_no} -> ${to}` });
  return NextResponse.json({ ok: true, live: true });
}
