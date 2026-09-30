// Stores withdraws a request it (or Sales, for a trade order) raised as a stand-alone line — Build Stock
// ('stock') or Trade Order ('sas'). Project BOM lines belong to Engineering (they cancel or delete them);
// Stores can only ask. Allowed only while nothing has been ordered or received against the line.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { notifyDepartment } from '@/lib/notify';
import { removeItemFromDraftPO, releaseReservationsForItem, maybeCloseRfqsForItem } from '@/lib/procurement';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Stores', 'stores.procure');
  if (actionDenied) return actionDenied;

  const item = await queryOne('SELECT * FROM bom_items WHERE id = ?', [params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!['stock', 'sas'].includes(item.source)) {
    return NextResponse.json({ error: 'A project BOM line belongs to Engineering — ask them to cancel it' }, { status: 400 });
  }
  const status = item.purchase_status || 'Enquiry';
  if (!['Enquiry', 'Comparison'].includes(status)) return NextResponse.json({ error: `Can't withdraw — already ${status}` }, { status: 409 });
  const used = await queryOne(
    `SELECT (SELECT COUNT(*) FROM po_items WHERE bom_item_id = ?) + (SELECT COUNT(*) FROM bom_item_receipts WHERE bom_item_id = ?) AS n`,
    [item.id, item.id]);
  if (Number(used?.n) > 0) return NextResponse.json({ error: 'A purchase order or receipt already exists for this line' }, { status: 409 });

  await execute("UPDATE bom_items SET purchase_status = 'Cancelled' WHERE id = ?", [item.id]);
  await removeItemFromDraftPO(item.id);
  await releaseReservationsForItem(item.id);
  await maybeCloseRfqsForItem(item.id);
  await audit('bom_item_withdrawn', { actor: user.username, detail: `${item.source} line ${item.id} (${item.material_description}) withdrawn by Stores` });
  if (item.source === 'sas') {
    try {
      await notifyDepartment('Sales', { kind: 'request', title: 'Trade order withdrawn by Stores', body: item.material_description, dedupe_key: `sas_withdrawn:${item.id}` });
    } catch { /* best-effort */ }
  }
  return NextResponse.json({ ok: true });
}
