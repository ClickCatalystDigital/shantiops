// app/api/quotations/[id]/send-email/route.js — Phase 3.2's "Send Email" action. Draft
// composing/template switching/PDF preview all work with zero blockers; this route is the one
// place that hits the standing lib/mail.js seam (throws a clean "not configured" error until
// MAIL_PROVIDER/MAIL_FROM are set — the exact same accepted seam the Customer Portal invite
// already uses). No mailto: fallback — it can't attach the generated PDF, a strictly worse
// substitute.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { requireCrmAction } from '@/lib/action-permissions';
import { sendMail } from '@/lib/mail';
import { audit } from '@/lib/usb';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return isPM(user) || CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
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
  const b = await req.json();
  const subject = String(b.subject || '').trim();
  const body = String(b.body || '').trim();
  if (!subject || !body) return NextResponse.json({ error: 'Subject and body are required' }, { status: 400 });
  const to = b.to || quotation.customer_email;
  if (!to) return NextResponse.json({ error: 'No customer email on file' }, { status: 400 });

  await sendMail({ to, subject, text: body });

  await execute(
    'UPDATE quotations SET sent_at = CURRENT_TIMESTAMP, email_template_id = ?, status = CASE WHEN status = \'draft\' THEN \'sent\' ELSE status END WHERE id = ?',
    [b.email_template_id || null, params.id]
  );
  await audit('quotation_emailed', { actor: user.username, detail: `${quotation.quotation_no} -> ${to}` });
  return NextResponse.json({ ok: true });
}
