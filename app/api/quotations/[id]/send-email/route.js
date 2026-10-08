// app/api/quotations/[id]/send-email/route.js — Phase 3.2's "Send Email" action. Draft
// composing/template switching/PDF preview all work with zero blockers; this route is the one
// place that hits the standing lib/mail.js seam (throws a clean "not configured" error until
// no sender mailbox is set up — see lib/mail.js). No mailto: fallback — it can't attach the generated PDF, a strictly worse
// substitute.
import { hiddenSalesRecord } from '@/lib/sales-visibility';
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { requireCrmAction } from '@/lib/action-permissions';
import { sendMail } from '@/lib/mail';
import { getQuotationDetail } from '@/lib/data';
import { renderQuotationPdf } from '@/lib/quotation-pdf';
import { audit } from '@/lib/usb';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return isPM(user) || CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const hidden = await hiddenSalesRecord(user, 'quotation', params.id); // plan 2a: own records only
  if (hidden) return hidden;
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  // Emails a Sales-owned quotation out to the customer — had no action-key gate at all
  // (2026-09-23 isolation fix). Reuses sales.quotation.status, the closest existing fit (the route
  // itself flips quotations.status to 'sent' as a side effect).
  const actionDenied = await requireCrmAction(user, 'sales.quotation.status');
  if (actionDenied) return actionDenied;

  const quotation = await queryOne(
    `SELECT q.*, c.email AS customer_email FROM quotations q JOIN customers c ON c.id = q.customer_id WHERE q.id = ?`,
    [params.id]
  );
  if (!quotation) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (quotation.approval_status === 'pending') return NextResponse.json({ error: 'This quotation\'s discount needs a Sales Head\'s approval before it can be sent' }, { status: 409 });
  const b = await req.json();
  const subject = String(b.subject || '').trim();
  const body = String(b.body || '').trim();
  if (!subject || !body) return NextResponse.json({ error: 'Subject and body are required' }, { status: 400 });
  const to = b.to || quotation.customer_email;
  if (!to) return NextResponse.json({ error: 'No customer email on file' }, { status: 400 });

  // Attach the quotation PDF (same generator as GET /api/quotations/[id]/pdf).
  const detail = await getQuotationDetail(params.id, b.email_template_id ? Number(b.email_template_id) : null);
  const pdf = await renderQuotationPdf(detail, detail.items);
  let sent;
  try {
    sent = await sendMail({
      to, subject, text: body, fromUser: user, company: quotation.company || null, kind: 'quotation',
      attachments: [{ filename: `${quotation.quotation_no.replace(/\//g, '-')}.pdf`, content: pdf }],
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
  // Test mode (or no test address): nothing reached the customer, so don't mark the quotation sent.
  if (!sent.live) return NextResponse.json({ ok: true, live: false, note: 'Email is in test mode — it was not sent to the customer.' });

  await execute(
    'UPDATE quotations SET sent_at = CURRENT_TIMESTAMP, email_template_id = ?, status = CASE WHEN status = \'draft\' THEN \'sent\' ELSE status END WHERE id = ?',
    [b.email_template_id || null, params.id]
  );
  await audit('quotation_emailed', { actor: user.username, detail: `${quotation.quotation_no} -> ${to}` });
  return NextResponse.json({ ok: true, live: true });
}
