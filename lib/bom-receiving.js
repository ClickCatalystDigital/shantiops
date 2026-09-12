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
import { DIMENSIONAL_CATEGORIES } from './bom-fields.mjs';
import { parseDims } from './remnant-match';
import { categoryWeightKg } from './section-shapes.js';
import { receivePiece, reservePiece } from './stock-pieces';
import { reserveFromStock } from './procurement';

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

// Stores/Inventory hardening Phase 2 — for a qualifying dimensional, catalog-linked PMB/PR line,
// create real piece-level stock (stock_pieces) at the moment of physical receipt, owned by the
// receiving project. Called by the route AFTER the core receiving transaction commits, once per
// target, regardless of whether that target's own line is fully received yet — a partial delivery
// is still real physical material and should still produce real, cuttable pieces. Best-effort, same
// established pattern as applyReceivedSideEffects right below it (and the same reasoning: keep the
// core transaction short, side effects run after) — a failure here never blocks or rolls back the
// real receipt, which is already durably recorded in bom_item_receipts regardless.
//
// Scope: category must be dimensional AND item_id must be resolved (catalog-linked). An
// uncatalogued free-text dimensional line has no way to find-or-create a matching inventory_items
// row — stock_pieces.inventory_item_id is a hard NOT NULL FK, not a choice to make — so it's left
// exactly as it was before this phase: bom_items/purchase_status only, no piece. Forward-only: a
// historical Received row from before this phase exists gets no retroactive piece, same posture as
// every other can't-backfill precedent already established in this codebase.
// Verified against real data before writing this (not assumed): bom_items.qty_text is free text
// with a real, genuinely mixed unit vocabulary across dimensional categories — "2 Nos", "6 Mtrs",
// "80 kg", "1 SET" all appear on real rows. Only a genuine count-of-discrete-units suffix means "N
// physical pieces, each with this line's own dimensions" — "Mtrs"/"kg"/"SET" do not, and guessing
// wrong here would fabricate a combined or fractional piece. No count-unit match = skip piece
// creation entirely for this receipt, same "don't guess" boundary parseDims() itself already
// enforces one line below.
const COUNT_UNIT_SUFFIXES = new Set(['nos', 'no', 'no.', 'pcs', 'pc', 'ea', 'each', 'unit', 'units']);
function isCountUnit(qtyText) {
  const suffix = String(qtyText || '').replace(/^\s*[\d.]+\s*/, '').trim().toLowerCase();
  return COUNT_UNIT_SUFFIXES.has(suffix);
}

