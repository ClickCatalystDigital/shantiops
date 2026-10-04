// One printout for a whole shipment: a cover page (shipment id, customer, address, vehicle, the lists)
// followed by each packing list's own PDF.
import { NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { getPackingDetail, getShipments } from '@/lib/data';
import { renderPackingPdf } from '@/lib/packing-pdf';
import { modelCodeOf } from '@/lib/packing-forms.mjs';

export const runtime = 'nodejs';

export async function GET(_req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const sh = (await getShipments()).find(s => String(s.id) === String(params.id));
  if (!sh) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });

  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const cover = out.addPage([595, 842]);
  let y = 790;
  const line = (text, o = {}) => { cover.drawText(String(text ?? ''), { x: 50, y, size: o.size || 11, font: o.bold ? bold : font, color: rgb(0.1, 0.1, 0.1) }); y -= (o.gap || 18); };
  line(`SHIPMENT ${sh.shipment_no}`, { size: 20, bold: true, gap: 32 });
  line(`Customer: ${sh.customer_name || '-'}`);
  line(`Address: ${(sh.customer_address || '-').replace(/\s+/g, ' ').slice(0, 90)}`);
  line(`Vehicle: ${sh.vehicle_no || '-'}     Dispatch through: ${sh.dispatch_through || '-'}`, { gap: 30 });
  line('Packing lists in this shipment', { bold: true, gap: 22 });
  for (const l of sh.lists) line(`${l.packing_no}    ${l.project_no || 'no project'}    ${l.item_count} line${l.item_count === 1 ? '' : 's'}    ${l.status}`);
  if (sh.note) { y -= 12; line(`Note: ${sh.note}`); }

  for (const l of sh.lists) {
    const data = await getPackingDetail(l.id);
    if (!data) continue;
    if (data.list.layout === 'combined' && data.list.project_id) {
      const p = await queryOne('SELECT * FROM projects WHERE id = ?', [data.list.project_id]);
      const m = p?.master_project_id ? await queryOne('SELECT * FROM projects WHERE id = ?', [p.master_project_id]) : null;
      if (p) data.list.model_code = modelCodeOf(p, m);
    }
    const bytes = await renderPackingPdf(data.list, data.items, { checklist: data.checklist, only: null });
    const src = await PDFDocument.load(bytes);
    (await out.copyPages(src, src.getPageIndices())).forEach(pg => out.addPage(pg));
  }
  const pdf = await out.save();
  return new NextResponse(Buffer.from(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${sh.shipment_no}.pdf"` } });
}
