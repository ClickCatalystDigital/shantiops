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
//
// Unified delivery/lot-centric receiving, Phase 3c — an optional `splits: [{bom_item_id, qty,
// routed_to}]` array lets one physical delivery credit several SIBLING bom_items (rows sharing this
// item's own pr_item_id — a PR line split across several unrelated normal projects at raise time,
// §5c) in one submission, against the same receipt/lot. Omitting `splits` is today's exact
// single-line behavior, byte-identical — every target below is just `[the primary item]` in that
// case. Traceability (heat/mtc/batch/serial/cert) is genuinely one shared fact for the whole
// delivery, so `b`'s traceability fields apply to every target; qty and the routing confirmation are
// per-target. Eligibility is enforced server-side, not just offered by whatever the UI happens to
// show: every split target must share the primary item's own pr_item_id.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { execute, queryOne, queryAll, withTransaction, nextNumber } from '@/lib/db';
import { getAssemblyRollupMap, getProjectUnitCounts, getPlannedRecipients } from '@/lib/data';
import { itemRollupQty } from '@/lib/bom-structure.mjs';
import { missingTraceabilityFields, applyReceivedSideEffects, creditBomItemReceipt, maybeCreatePieceStock, maybeReserveScalarStock } from '@/lib/bom-receiving';
import { audit } from '@/lib/usb';

