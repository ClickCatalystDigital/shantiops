// Issue or cancel a draft PO. Both actions keep the plain BOM table and ProcurementQueue.jsx (the
// project-page glance) working unchanged: issuing stamps the PO number into each line's existing
// po_ref column (which they already read), cancelling clears it — neither knows a structured PO
// exists, they just see the free-text ref appear or disappear.
import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne } from '@/lib/db';
import { getSessionUser, requireDepartment } from '@/lib/auth';
import { getPurchaseOrderDetail } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function GET(req, { params }) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;
  const detail = await getPurchaseOrderDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(req, { params }) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;

  const po = await queryOne('SELECT * FROM purchase_orders WHERE id = ?', [params.id]);
  if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();

  if (b.action === 'issue') {
    if (po.status !== 'draft') return NextResponse.json({ error: 'Only a draft PO can be issued' }, { status: 400 });
    await execute("UPDATE purchase_orders SET status = 'issued', issued_at = CURRENT_TIMESTAMP WHERE id = ?", [po.id]);
    const items = await queryAll('SELECT bom_item_id FROM po_items WHERE po_id = ?', [po.id]);
    for (const it of items) {
      if (it.bom_item_id) await execute('UPDATE bom_items SET po_ref = ? WHERE id = ?', [po.po_no, it.bom_item_id]);
    }
    await audit('po_issued', { actor: user.username, detail: po.po_no });
    return NextResponse.json({ ok: true });
  }

  if (b.action === 'cancel') {
    if (po.status === 'cancelled') return NextResponse.json({ error: 'Already cancelled' }, { status: 400 });
    await execute(
      "UPDATE purchase_orders SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, cancel_reason = ? WHERE id = ?",
      [b.reason || null, po.id]
    );
    // Items keep their selected_quote_id (they go back to "to order", not all the way back to "to
    // source") — only the po_ref stamp clears, so ProcurementQueue stops counting them as placed.
    const items = await queryAll('SELECT bom_item_id FROM po_items WHERE po_id = ?', [po.id]);
    for (const it of items) {
      if (it.bom_item_id) await execute('UPDATE bom_items SET po_ref = NULL WHERE id = ?', [it.bom_item_id]);
    }
    await audit('po_cancelled', { actor: user.username, detail: `${po.po_no}: ${b.reason || ''}` });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
