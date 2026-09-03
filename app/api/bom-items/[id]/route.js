import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll } from '@/lib/db';
import { getFreshSessionUser, isPM } from '@/lib/auth';
import { requireAction, requireEngineeringAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { editableBomFields, PURCHASE_STATUSES } from '@/lib/bom-fields.mjs';
import { releaseReservationsForItem } from '@/lib/procurement';
import { syncProcurementMilestones } from '@/lib/milestone-auto';
import { checkMaterialsComplete } from '@/lib/data';
import { missingTraceabilityFields, applyReceivedSideEffects } from '@/lib/bom-receiving';
import { releasePiece } from '@/lib/stock-pieces';
import { rollupIndentStatus } from '@/lib/indent-status.mjs';

// Field-level department scoping — the trust boundary of the PMB module. A head may only write
// the columns their department owns (BOM_FIELD_OWNERS); a PM writes anything. Enforced here, not
// in the UI, so a forged request from devtools gets a 403 naming the offending keys.
export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const allowed = editableBomFields(user);
  if (!allowed.length) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const item = await queryOne('SELECT * FROM bom_items WHERE id = ?', [params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const keys = Object.keys(b);
  if (!keys.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  const denied = keys.filter(k => !allowed.includes(k));
  if (denied.length) {
    return NextResponse.json(
      { error: `Not editable by your department: ${denied.join(', ')}` }, { status: 403 });
  }
  if (keys.includes('material_description') && !String(b.material_description || '').trim()) {
    return NextResponse.json({ error: 'Description cannot be empty' }, { status: 400 });
  }
  // Traceability flags (I9) — frozen once the project's BOM has actually been released, changeable
  // only via the existing un-release path (POST /api/milestones/[id]/reopen), same governance as
  // every other release-baseline field. Deliberately checked against the milestone's LIVE status,
  // not bom_items.released_at_revision: that column is stamped on every line at Release BOM and
  // never cleared by a reopen (reopen only resets the milestone row), so checking it directly would
  // leave a line frozen forever even after a legitimate un-release — reopening would have no visible
  // effect on this specific field.
  // requires_manufacturing (Feature C) joins this same frozen-at-release group — it's exactly as
  // much a release-baseline decision as the other four (a line shouldn't flip from "needs
  // Production" to "Stores can pack it" after release without reopening).
  const TRACEABILITY_FIELDS = ['requires_heat_no', 'requires_mtc', 'requires_supplier_batch', 'requires_serial_no', 'requires_manufacturing'];
  if (keys.some(k => TRACEABILITY_FIELDS.includes(k))) {
    const milestone = await queryOne(
      `SELECT actual_end, status FROM milestones WHERE project_id = ? AND milestone_key = 'release_bom'`,
      [item.project_id]
    );
    const released = !!(milestone?.actual_end || milestone?.status === 'done');
    if (released) {
      return NextResponse.json(
        { error: 'Traceability requirements are frozen — reopen Release BOM to change them' }, { status: 409 });
    }
  }
  // V2-CHANGES.md D4 (Phase 5.0): purchase_status is now a mixed-case enum (Enquiry/Comparison/
  // Ordered/Transit/Received/Cancelled/In-Stock) — no more blind .toUpperCase(), validate against
  // the known list instead so a bad value 400s here rather than landing as silent junk.
  if (keys.includes('purchase_status') && b.purchase_status && !PURCHASE_STATUSES.includes(b.purchase_status)) {
    return NextResponse.json({ error: `Unknown purchase_status: ${b.purchase_status}` }, { status: 400 });
  }
  // Canonical Stores Receiving (Feature A) — Received is Stores' own action now
  // (POST /api/bom-items/[id]/receive). A Procurement head has no path to it here at all; PM/admin/
  // executive keep the same emergency-override capability they already have over every other field.
  // In-Stock is blocked here too (gap found in review) — it's the other terminal "material is
  // actually in hand" state Feature C's getProjectBom() now treats as equally packing-ready, and the
  // ONLY two legitimate ways to reach it (lib/procurement.js's issueReservation(), cutPiece()'s
  // completion check) both write purchase_status directly via their own raw SQL, never through this
  // route — so blocking the manual override here closes a real bypass of every Feature A requirement
  // (receipt, traceability) without touching either legitimate path.
  if (keys.includes('purchase_status') && ['Received', 'In-Stock'].includes(b.purchase_status) && !isPM(user)) {
    return NextResponse.json({ error: 'This status can only be reached through Receive or Issue, not a manual override' }, { status: 403 });
  }
  // Procurement's own inline Status dropdown is the one path that can set purchase_status directly
  // (see the resync comment below) — that's the "manually change purchase status" action from the
  // Responsibility model, distinct from every other field this route also handles.
  if (keys.includes('purchase_status')) {
    const actionDenied = await requireAction(user, 'Procurement', 'procurement.status.manual_edit');
    if (actionDenied) return actionDenied;
  }

  const changed = {};
  for (const k of keys) {
    let v = typeof b[k] === 'string' ? b[k].trim() : b[k];
    if (v === '') v = null;
    changed[k] = v;
  }

  // Traceability enforcement on the free-text GRN path (gap found in review, 2026-08-26) — the
  // ONLY point in this route that fires: the transition INTO 'Received', never a re-save of an
  // already-Received row. Shared with the canonical /receive action (lib/bom-receiving.js) so both
  // entry points enforce the identical rule. Reachable here only via the PM/admin/executive override
  // now — Received itself is otherwise 403'd above before this line is ever reached.
  if (changed.purchase_status === 'Received' && item.purchase_status !== 'Received') {
    const missing = missingTraceabilityFields(item, changed);
    if (missing.length) {
      return NextResponse.json(
        { error: `Can't mark Received — this line needs ${missing.join(', ')} first` }, { status: 400 });
    }
  }

  await execute(
    `UPDATE bom_items SET ${Object.keys(changed).map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(changed), params.id]);

  // V2-CHANGES.md Group 6 Phase 6.3 gap found post-ship, live-verified: the Status tab's manual
  // override can also set purchase_status='Cancelled', bypassing the dedicated
  // /api/bom-items/[id]/cancel route (Eng/Design only) — which is where the reservation-release
  // call lived. Without this, a manually-cancelled item's active reservation stayed phantom-
  // committed against `available` with no automatic cleanup. Mirrors the dedicated route's own
  // guard: only fires on the transition *into* Cancelled, not a re-save of an already-cancelled row.
  if (item.purchase_status !== 'Cancelled' && changed.purchase_status === 'Cancelled') {
    await releaseReservationsForItem(item.id);
    // Material Indent cascade (Feature B) — a 'released' indent item is deliberately excluded: if
    // the material was already handed over (possibly already cut), a later BOM cancellation cannot
    // un-happen that. Only open/partially_released items against this line get cancelled.
    const openIndentItems = await queryAll(
      "SELECT id, indent_id, stock_piece_id FROM material_indent_items WHERE bom_item_id = ? AND status NOT IN ('released', 'cancelled')",
      [item.id]);
    const touchedIndentIds = new Set();
    for (const ii of openIndentItems) {
      if (ii.stock_piece_id) await releasePiece(ii.stock_piece_id);
      await execute("UPDATE material_indent_items SET status = 'cancelled' WHERE id = ?", [ii.id]);
      touchedIndentIds.add(ii.indent_id);
    }
    for (const indentId of touchedIndentIds) {
      const statuses = (await queryAll(
        'SELECT status FROM material_indent_items WHERE indent_id = ?', [indentId])).map(r => r.status);
      await execute('UPDATE material_indents SET status = ? WHERE id = ?', [rollupIndentStatus(statuses), indentId]);
    }
  }

  // Canonical Stores Receiving (Feature A) — the Received transition's full side-effect chain
  // (milestone sync, the source='stock' on_hand increment, Stores/QC notifications, QC's
  // auto-inspection record) lives in one shared function so this PM/admin override path and the
  // dedicated /receive route can never fire it twice or drift. Every OTHER purchase_status change
  // (Enquiry/Comparison/Ordered/Transit/Cancelled) still needs the plain milestone resync that used
  // to run unconditionally here — applyReceivedSideEffects already does its own resync internally,
  // so this branch only covers the non-Received case to avoid syncing twice.
  if (item.purchase_status !== 'Received' && changed.purchase_status === 'Received') {
    await applyReceivedSideEffects(item, changed);
  } else if ('purchase_status' in changed) {
    await syncProcurementMilestones(item.project_id);
  }
  // Stores' side of the same handoff — a line Stores has physically logged a GRN against counts as
  // done for this rollup even if Procurement's purchase_status hasn't (or won't) move, so a project
  // Stores finishes receiving can also reach Production/QC without waiting on Procurement. Only
  // fires on the transition into having a grn_ref, same idiom as the Received guards above.
  if (!item.grn_ref && changed.grn_ref) {
    try { await checkMaterialsComplete(item.project_id); } catch (err) { /* notification is best-effort */ }
  }

  await audit('bom_item_edit', {
    actor: user.username,
    detail: JSON.stringify({ bom_item_id: Number(params.id), project_id: item.project_id, changed }),
  });
  return NextResponse.json({ ok: true });
}

// Deleting a BOM row is an Engineering call (it un-defines a material). Rows already carried onto
// a packing list are protected — deleting them would orphan the reconciliation history.
export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const actionDenied = await requireEngineeringAction(user, 'engineering.bom.delete_item');
  if (actionDenied) return actionDenied;

  const item = await queryOne('SELECT * FROM bom_items WHERE id = ?', [params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const packed = await queryOne(
    'SELECT COUNT(*) AS n FROM packing_items WHERE bom_item_id = ?', [params.id]);
  if (packed.n > 0) {
    return NextResponse.json(
      { error: 'This item is on a packing list — remove it there first' }, { status: 409 });
  }
  // V2-CHANGES.md Group 6 Phase 6.3 gap found post-ship, live-verified: inventory_reservations.
  // bom_item_id has no ON DELETE clause and Turso enforces FKs (unlike the local-sqlite fallback,
  // SYSTEM.md §7's tickets note) — deleting a reserved item without this guard 500s on a raw FK
  // constraint violation instead of a clean, actionable error. Checked against *any* reservation
  // row, not just active ones: released/issued rows are kept as history (same append-only
  // precedent as supplier_quotes) and still reference bom_item_id, so they'd hit the exact same FK
  // failure — confirmed live (releasing an active reservation first still left the delete 500ing on
  // the now-released row). Same block-not-cascade precedent as the packing_items check above.
  const reserved = await queryOne(
    'SELECT COUNT(*) AS n FROM inventory_reservations WHERE bom_item_id = ?', [params.id]);
  if (reserved.n > 0) {
    return NextResponse.json(
      { error: 'This item has a stock reservation on record — it can\'t be deleted (history is kept)' }, { status: 409 });
  }
  // Same class of gap as inventory_reservations above, for material_indent_items.bom_item_id
  // (Feature B, no ON DELETE clause) — found in review, before this ever hit a real FK 500 live.
  const indented = await queryOne(
    'SELECT COUNT(*) AS n FROM material_indent_items WHERE bom_item_id = ?', [params.id]);
  if (indented.n > 0) {
    return NextResponse.json(
      { error: 'This item has a material indent on record — it can\'t be deleted (history is kept)' }, { status: 409 });
  }

  await execute('DELETE FROM bom_items WHERE id = ?', [params.id]);
  await audit('bom_item_delete', {
    actor: user.username,
    detail: JSON.stringify({
      bom_item_id: Number(params.id), project_id: item.project_id,
      description: item.material_description,
    }),
  });
  return NextResponse.json({ ok: true });
}