// Read-only helper for the dialog's own "remaining outstanding" default and running-total display
// (Phase 3d) — the same required/received-so-far computation POST already does, exposed so the UI
// doesn't have to guess or duplicate it.
export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const item = await queryOne(
    'SELECT id, project_id, assembly_id, qty_text, qty_resolved, requires_manufacturing FROM bom_items WHERE id = ?', [params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const [rollupById, unitCounts, priorReceived, hasChildrenRow, plannedRecipients] = await Promise.all([
    getAssemblyRollupMap(item.project_id),
    getProjectUnitCounts(item.project_id),
    queryOne('SELECT COALESCE(SUM(qty_received), 0) AS total FROM bom_item_receipts WHERE bom_item_id = ?', [item.id]),
    queryOne('SELECT 1 FROM projects WHERE master_project_id = ? LIMIT 1', [item.project_id]),
    getPlannedRecipients(item.id),
  ]);
  const unitCount = unitCounts.get(item.project_id) ?? 1;
  const requiredQty = itemRollupQty(item.qty_text, item.assembly_id, rollupById, unitCount, !!item.qty_resolved) ?? 0;
  const receivedSoFar = Number(priorReceived.total) || 0;
  return NextResponse.json({
    required_qty: requiredQty || null,
    received_so_far: receivedSoFar,
    remaining: requiredQty > 0 ? Math.max(0, requiredQty - receivedSoFar) : null,
    has_children: !!hasChildrenRow,
    requires_manufacturing: !!item.requires_manufacturing,
    planned_recipients: plannedRecipients,
  });
}

// Resolves one target's own requirement (project's rollup map + unit count are cached per project,
// since a multi-recipient submission commonly spans several projects but never many).
async function resolveRequirement(item, cache) {
  if (!cache.has(item.project_id)) {
    const [rollupById, unitCounts] = await Promise.all([
      getAssemblyRollupMap(item.project_id), getProjectUnitCounts(item.project_id),
    ]);
    cache.set(item.project_id, { rollupById, unitCount: unitCounts.get(item.project_id) ?? 1 });
  }
  const { rollupById, unitCount } = cache.get(item.project_id);
  return itemRollupQty(item.qty_text, item.assembly_id, rollupById, unitCount, !!item.qty_resolved) ?? 0;
}

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

  // The shared traceability facts for this one physical delivery — genuinely one heat/batch/cert
  // regardless of how many bom_items it gets split across (§Resolved, plan file).
  const sharedTraceability = {
    received_heat_no: b.received_heat_no ? String(b.received_heat_no).trim() : null,
    received_mtc_no: b.received_mtc_no ? String(b.received_mtc_no).trim() : null,
    received_supplier_batch_no: b.received_supplier_batch_no ? String(b.received_supplier_batch_no).trim() : null,
    received_serial_no: b.received_serial_no ? String(b.received_serial_no).trim() : null,
    // Phase 4 — the real Test Certificate bank record an MTC requirement resolves to, picked/created
    // via CertPicker client-side (which also fills received_mtc_no from the cert's own certificate_no).
    test_certificate_id: b.test_certificate_id ? Number(b.test_certificate_id) : null,
  };

  // splits: [{bom_item_id, qty, routed_to}] — every target other than the primary item. Server-side
  // eligibility, not trusted from the UI's own filtered list: each must be a genuine sibling of the
  // primary (share its pr_item_id), and no id may repeat (itself or across splits).
  const rawSplits = Array.isArray(b.splits) ? b.splits : [];
  const splitIds = [...new Set(rawSplits.map(s => Number(s.bom_item_id)).filter(Boolean))];
  let siblingItems = [];
  if (splitIds.length) {
    if (splitIds.includes(item.id)) {
      return NextResponse.json({ error: "A split target can't be the item being received itself" }, { status: 400 });
    }
    const placeholders = splitIds.map(() => '?').join(',');
    siblingItems = await queryAll(`SELECT * FROM bom_items WHERE id IN (${placeholders})`, splitIds);
    if (siblingItems.length !== splitIds.length) {
      return NextResponse.json({ error: 'One or more split targets were not found' }, { status: 404 });
    }
    const ineligible = siblingItems.find(s => !item.pr_item_id || s.pr_item_id !== item.pr_item_id);
    if (ineligible) {
      return NextResponse.json({ error: `Item #${ineligible.id} does not share this line's purchase request — not an eligible split target` }, { status: 400 });
    }
    const alreadyDone = siblingItems.find(s => s.purchase_status === 'Received' || s.purchase_status === 'Cancelled');
    if (alreadyDone) {
      return NextResponse.json({ error: `Item #${alreadyDone.id} is already ${alreadyDone.purchase_status.toLowerCase()} — it can't be split into` }, { status: 409 });
    }
  }

  // One target per recipient — the primary item plus every validated split. qty for the primary
  // comes from qty_text/parsedQty (unchanged); each split carries its own numeric qty.
  const splitByIdQty = new Map(rawSplits.map(s => [Number(s.bom_item_id), s]));
  const targets = [
    { item, qty: parsedQty, routedTo: b.routed_to || null },
    ...siblingItems.map(s => {
      const raw = splitByIdQty.get(s.id);
      return { item: s, qty: Number(raw?.qty) || 0, routedTo: raw?.routed_to || null };
    }),
  ];
  const badQty = targets.find(t => !(t.qty > 0));
  if (badQty) return NextResponse.json({ error: `Enter a valid quantity for item #${badQty.item.id}` }, { status: 400 });

  // Traceability is required on every receiving event, not just the one that completes the line —
  // each physical delivery genuinely needs its own heat/cert regardless of whether it finishes the
  // requirement (a real compliance concern for IBR material, not just a completion gate). Checked
  // per target's own requires_* flags against the one shared traceability object.
  for (const t of targets) {
    const missing = missingTraceabilityFields(t.item, sharedTraceability);
    if (missing.length) {
      return NextResponse.json(
        { error: `Can't record this receipt — item #${t.item.id} needs ${missing.join(', ')} first` }, { status: 400 });
    }
  }

  // Requirement/received-so-far per target, and — for any target whose own project has no child
  // units (self-routing applies, Phase 2) — a required routing confirmation. A master-project item
  // routes per-child later via allocate/route-to instead, so it's exempt here.
  const rollupCache = new Map();
  const hasChildrenCache = new Map();
  async function projectHasChildren(projectId) {
    if (!hasChildrenCache.has(projectId)) {
      const row = await queryOne('SELECT 1 FROM projects WHERE master_project_id = ? LIMIT 1', [projectId]);
      hasChildrenCache.set(projectId, !!row);
    }
    return hasChildrenCache.get(projectId);
  }
  for (const t of targets) {
    const requiredQty = await resolveRequirement(t.item, rollupCache);
    const priorReceived = await queryOne(
      'SELECT COALESCE(SUM(qty_received), 0) AS total FROM bom_item_receipts WHERE bom_item_id = ?', [t.item.id]);
    t.requiredQty = requiredQty;
    t.totalReceived = (Number(priorReceived.total) || 0) + t.qty;
    t.isFullyReceived = requiredQty <= 0 || t.totalReceived >= requiredQty;
    t.needsRouting = t.isFullyReceived && !(await projectHasChildren(t.item.project_id));
    if (t.needsRouting && !['production', 'dispatch'].includes(t.routedTo)) {
      return NextResponse.json(
        { error: `Item #${t.item.id} needs a routing decision (Manufacturing or Direct to Dispatch) to complete this receipt` }, { status: 400 });
    }
  }

  // Computed before the transaction (nextNumber isn't tx-aware) — same tolerance for a wasted
  // counter value on a rare rollback that every other numbered document in this app already accepts.
  const inwardBatchNo = receiptId ? null : await nextNumber('inward_batch', 'INW');

  // lot_label — unified delivery/lot-centric receiving, Phase 3c. Optional: only meaningful once
  // Procurement has declared more than one lot for the PO line behind this item (Phase 0); omitted
  // (undefined/null) for the ~100% common case, stamped straight through to bom_item_receipts. One
  // physical delivery is one lot, so it applies once to the whole submission, every target alike.
  const lotLabel = b.lot_label ? String(b.lot_label).trim() || null : null;

  let results;
  try {
    results = await withTransaction(async tx => {
      if (!receiptId) {
        const ins = await tx.execute({
          sql: `INSERT INTO stock_receipts (inward_batch_no, supplier_id, po_id, grn_ref, invoice_no, received_by)
                VALUES (?, ?, ?, ?, ?, ?)`,
          args: [inwardBatchNo, Number(receiptInput.supplier_id), receiptInput.po_id ? Number(receiptInput.po_id) : null,
            receiptInput.grn_ref.trim(), receiptInput.invoice_no.trim(), user.username],
        });
        receiptId = Number(ins.lastInsertRowid);
      }
      const out = [];
      for (const t of targets) {
        const targetChanged = { grn_qty_text: t.item.qty_text, ...sharedTraceability };
        // Extracted into creditBomItemReceipt() (lib/bom-receiving.js) so a multi-recipient
        // submission can call it more than once against this same receiptId, inside this same
        // transaction — byte-identical for a plain single-item call, which is what an empty
        // `splits` array still is.
        const credit = await creditBomItemReceipt(tx, t.item, {
          qty: t.qty, isFullyReceived: t.isFullyReceived, totalReceived: t.totalReceived,
          receiptId, lotLabel, changed: targetChanged, username: user.username,
        });
        if (credit.isFullyReceived) targetChanged.grn_qty_text = credit.cumulativeText;
        // The routing write happens inside the same transaction as the receipt it completes — a
        // multi-recipient submission gets one required routing confirmation per recipient, all
        // committed atomically with the receipt itself, never a follow-up call that could fail
        // independently and leave a receipt with no routing decision.
        if (credit.isFullyReceived && t.needsRouting) {
          await tx.execute({
            sql: `INSERT INTO bom_item_child_routing (bom_item_id, child_project_id, routed_to, decided_by)
                  VALUES (?, ?, ?, ?)
                  ON CONFLICT(bom_item_id, child_project_id) DO UPDATE SET
                    routed_to = excluded.routed_to, decided_by = excluded.decided_by, decided_at = CURRENT_TIMESTAMP`,
            args: [t.item.id, t.item.project_id, t.routedTo, user.username],
          });
        }
        out.push({ item: t.item, receiptId, isFullyReceived: credit.isFullyReceived, grnRef: credit.grnRef, targetChanged, totalReceived: t.totalReceived, requiredQty: t.requiredQty, qty: t.qty });
      }
      return out;
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 409 });
  }

  // Stores/Inventory hardening Phase 2 — a real physical delivery, even a partial one, gets real
  // piece-level stock (best-effort, never gates completion of the receipt itself). Deliberately its
  // own loop, not folded into the isFullyReceived-gated one below: unlike applyReceivedSideEffects
  // (QC record, notifications — meaningful only once the line is actually done), the physical
  // material itself exists the moment this delivery lands, whether or not it completes the line.
  for (const r of results) {
    await maybeCreatePieceStock(r.item, r.qty, r.receiptId, r.targetChanged, user.username);
    // Stores/Inventory hardening Phase 3 — the scalar counterpart, same per-target/every-delivery
    // treatment. Each function's own gate (dimensional-vs-scalar, respectively) means at most one
    // of the two ever actually does anything for a given target.
    await maybeReserveScalarStock(r.item, r.qty, user.username);
  }

  for (const r of results) {
    if (!r.isFullyReceived) continue;
    const finalChanged = { ...r.targetChanged, purchase_status: 'Received', grn_ref: r.grnRef, receipt_id: r.receiptId };
    await applyReceivedSideEffects(r.item, finalChanged);
  }

  const receipt = await queryOne('SELECT inward_batch_no FROM stock_receipts WHERE id = ?', [results[0].receiptId]);
  await audit(results.length > 1 ? 'bom_item_receipt_split' : (results[0].isFullyReceived ? 'bom_item_received' : 'bom_item_partial_receipt'), {
    actor: user.username,
    detail: `receipt ${receipt?.inward_batch_no || results[0].receiptId} -> ${results.map(r => `#${r.item.id}: ${r.qty} (${r.totalReceived}${r.requiredQty > 0 ? `/${r.requiredQty}` : ''})`).join(', ')}`,
  });

  const primary = results[0];
  return NextResponse.json({
    ok: true, receipt_id: primary.receiptId, fully_received: primary.isFullyReceived,
    received_this_call: primary.qty, received_so_far: primary.totalReceived, required_qty: primary.requiredQty || null,
    splits: results.slice(1).map(r => ({
      bom_item_id: r.item.id, fully_received: r.isFullyReceived,
      received_this_call: r.qty, received_so_far: r.totalReceived, required_qty: r.requiredQty || null,
    })),
  });
}
