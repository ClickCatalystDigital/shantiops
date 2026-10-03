// Send a quotation on WhatsApp from the company number (primary). When that is not possible —
// not connected, template "quotation_offer" not approved, Meta refused — it answers { sent: false,
// reason } and the screen opens the wa.me click-send instead (backup).
// Template body values, in order: customer name, quotation number, total (Rs). Optional PDF header.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { requireCrmAction } from '@/lib/action-permissions';
import { hiddenSalesRecord } from '@/lib/sales-visibility';
import { getQuotationDetail } from '@/lib/data';
import { renderQuotationPdf } from '@/lib/quotation-pdf';
import { sendBusiness, WA_TEMPLATES } from '@/lib/whatsapp';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const hidden = await hiddenSalesRecord(user, 'quotation', params.id);
  if (hidden) return hidden;
  if (!(isPM(user) || ['Sales', 'Marketing'].some(d => canAccessDepartment(user, d)))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const denied = await requireCrmAction(user, 'sales.quotation.status');
  if (denied) return denied;

  const q = await queryOne('SELECT q.*, c.name AS customer_name, c.phone AS customer_phone FROM quotations q JOIN customers c ON c.id = q.customer_id WHERE q.id = ?', [params.id]);
  if (!q) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (q.approval_status === 'pending') return NextResponse.json({ error: "This quotation's discount needs a Sales Head's approval before it can be sent" }, { status: 409 });
  const b = await req.json().catch(() => ({}));
  const total = `Rs ${Math.round(Number(q.total) || 0).toLocaleString('en-IN')}`;
  const detail = await getQuotationDetail(params.id);
  const pdf = await renderQuotationPdf(detail, detail.items);
  const r = await sendBusiness({
    company: q.company, phone: String(q.customer_phone || '').split(/[,/;]/)[0], contactName: q.customer_name, customerId: q.customer_id,
    text: String(b.text || `Our quotation ${q.quotation_no} for ${total} is attached.`), pdf, filename: `${q.quotation_no.replace(/\//g, '-')}.pdf`,
    templateName: WA_TEMPLATES.quotation, params: [q.customer_name, q.quotation_no, total], user,
  });
  if (!r.sent) return NextResponse.json(r);
  await execute("UPDATE quotations SET sent_at = CURRENT_TIMESTAMP, status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END WHERE id = ?", [params.id]);
  await audit('quotation_whatsapp', { actor: user.username, detail: `${q.quotation_no} -> ${q.customer_phone}` });
  return NextResponse.json(r);
}
