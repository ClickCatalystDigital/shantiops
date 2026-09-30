// Take back "Procure": the line returns to Stores Review (pending_review=1) and disappears from
// Procurement's Enquiry. Only while Procurement has done nothing with it — no PR, quote, RFQ or PO.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Stores', 'stores.procure');
  if (actionDenied) return actionDenied;

  const item = await queryOne('SELECT id, material_description, source, pr_item_id, pending_review, purchase_status FROM bom_items WHERE id = ?', [params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (item.source !== 'bom') return NextResponse.json({ error: 'Only a project BOM line can be taken back' }, { status: 400 });
  if (item.pending_review) return NextResponse.json({ error: 'Already waiting for Stores review' }, { status: 409 });
  if (item.pr_item_id) return NextResponse.json({ error: 'A Purchase Requisition exists for this line — it can no longer be taken back' }, { status: 409 });
  if ((item.purchase_status || 'Enquiry') !== 'Enquiry') return NextResponse.json({ error: `Procurement already moved it to ${item.purchase_status}` }, { status: 409 });
  const used = await queryOne(
    `SELECT (SELECT COUNT(*) FROM supplier_quotes WHERE bom_item_id = ?) + (SELECT COUNT(*) FROM rfq_items WHERE bom_item_id = ?)
          + (SELECT COUNT(*) FROM po_items WHERE bom_item_id = ?) AS n`, [item.id, item.id, item.id]);
  if (Number(used?.n) > 0) return NextResponse.json({ error: 'Procurement has already started on this line (quote, RFQ or PO)' }, { status: 409 });

  await execute('UPDATE bom_items SET pending_review = 1 WHERE id = ?', [item.id]);
  await audit('bom_item_unprocure', { actor: user.username, detail: `bom_item ${item.id} (${item.material_description}) taken back from Procurement` });
  return NextResponse.json({ ok: true });
}