export async function maybeCreatePieceStock(item, qty, receiptId, changed, username) {
  if (!DIMENSIONAL_CATEGORIES.includes(item.category) || !item.item_id) return;
  if (!isCountUnit(item.qty_text)) return;
  const dims = parseDims(item);
  if (!dims) return; // same best-effort boundary lib/remnant-match.js already applies

  let fields;
  try { fields = JSON.parse(item.category_fields_json); } catch { return; }

  // Find-or-create the backing inventory_items row — the same (item_id) join key the Vendor Bill
  // costing pipeline already trusts (app/api/vendor-bills/[id]/route.js), now enforced unique by
  // this same phase's migration. Once this link exists, the already-working Vendor Bill ->
  // weightedAverageCost() pipeline costs this material automatically — no new accounting code.
  const invRow = await queryOne('SELECT id FROM inventory_items WHERE item_id = ?', [item.item_id]);
  let inventoryItemId = invRow?.id;
  if (!inventoryItemId) {
    const { lastId } = await execute(
      `INSERT INTO inventory_items (description, moc, category, spec, track_pieces, item_id)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [item.material_description, item.moc, item.category, dims.kind === 'linear' ? dims.profile : null, item.item_id]
    );
    inventoryItemId = Number(lastId);
  }

  // isCountUnit() above already confirmed qty_text's own suffix means "N discrete units" — qty
  // itself is that count, each unit carrying the line's own per-unit dimensions from
  // category_fields_json (matches how a plate line's "2 Nos" already means two physical plates).
  const unitCount = Math.max(1, Math.round(qty));
  for (let i = 0; i < unitCount; i++) {
    try {
      const piece = await receivePiece({
        inventoryItemId,
        kind: dims.kind,
        length_mm: dims.length_mm,
        width_mm: dims.kind === 'plate' ? dims.width_mm : undefined,
        thickness_mm: dims.kind === 'plate' ? dims.thickness_mm : undefined,
        density: dims.kind === 'plate' ? fields.density : undefined,
        kg_per_m: dims.kind === 'linear' ? categoryWeightKg(item.category, { ...fields, length: 1000 }) : undefined,
        heat_no: changed?.received_heat_no,
        test_certificate_id: changed?.test_certificate_id,
        receiptId,
        ownerProjectId: item.project_id,
        username,
      });
      // Stores/Inventory hardening Phase 5 — link the freshly-created piece back to the very
      // bom_item it was received for. Without this, receivePiece() never sets bom_item_id at all
      // (a piece can legitimately be received speculatively, with no demand yet) — a Phase-2 piece
      // sat as an anonymous-to-that-bom_item 'available' row, invisible to Production's own
      // visibility clause (`EXISTS (... bom_item_id = b.id AND status='reserved')`) and never
      // reachable by Cut except through a separate manual Stores action. allowClosedStatus: true —
      // see reservePiece()'s own comment for why this specific, narrow exception is safe.
      await reservePiece({ pieceId: piece.id, projectId: item.project_id, bomItemId: item.id, allowClosedStatus: true });
    } catch (err) { /* best-effort — a receipt already durably recorded never rolls back for this */ }
  }
}

// Stores/Inventory hardening Phase 3 — the scalar/pool counterpart to Phase 2's
// maybeCreatePieceStock, closing the identical ownership-leak class for non-dimensional PMB/PR
// material: bulk material bought specifically for one project (bolts, gaskets) must not land in the
// same anonymous common on_hand bucket any other project's auto-match/manual-reserve can freely
// draw from. Deliberately narrow scope, per explicit instruction — `source='bom'` (a real project
// demand line, never `'stock'`/`'sas'`, which are already common-pool by design) + a resolvable
// `item_id` (catalog-linked — no fabricated identity for free-text lines) + the line's own real
// project (implicit: `source='bom'` lines are never against the sentinel system project, unlike
// `'stock'`/`'sas'`). Explicitly NOT extended to every scalar item universally.
//
// Mechanism, deliberately reusing existing entities rather than a new "owned pool" row: dimensional
// ownership (Phase 2) can tag an individual physical piece because a piece has its own row and can
// sit idle-but-owned. Scalar stock has no such per-unit identity — crediting a second inventory_items
// row for the same item_id would collide with Phase 2's own item_id UNIQUE index and duplicate the
// catalog entity. Instead: credit the one common inventory_items row (find-or-create, same join key
// Vendor Bill costing already trusts), then IMMEDIATELY reserve exactly that quantity against the
// very bom_item it was received for, via the existing reserveFromStock()/inventory_reservations
// mechanism (now TOCTOU-safe, this same phase). "Ownership" for scalar stock is therefore expressed
// as an active reservation, not a persistent tag — behaviorally equivalent (the material is
// unavailable to any other project's auto-match the instant it exists) and reuses 100% existing
// machinery: no new column, no new table, no redundant entity.
export async function maybeReserveScalarStock(item, qty, username) {
  if (DIMENSIONAL_CATEGORIES.includes(item.category)) return; // Phase 2's territory
  if (item.source !== 'bom' || !item.item_id) return;

  const invRow = await queryOne('SELECT id FROM inventory_items WHERE item_id = ?', [item.item_id]);
  let inventoryItemId = invRow?.id;
  if (!inventoryItemId) {
    const { lastId } = await execute(
      'INSERT INTO inventory_items (description, moc, item_id) VALUES (?, ?, ?)',
      [item.material_description, item.moc, item.item_id]
    );
    inventoryItemId = Number(lastId);
  }

  // Best-effort, same established pattern as maybeCreatePieceStock right below it — a receipt
  // already durably recorded in bom_item_receipts never rolls back for this. The on_hand credit and
  // the reservation are two statements, not one transaction: reserveFromStock's own TOCTOU fix
  // (this phase) re-checks availability fresh at reserve time, so a lost race here just means the
  // reservation covers less than qty (or throws "nothing available"), never an overcommit — the
  // small window matches the same tolerance every other receiving side effect in this file accepts.
  try {
    await execute('UPDATE inventory_items SET on_hand = on_hand + ? WHERE id = ?', [qty, inventoryItemId]);
    await reserveFromStock({ inventoryItemId, bomItemId: item.id, qty, username });
  } catch (err) { /* best-effort — a receipt already durably recorded never rolls back for this */ }
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
