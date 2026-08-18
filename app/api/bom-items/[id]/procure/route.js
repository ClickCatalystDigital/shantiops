// app/api/bom-items/[id]/procure/route.js — STORES-SALES-CHANGES.md Manual-mode gate. Stores'
// other option besides Reserve for a pending_review line: send it to Procurement instead of
// fulfilling from stock. Clears pending_review only — purchase_status is untouched (it was already
// 'Enquiry' from creation), so the line simply becomes visible in getSourcingItems() the moment
// this runs. Deliberately its own route, not a generic PATCH — Stores doesn't own purchase_status
// (BOM_FIELD_OWNERS.Procurement does) and this isn't a purchase_status change anyway.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { notifyDepartment } from '@/lib/notify';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Stores', 'stores.procure');
  if (actionDenied) return actionDenied;

  const item = await queryOne('SELECT id, material_description, pending_review FROM bom_items WHERE id = ?', [params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!item.pending_review) return NextResponse.json({ error: 'Already visible to Procurement' }, { status: 409 });

  await execute('UPDATE bom_items SET pending_review = 0 WHERE id = ?', [params.id]);
  await audit('bom_item_procure', {
    actor: user.username, detail: `bom_item ${item.id} (${item.material_description}) sent to Procurement`,
  });
  // Procurement previously got zero signal when new demand reached their queue through the live
  // purchase-requisitions flow — this is the one deliberate moment worth notifying them about: a
  // human just decided "this genuinely needs sourcing," not the system defaulting it there.
  try {
    await notifyDepartment('Procurement', {
      kind: 'request', title: 'New Enquiry item from Stores', body: item.material_description,
      dedupe_key: `bom_procured:${item.id}`,
    });
  } catch (err) { /* notification is best-effort */ }
  return NextResponse.json({ ok: true });
}
