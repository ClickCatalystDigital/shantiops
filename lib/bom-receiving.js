// lib/bom-receiving.js — the one place "a BOM line became Received" happens (Feature A, canonical
// Stores Receiving). Shared by the new POST /api/bom-items/[id]/receive action and the generic PATCH
// route's PM/admin/executive override, so the side effects (QC's auto-inspection record, the
// procurement milestone sync, the source='stock' on_hand increment, and the Stores/QC notifications)
// can never fire twice or drift between the two entry points. Every guard below reads `item` as the
// row BEFORE the update was applied — callers must fetch it first and only call this after the
// UPDATE has actually landed.
import { execute, queryOne } from './db';
import { syncProcurementMilestones } from './milestone-auto';
import { notifyDepartment } from './notify';
import { checkMaterialsComplete } from './data';

// Traceability presence check, extracted verbatim from the pre-existing PATCH-route logic so both
// entry points enforce the identical rule. `effective` reads the value this same request is setting
// when present, falling back to the row's existing value, so a caller can supply purchase_status and
// the received_* fields together in one call without a false rejection.
export function missingTraceabilityFields(item, changed) {
  const effective = f => (f in changed ? changed[f] : item[f]);
  const missing = [];
  if (item.requires_heat_no && !String(effective('received_heat_no') || '').trim()) missing.push('a heat number');
  if (item.requires_mtc && !String(effective('received_mtc_no') || '').trim()) missing.push('an MTC/certificate number');
  // Phase 4 — the text reference alone is no longer enough; a real Test Certificate bank record
  // must actually be linked. Additive to the check above, not a replacement — both fire together in
  // practice since picking/creating a certificate via CertPicker sets both fields in one call.
  if (item.requires_mtc && !effective('test_certificate_id')) missing.push('a linked test certificate');
  if (item.requires_supplier_batch && !String(effective('received_supplier_batch_no') || '').trim()) missing.push('a supplier batch number');
  if (item.requires_serial_no && !String(effective('received_serial_no') || '').trim()) missing.push('a serial number');
  return missing;
}

