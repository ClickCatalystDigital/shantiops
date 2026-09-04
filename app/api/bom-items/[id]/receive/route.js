// app/api/bom-items/[id]/receive/route.js — the canonical Stores Receiving action (Feature A). The
// only path a Stores user has to move a bom_item into 'Received' — a PM/admin/executive override
// still exists on the generic PATCH route (app/api/bom-items/[id]/route.js), but a Procurement head
// has no path to 'Received' at all after this. The receipt this action creates/links (supplier +
// GRN + invoice, all required — this is the official inward-receipt event, not a speculative
// stocking guess) is what makes the identification tag real instead of duplicated free text.
//
// Multi-unit split, Phase 4 (MULTI-UNIT-SPLIT-DESIGN.md §5.2) — this route now supports genuine
// PARTIAL receiving: every call inserts a row into the bom_item_receipts ledger; purchase_status
// only flips to 'Received' once the cumulative qty_received across every ledger row for this line
// meets its required quantity (itemRollupQty(), already unit_count-aware — correct for both a plain
// single-unit project and a multi-unit master). This closes a real, confirmed bug: before this
// change, ANY quantity typed here — even far less than required — immediately flipped the line to
// 'Received'. Audited against all 29 files touching purchase_status before this change (see
// MULTI-UNIT-SPLIT-DESIGN.md's implementation notes) — the two real transition-side-effect sites are
// this route and lib/bom-receiving.js's applyReceivedSideEffects, both still fired exactly once, only
// on the call that actually completes the line, never on a partial one. The common case — receiving
// the full required quantity in one call, which is what the dialog's own qty field pre-fills to and
// therefore ~100% of real usage today — is fully received on the FIRST call, so bom_items gets the
// exact same UPDATE it always has, byte-for-byte, with zero behavior change.
//
// checkMaterialsComplete() (lib/data.js) independently treats a line as "closed" the moment
// bom_items.grn_ref is non-null, regardless of purchase_status — so bom_items (grn_ref, grn_qty_text,
// receipt_id, traceability fields) is deliberately left completely untouched on a partial call. Only
// the ledger (bom_item_receipts) is written until the line is genuinely, fully received.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { execute, queryOne, withTransaction, nextNumber } from '@/lib/db';
import { getAssemblyRollupMap, getProjectUnitCounts } from '@/lib/data';
import { itemRollupQty } from '@/lib/bom-structure.mjs';
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
  const parsedQty = parseFloat((qtyText.match(/^\s*([\d.]+)/) || [])[1]);
  if (!(parsedQty > 0)) {
    return NextResponse.json({ error: 'Enter a valid numeric quantity received' }, { status: 400 });
  }

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
  // Traceability is required on every receiving event, not just the one that completes the line —
  // each physical delivery genuinely needs its own heat/cert regardless of whether it finishes the
  // requirement (a real compliance concern for IBR material, not just a completion gate).
  const missing = missingTraceabilityFields(item, changed);
  if (missing.length) {
    return NextResponse.json(
      { error: `Can't record this receipt — this line needs ${missing.join(', ')} first` }, { status: 400 });
  }

  // How much does this line actually require, and how much has already been received against it?
  // itemRollupQty is already unit_count-aware — for a plain single-unit project this is just the
  // leading number in qty_text (identical to what the pre-existing behavior implicitly assumed).
  const [rollupById, unitCounts, priorReceived] = await Promise.all([
    getAssemblyRollupMap(item.project_id),
    getProjectUnitCounts(item.project_id),
    queryOne('SELECT COALESCE(SUM(qty_received), 0) AS total FROM bom_item_receipts WHERE bom_item_id = ?', [item.id]),
  ]);
  const unitCount = unitCounts.get(item.project_id) ?? 1;
  const requiredQty = itemRollupQty(item.qty_text, item.assembly_id, rollupById, unitCount, !!item.qty_resolved) ?? 0;
  const totalReceived = (Number(priorReceived.total) || 0) + parsedQty;
  // requiredQty <= 0 (qty_text didn't parse to a number at all) falls back to today's exact
  // behavior — any positive quantity received completes the line, since there's no honest number to
  // compare against.
  const isFullyReceived = requiredQty <= 0 || totalReceived >= requiredQty;

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

      // Always logged, full or partial — this is the real receipt-events ledger, the source of
      // truth for "how much has actually arrived so far." Each event keeps its own traceability
      // values (a second partial delivery can carry a different heat/cert than the first).
      await tx.execute({
        sql: `INSERT INTO bom_item_receipts
                (bom_item_id, stock_receipts_id, qty_received, received_heat_no, received_mtc_no,
                 received_supplier_batch_no, received_serial_no, received_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [item.id, receiptId, parsedQty, changed.received_heat_no, changed.received_mtc_no,
          changed.received_supplier_batch_no, changed.received_serial_no, user.username],
      });

      if (!isFullyReceived) return { receiptId, isFullyReceived };

      // The exact same write as before this change — only reached once the cumulative total
      // actually meets the requirement. grn_qty_text reflects the cumulative total received (not
      // just this call's own amount), formatted with whatever unit suffix the line's own qty_text
      // uses, so a multi-delivery line still shows one coherent "how much arrived" figure.
      const unitSuffix = String(item.qty_text || '').replace(/^\s*[\d.]+\s*/, '').trim();
      const cumulativeText = unitSuffix ? `${totalReceived} ${unitSuffix}` : String(totalReceived);
      const upd = await tx.execute({
        sql: `UPDATE bom_items SET purchase_status = 'Received', grn_ref = ?, grn_qty_text = ?, receipt_id = ?,
                received_heat_no = ?, received_mtc_no = ?, received_supplier_batch_no = ?, received_serial_no = ?
              WHERE id = ? AND purchase_status NOT IN ('Received', 'Cancelled')`,
        args: [grnRef, cumulativeText, receiptId, changed.received_heat_no, changed.received_mtc_no,
          changed.received_supplier_batch_no, changed.received_serial_no, params.id],
      });
      if (Number(upd.rowsAffected) !== 1) throw new Error('Already received or cancelled');
      changed.grn_qty_text = cumulativeText;
      return { receiptId, isFullyReceived };
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 409 });
  }

  if (result.isFullyReceived) {
    changed.purchase_status = 'Received';
    changed.grn_ref = grnRef;
    changed.receipt_id = result.receiptId;
    await applyReceivedSideEffects(item, changed);
  }

  const receipt = await queryOne('SELECT inward_batch_no FROM stock_receipts WHERE id = ?', [result.receiptId]);
  await audit(result.isFullyReceived ? 'bom_item_received' : 'bom_item_partial_receipt', {
    actor: user.username,
    detail: `bom_item #${item.id} via receipt ${receipt?.inward_batch_no || result.receiptId} — ${parsedQty} received (${totalReceived}${requiredQty > 0 ? `/${requiredQty}` : ''})`,
  });
  return NextResponse.json({
    ok: true, receipt_id: result.receiptId, fully_received: result.isFullyReceived,
    received_this_call: parsedQty, received_so_far: totalReceived, required_qty: requiredQty || null,
  });
}
