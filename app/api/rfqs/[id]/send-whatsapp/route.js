// Send an RFQ to one supplier on WhatsApp from the company number (primary); { sent: false, reason }
// tells the dialog to open the wa.me click-send instead (backup).
// Template "rfq_request" body values, in order: supplier name, RFQ number, the supplier's private link.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getRfqDetail } from '@/lib/data';
import { sendBusiness, WA_TEMPLATES } from '@/lib/whatsapp';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement') || await requireAction(user, 'Procurement', 'procurement.rfq.record');
  if (denied) return denied;
  const b = await req.json();
  const rfq = await getRfqDetail(params.id);
  if (!rfq) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (rfq.status === 'closed') return NextResponse.json({ error: 'This RFQ is cancelled' }, { status: 400 });
  const rs = rfq.suppliers.find(s => s.supplier_id === Number(b.supplier_id));
  if (!rs) return NextResponse.json({ error: 'Supplier is not on this RFQ' }, { status: 404 });
  const link = String(b.link || '');
  const text = String(b.text || '').trim();
  if (!text || !link.includes(`/rfq/${rs.token}`)) return NextResponse.json({ error: 'Message and supplier link are required' }, { status: 400 });

  const r = await sendBusiness({
    company: rfq.company, phone: rs.phone, contactName: rs.supplier_name, text,
    templateName: WA_TEMPLATES.rfq, params: [rs.supplier_name, rfq.rfq_no, link], user,
  });
  if (!r.sent) return NextResponse.json(r);
  await execute('UPDATE rfq_suppliers SET sent_at = CURRENT_TIMESTAMP WHERE id = ?', [rs.id]);
  await execute("UPDATE rfqs SET status = 'sent' WHERE id = ? AND status = 'draft'", [params.id]);
  await audit('rfq_whatsapp', { actor: user.username, detail: `${rfq.rfq_no} -> ${rs.phone}` });
  return NextResponse.json(r);
}
