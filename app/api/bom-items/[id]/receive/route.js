// app/api/bom-items/[id]/receive/route.js — the canonical Stores Receiving action (Feature A). The
// only path a Stores user has to move a bom_item into 'Received' — a PM/admin/executive override
// still exists on the generic PATCH route (app/api/bom-items/[id]/route.js), but a Procurement head
// has no path to 'Received' at all after this. The receipt this action creates/links (supplier +
// GRN + invoice, all required — this is the official inward-receipt event, not a speculative
// stocking guess) is what makes the identification tag real instead of duplicated free text.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { execute, queryOne, withTransaction, nextNumber } from '@/lib/db';
import { missingTraceabilityFields, applyReceivedSideEffects } from '@/lib/bom-receiving';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Stores', 'stores.bom.receive');
  if (actionDenied) return actionDenied;

  const item = await queryOne('SELECT * FROM bom_items WHERE id = ?', [params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (item.purchase_status === 'Received') {
    return NextResponse.json({ error: 'Already received' }, { status: 409 });
  }
  // A cancelled line was already cascaded (reservations released, open indent items cancelled) —
  // reviving it into Received here would resurrect a line the business considers dead, with none of
  // that cleanup reversed. Only PM/admin can un-cancel (by editing purchase_status directly first).
  if (item.purchase_status === 'Cancelled') {
    return NextResponse.json({ error: 'This line is cancelled — it cannot be received' }, { status: 409 });
  }

  const b = await req.json();
  const qtyText = String(b.qty_text || '').trim();
  if (!qtyText) return NextResponse.json({ error: 'Enter the quantity received' }, { status: 400 });

  const receiptInput = b.receipt || {};
  let receiptId = receiptInput.existing_receipt_id ? Number(receiptInput.existing_receipt_id) : null;
  if (receiptId) {
    // Re-validated even for an existing receipt (gap found in review): the picker's "existing
    // receipt" dropdown lists every stock_receipts row, including old ones created through the
    // pre-existing speculative piece-receiving path (no invoice, sometimes no supplier) — picking
    // one of those must not silently satisfy the official flow's own requirements.
    const existing = await queryOne('SELECT id, supplier_id, grn_ref, invoice_no FROM stock_receipts WHERE id = ?', [receiptId]);
    if (!existing) return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
    if (!existing.supplier_id || !existing.grn_ref || !existing.invoice_no) {
      return NextResponse.json({ error: 'That receipt is missing a supplier, GRN number, or invoice number — create a new receipt instead' }, { status: 400 });
    }
  } else {
    // The official receiving flow — unlike the pre-existing speculative piece-receiving path — always
    // requires a real supplier, GRN number, and invoice number. No "receive speculatively" option
    // here; that's what stock_receipts.invoice_no staying nullable at the DB level is for.
    if (!receiptInput.supplier_id) return NextResponse.json({ error: 'Supplier is required' }, { status: 400 });
    if (!String(receiptInput.grn_ref || '').trim()) return NextResponse.json({ error: 'GRN number is required' }, { status: 400 });
    if (!String(receiptInput.invoice_no || '').trim()) return NextResponse.json({ error: 'Invoice number is required' }, { status: 400 });
  }

  const changed = {
    grn_qty_text: qtyText,
    received_heat_no: b.received_heat_no ? String(b.received_heat_no).trim() : null,
    received_mtc_no: b.received_mtc_no ? String(b.received_mtc_no).trim() : null,
    received_supplier_batch_no: b.received_supplier_batch_no ? String(b.received_supplier_batch_no).trim() : null,
    received_serial_no: b.received_serial_no ? String(b.received_serial_no).trim() : null,
  };
  const missing = missingTraceabilityFields(item, changed);
  if (missing.length) {
    return NextResponse.json(
      { error: `Can't mark Received — this line needs ${missing.join(', ')} first` }, { status: 400 });
  }

  // Computed before the transaction (nextNumber isn't tx-aware) — same tolerance for a wasted
  // counter value on a rare rollback that every other numbered document in this app already accepts.
  const inwardBatchNo = receiptId ? null : await nextNumber('inward_batch', 'INW');

  let grnRef;
  let result;
  try {
    result = await withTransaction(async tx => {
      if (!receiptId) {
        const ins = await tx.execute({
          sql: `INSERT INTO stock_receipts (inward_batch_no, supplier_id, po_id, grn_ref, invoice_no, received_by)
                VALUES (?, ?, ?, ?, ?, ?)`,
          args: [inwardBatchNo, Number(receiptInput.supplier_id), receiptInput.po_id ? Number(receiptInput.po_id) : null,
            receiptInput.grn_ref.trim(), receiptInput.invoice_no.trim(), user.username],
        });
        receiptId = Number(ins.lastInsertRowid);
      }
      const receiptRow = await tx.execute({ sql: 'SELECT grn_ref FROM stock_receipts WHERE id = ?', args: [receiptId] });
      grnRef = receiptRow.rows[0]?.grn_ref;

      // The guard that prevents double-counting (and a concurrent cancel racing a receive): this
      // only affects a row that's still open, so neither a duplicate receive nor a receive-after-
      // cancel can slip through, even if the pre-checks above raced with a concurrent request.
      const upd = await tx.execute({
        sql: `UPDATE bom_items SET purchase_status = 'Received', grn_ref = ?, grn_qty_text = ?, receipt_id = ?,
                received_heat_no = ?, received_mtc_no = ?, received_supplier_batch_no = ?, received_serial_no = ?
              WHERE id = ? AND purchase_status NOT IN ('Received', 'Cancelled')`,
        args: [grnRef, changed.grn_qty_text, receiptId, changed.received_heat_no, changed.received_mtc_no,
          changed.received_supplier_batch_no, changed.received_serial_no, params.id],
      });
      if (Number(upd.rowsAffected) !== 1) throw new Error('Already received or cancelled');
      return { receiptId };
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 409 });
  }

  changed.purchase_status = 'Received';
  changed.grn_ref = grnRef;
  changed.receipt_id = result.receiptId;
  await applyReceivedSideEffects(item, changed);

  const receipt = await queryOne('SELECT inward_batch_no FROM stock_receipts WHERE id = ?', [result.receiptId]);
  await audit('bom_item_received', {
    actor: user.username,
    detail: `bom_item #${item.id} via receipt ${receipt?.inward_batch_no || result.receiptId}`,
  });
  return NextResponse.json({ ok: true, receipt_id: result.receiptId });
}