// Unified delivery/lot-centric receiving, Phase 3a — the "insert a bom_item_receipts row, then
// (only once the cumulative total meets what's required) CAS-flip purchase_status" transition,
// extracted verbatim from the pre-extraction /receive route so it can be called more than once per
// submission — one physical delivery split across several recipients, inside one withTransaction —
// instead of being inline to a single-item route. The caller computes isFullyReceived/totalReceived
// itself, per target, BEFORE calling this (same timing the original inline code used, preserved
// exactly here rather than adding new CAS discipline to the qty-summing race as a side effect of
// this extraction — out of scope for this phase). `changed` carries the shared traceability values
// for this one physical delivery (heat/mtc/batch/serial/test_certificate_id) — the same object is
// passed for every target in a multi-recipient submission, since one delivery is one heat/batch and
// that's honestly true for every recipient it gets split across (confirmed, not assumed).
export async function creditBomItemReceipt(tx, item, { qty, isFullyReceived, totalReceived, receiptId, lotLabel = null, changed, username }) {
  await tx.execute({
    sql: `INSERT INTO bom_item_receipts
            (bom_item_id, stock_receipts_id, qty_received, received_heat_no, received_mtc_no,
             received_supplier_batch_no, received_serial_no, test_certificate_id, received_by, lot_label)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [item.id, receiptId, qty, changed.received_heat_no, changed.received_mtc_no,
      changed.received_supplier_batch_no, changed.received_serial_no, changed.test_certificate_id, username, lotLabel],
  });

  if (!isFullyReceived) return { isFullyReceived: false };

  // The exact same write the pre-extraction route always did — only reached once the cumulative
  // total actually meets the requirement. grn_qty_text reflects the cumulative total received (not
  // just this call's own amount), formatted with whatever unit suffix the line's own qty_text uses.
  const receiptRow = await tx.execute({ sql: 'SELECT grn_ref FROM stock_receipts WHERE id = ?', args: [receiptId] });
  const grnRef = receiptRow.rows[0]?.grn_ref;
  const unitSuffix = String(item.qty_text || '').replace(/^\s*[\d.]+\s*/, '').trim();
  const cumulativeText = unitSuffix ? `${totalReceived} ${unitSuffix}` : String(totalReceived);
  const upd = await tx.execute({
    sql: `UPDATE bom_items SET purchase_status = 'Received', grn_ref = ?, grn_qty_text = ?, receipt_id = ?,
            received_heat_no = ?, received_mtc_no = ?, received_supplier_batch_no = ?, received_serial_no = ?, test_certificate_id = ?
          WHERE id = ? AND purchase_status NOT IN ('Received', 'Cancelled')`,
    args: [grnRef, cumulativeText, receiptId, changed.received_heat_no, changed.received_mtc_no,
      changed.received_supplier_batch_no, changed.received_serial_no, changed.test_certificate_id, item.id],
  });
  if (Number(upd.rowsAffected) !== 1) throw new Error(`Already received or cancelled: ${item.material_description}`);
  return { isFullyReceived: true, grnRef, cumulativeText };
}

// Fires every side effect of a bom_item's transition into 'Received'. Guarded internally against a
// no-op call (item already Received) so it can never double-count regardless of which of the two
// entry points calls it, or how many times.
export async function applyReceivedSideEffects(item, changed) {
  if (item.purchase_status === 'Received') return;

  if ('purchase_status' in changed) await syncProcurementMilestones(item.project_id);

  // V2-CHANGES.md Group 6 Phase 6.3/6.4 (D7) — a source='stock' item reaching Received increments
  // the inventory line it was raised against. Guarded on the *prior* status (item, fetched before
  // the caller's UPDATE) so a re-save of an already-Received row never double-counts.
  if (item.source === 'stock' && item.inventory_item_id && item.inventory_qty) {
    await execute('UPDATE inventory_items SET on_hand = on_hand + ? WHERE id = ?', [item.inventory_qty, item.inventory_item_id]);
  }

  try {
    let context;
    if (item.source === 'sas') context = `for SO #${item.sale_order_no || '—'}`;
    else if (item.source === 'stock') context = 'into stock';
    else {
      const project = await queryOne('SELECT project_no FROM projects WHERE id = ?', [item.project_id]);
      context = project ? `for ${project.project_no}` : null;
    }
    await notifyDepartment('Stores', {
      kind: 'bom_received', title: `Procured: ${item.material_description}`,
      body: context, dedupe_key: `bom_received:${item.id}`,
    });
  } catch (err) { /* notification is best-effort */ }

  // STERP item 30 (§5p) — Incoming Inspection Against PO: auto-suggests a pending qc_records row
  // against the received item instead of QC having to notice and log it themselves.
  const already = await queryOne(
    "SELECT id FROM qc_records WHERE bom_item_id = ? AND test_type = 'Incoming Inspection'", [item.id]);
  if (!already) {
    await execute(
      `INSERT INTO qc_records (project_id, test_type, reference_no, result, bom_item_id, notes, created_by)
       VALUES (?, 'Incoming Inspection', ?, 'pending', ?, ?, ?)`,
      [item.project_id, item.po_ref || null, item.id, `Auto-suggested on receipt of ${item.material_description}`, 'system']);
  }

  try {
    const proj = await queryOne('SELECT project_no FROM projects WHERE id = ?', [item.project_id]);
    const pno = proj?.project_no || '';
    await notifyDepartment('QC', {
      kind: 'qc_incoming', title: `Materials arriving — ${pno}`,
      body: 'Incoming inspection can start as items are received.',
      dedupe_key: `qc_incoming:${item.project_id}`,
    });
    await checkMaterialsComplete(item.project_id);
  } catch (err) { /* notification is best-effort */ }
}
