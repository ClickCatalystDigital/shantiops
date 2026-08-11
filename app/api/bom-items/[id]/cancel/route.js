// app/api/bom-items/[id]/cancel/route.js — Group 5 Bundle B, Phase 5.4 (D10). Eng/Design cancel a
// BOM item directly — no Procurement accept step, replacing the old tasks.bom_item_id "cancel
// request" mechanism (components/TicketsPanel.jsx's retired `cancel_item` kind,
// accept-cancellations route left in place but dead, same "don't drop" precedent as
// procurement_requests in Bundle A).
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getSessionUser, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { notifyDepartment } from '@/lib/notify';
import { removeItemFromDraftPO, releaseReservationsForItem } from '@/lib/procurement';
import { DEFAULT_PURCHASE_STATUS } from '@/lib/bom-fields.mjs';

const CANCEL_DEPARTMENTS = ['Engineering', 'Design'];
// D10: cancellable at Enquiry/Comparison/Ordered, blocked once Transit (shipped) — distinct from
// OPEN_STATUSES (which still counts Transit as open).
const CANCELLABLE = new Set(['Enquiry', 'Comparison', 'Ordered']);

export async function POST(req, { params }) {
  const user = getSessionUser();
  if (!CANCEL_DEPARTMENTS.some(d => canAccessDepartment(user, d))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const item = await queryOne('SELECT * FROM bom_items WHERE id = ?', [params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const status = item.purchase_status || DEFAULT_PURCHASE_STATUS;
  if (!CANCELLABLE.has(status)) {
    return NextResponse.json({ error: `Can't cancel — already ${status}` }, { status: 400 });
  }

  await execute("UPDATE bom_items SET purchase_status = 'Cancelled' WHERE id = ?", [item.id]);
  // A selected-but-not-issued item may still be sitting on a draft PO — clean that up regardless of
  // stage, same cleanup select-supplier's DELETE (undo) already does.
  await removeItemFromDraftPO(item.id);
  // V2-CHANGES.md Group 6 Phase 6.3 — an active stock reservation against this item must release
  // too, or that stock stays phantom-committed with no request left to issue it against.
  await releaseReservationsForItem(item.id);

  if (status === 'Ordered') {
    // Ordered = a PO was actually issued (Phase 5.1's advancePurchaseStatus) — Procurement needs to
    // void it with the supplier, a real external action this route can't do for them.
    await notifyDepartment('Procurement', {
      kind: 'po_void_needed',
      title: `Void PO — ${item.material_description}`,
      body: item.po_ref ? `${item.po_ref} needs voiding with the supplier (cancelled by ${user.username})`
        : `Cancelled after a PO was issued (${user.username})`,
      dedupe_key: `po-void:${item.id}`,
    });
  }

  await audit('bom_item_cancelled_direct', { actor: user.username, detail: `item ${item.id}: ${status} -> Cancelled` });
  return NextResponse.json({ ok: true });
}
