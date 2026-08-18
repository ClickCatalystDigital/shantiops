// app/api/purchase-orders/[id]/route.js

// Issue or cancel a draft PO. Both actions keep the plain BOM table and ProcurementQueue.jsx (the
// project-page glance) working unchanged: issuing stamps the PO number into each line's existing
// po_ref column (which they already read), cancelling clears it — neither knows a structured PO
// exists, they just see the free-text ref appear or disappear.
import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getPurchaseOrderDetail } from '@/lib/data';
import { audit } from '@/lib/usb';
import { advancePurchaseStatus, selectQuoteForItem } from '@/lib/procurement';

// change_supplier is still a draft-only line edit, same real-world action as edit_item — both are
// "edit PO lines" from the Responsibility model's point of view (lib/action-permissions.js).
const PO_ACTION_KEYS = {
  issue: 'procurement.po.issue',
  unissue: 'procurement.po.unissue',
  cancel: 'procurement.po.cancel',
  edit_item: 'procurement.po.edit_lines',
  change_supplier: 'procurement.po.edit_lines',
};

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;
  const detail = await getPurchaseOrderDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;

  const po = await queryOne('SELECT * FROM purchase_orders WHERE id = ?', [params.id]);
  if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const actionKey = PO_ACTION_KEYS[b.action];
  if (actionKey) {
    const actionDenied = await requireAction(user, 'Procurement', actionKey);
    if (actionDenied) return actionDenied;
  }

  if (b.action === 'issue') {
    if (po.status !== 'draft') return NextResponse.json({ error: 'Only a draft PO can be issued' }, { status: 400 });
    await execute("UPDATE purchase_orders SET status = 'issued', issued_at = CURRENT_TIMESTAMP WHERE id = ?", [po.id]);
    const items = await queryAll('SELECT bom_item_id FROM po_items WHERE po_id = ?', [po.id]);
    for (const it of items) {
      // V2-CHANGES.md Phase 5.1 (correcting the earlier Phase 4 behavior, which jumped straight to
      // Transit here): D5's decision is that PO-issued *is* Ordered — Transit is a later,
      // real-world "shipment confirmed dispatched" moment, reached only via the existing manual
      // Status-tab override, not automatically at issue time. advancePurchaseStatus is forward-only,
      // so an item a head already manually pushed further (e.g. straight to Transit) is left alone.
      if (it.bom_item_id) {
        await execute('UPDATE bom_items SET po_ref = ? WHERE id = ?', [po.po_no, it.bom_item_id]);
        await advancePurchaseStatus(it.bom_item_id, 'Ordered');
      }
    }
    await audit('po_issued', { actor: user.username, detail: po.po_no });
    return NextResponse.json({ ok: true });
  }

  if (b.action === 'unissue') {
    // "Cancel Issue" (§4.3) — undoes the issue, not the PO: back to draft, re-issuable, items
    // revert Ordered -> Comparison (Phase 5.1: symmetric with issue now setting Ordered, not
    // Transit — the PO/po_ref still exists, just not sent). Distinct from the permanent `cancel`
    // below, which the PO tab keeps as a separate action for actually killing a PO.
    if (po.status !== 'issued') return NextResponse.json({ error: 'Only an issued PO can be un-issued' }, { status: 400 });
    await execute("UPDATE purchase_orders SET status = 'draft', issued_at = NULL WHERE id = ?", [po.id]);
    const items = await queryAll('SELECT bom_item_id FROM po_items WHERE po_id = ?', [po.id]);
    for (const it of items) {
      if (it.bom_item_id) {
        await execute(
          "UPDATE bom_items SET purchase_status = 'Comparison' WHERE id = ? AND purchase_status = 'Ordered'",
          [it.bom_item_id]
        );
      }
    }
    await audit('po_unissued', { actor: user.username, detail: po.po_no });
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

  // Group 5 Bundle A (5.3, D11) — draft-only editing. An issued PO is a real document already with
  // the supplier; to change it, Cancel Issue back to draft first (existing `unissue` above), edit,
  // re-issue. Both actions below refuse anything but a draft PO.
  if (b.action === 'edit_item') {
    if (po.status !== 'draft') return NextResponse.json({ error: 'Only a draft PO can be edited' }, { status: 400 });
    const line = await queryOne('SELECT * FROM po_items WHERE id = ? AND po_id = ?', [b.po_item_id, po.id]);
    if (!line) return NextResponse.json({ error: 'Line not found on this PO' }, { status: 404 });
    const qty = Number(b.qty);
    const rate = Number(b.rate);
    if (!(qty > 0) || !(rate > 0)) return NextResponse.json({ error: 'Qty and rate must be positive' }, { status: 400 });
    const amount = Math.round(qty * rate * 100) / 100;
    await execute('UPDATE po_items SET qty = ?, rate = ?, amount = ? WHERE id = ?', [qty, rate, amount, line.id]);
    // D11: propagates to the bom_items line so Enquiry/Selection/Status stay in sync — the
    // supplier_quotes log itself stays untouched (append-only, unchanged precedent).
    if (line.bom_item_id) {
      const qtyText = line.uom ? `${qty} ${line.uom}` : String(qty);
      await execute('UPDATE bom_items SET qty_text = ? WHERE id = ?', [qtyText, line.bom_item_id]);
    }
    await audit('po_item_edited', { actor: user.username, detail: `${po.po_no}: line ${line.id} -> qty ${qty} @ ${rate}` });
    return NextResponse.json({ ok: true });
  }

  if (b.action === 'change_supplier') {
    if (po.status !== 'draft') return NextResponse.json({ error: 'Only a draft PO can be edited' }, { status: 400 });
    const line = await queryOne('SELECT * FROM po_items WHERE id = ? AND po_id = ?', [b.po_item_id, po.id]);
    if (!line || !line.bom_item_id) return NextResponse.json({ error: 'Line not found on this PO' }, { status: 404 });

    let quoteId = b.quote_id;
    if (!quoteId && b.new_quote) {
      const nq = b.new_quote;
      if (!(Number(nq.unit_price) > 0)) return NextResponse.json({ error: 'Enter a price' }, { status: 400 });
      let supplierId = nq.supplier_id;
      if (!supplierId && nq.new_supplier_name) {
        const { lastId } = await execute('INSERT INTO suppliers (name) VALUES (?)', [nq.new_supplier_name.trim()]);
        supplierId = Number(lastId);
      }
      if (!supplierId) return NextResponse.json({ error: 'Pick or name a supplier' }, { status: 400 });
      const { lastId } = await execute(
        `INSERT INTO supplier_quotes (supplier_id, bom_item_id, project_id, unit_price, uom, payment_terms, quote_source, quoted_by)
         VALUES (?, ?, ?, ?, ?, ?, 'po_edit', ?)`,
        [supplierId, line.bom_item_id, line.project_id, Number(nq.unit_price), nq.uom || null, nq.payment_terms || null, user.username]
      );
      quoteId = Number(lastId);
    }
    if (!quoteId) return NextResponse.json({ error: 'Pick an existing quote or add a new one' }, { status: 400 });

    let result;
    try {
      result = await selectQuoteForItem(line.bom_item_id, quoteId);
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    await audit('po_supplier_changed', { actor: user.username, detail: `${po.po_no}: item ${line.bom_item_id} -> quote ${quoteId}` });
    return NextResponse.json({ ok: true, po_id: result.poId });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
