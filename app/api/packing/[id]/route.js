import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { syncPackingMilestone } from '@/lib/milestone-auto';
import { postDispatchConsumption } from '@/lib/stock-pieces';

const EDITABLE = ['customer_name', 'customer_address', 'invoice_no', 'invoice_date', 'package_type',
  'dc_no', 'dc_date', 'vehicle_no', 'dispatch_through', 'contact_person', 'status',
  'sales_invoice_id', 'freight_amount', 'freight_paid_by', 'eway_bill_no', 'eway_bill_date',
  'transport_distance_km', 'transport_mode', 'vehicle_type'];
// Same idiom as bom-items PATCH's PURCHASE_STATUSES check / qc-records' pass|fail|pending check.
const PACKING_STATUSES = ['draft', 'packed', 'dispatched'];
const TRANSPORT_MODES = ['road', 'rail', 'air', 'ship'];
const VEHICLE_TYPES = ['regular', 'odc'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const b = await req.json();
  if ('status' in b && !PACKING_STATUSES.includes(b.status)) {
    return NextResponse.json({ error: `Unknown status: ${b.status}` }, { status: 400 });
  }
  if (b.transport_mode && !TRANSPORT_MODES.includes(b.transport_mode)) {
    return NextResponse.json({ error: `Unknown transport_mode: ${b.transport_mode}` }, { status: 400 });
  }
  if (b.vehicle_type && !VEHICLE_TYPES.includes(b.vehicle_type)) {
    return NextResponse.json({ error: `Unknown vehicle_type: ${b.vehicle_type}` }, { status: 400 });
  }
  if ('status' in b) {
    const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.status');
    if (actionDenied) return actionDenied;
  }
  if (Object.keys(b).some(k => k !== 'status')) {
    const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.edit');
    if (actionDenied) return actionDenied;
  }

  const pl = await queryOne(
    `SELECT pl.project_id, pl.dispatched_at, p.company
       FROM packing_lists pl LEFT JOIN projects p ON p.id = pl.project_id
      WHERE pl.id = ?`, [params.id]);
  if (!pl) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Guard against a silent post-posting correction: once the freight expense is actually in the
  // ledger, editing the amount here would never re-post (postJournalEntry dedupes by source
  // document), so the ledger would silently keep the old, now-wrong figure forever. Route the fix
  // through Accounts' existing manual Journal Entry correction flow instead.
  if ('freight_amount' in b) {
    const posted = await queryOne(
      "SELECT 1 FROM journal_entries WHERE source_type = 'dispatch_freight' AND source_id = ?", [params.id]
    );
    if (posted) {
      return NextResponse.json({ error: 'Freight already posted to the ledger — correct it with a manual Journal Entry in Accounts, not by editing this figure.' }, { status: 409 });
    }
  }

  // Inward QC/Production Approval Workflow — the pre-dispatch gate. Additive to every guard above,
  // only checked when this specific request tries to finalize dispatch. Reads the LATEST cycle for
  // this list — a rejected cycle blocks exactly the same as no cycle at all, both requiring a fresh
  // submit-for-approval (POST .../submit-for-approval) before dispatch can proceed.
  if (b.status === 'dispatched') {
    const latest = await queryOne(
      'SELECT status FROM pre_dispatch_approvals WHERE packing_list_id = ? ORDER BY id DESC LIMIT 1', [params.id]);
    if (latest?.status !== 'approved') {
      return NextResponse.json({ error: 'Held for QC/Production final review — submit for approval and get both sign-offs before dispatching.' }, { status: 400 });
    }
  }

  const sets = [];
  const args = [];
  for (const f of EDITABLE) {
    if (f in b) { sets.push(`${f} = ?`); args.push(b[f] === '' ? null : b[f]); }
  }
  // Stamp the actual dispatch moment once, on the first draft/packed -> dispatched transition —
  // updated_at changes on every edit and can't answer "when did this actually ship" (needed for the
  // Dispatch Register report).
  const isFirstDispatch = b.status === 'dispatched' && !pl.dispatched_at;
  if (isFirstDispatch) {
    sets.push('dispatched_at = CURRENT_TIMESTAMP');
  }
  if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  sets.push('updated_at = CURRENT_TIMESTAMP');
  args.push(params.id);
  await execute(`UPDATE packing_lists SET ${sets.join(', ')} WHERE id = ?`, args);
  // Stores/Inventory hardening Phase 5 — close the physical stock-piece lifecycle at the moment a
  // list genuinely first reaches 'dispatched' (same one-shot guard as the dispatched_at stamp
  // above). Without this, a piece-tracked line's own stock_pieces row stayed available/reserved
  // indefinitely after its material physically left the building — silently re-reservable/cuttable
  // for an entirely unrelated purpose, a real "material becomes untraceable" risk. Every
  // non-terminal piece linked to any bom_item on this list is flipped to 'consumed', the same
  // terminal state cutPiece()'s own "used" branch already uses for "this material has left Stores'
  // controllable stock."
  if (isFirstDispatch) {
    const bomItemIds = await queryAll(
      'SELECT DISTINCT bom_item_id FROM packing_items WHERE packing_list_id = ? AND bom_item_id IS NOT NULL',
      [params.id]
    );
    for (const row of bomItemIds) {
      // Final Phase 0-7 audit gap-fix — a whole piece-tracked item shipped without ever being cut
      // (routed straight to Dispatch, §5bi) used to close out here with zero accounting entry.
      // Select the affected pieces (their own unit_cost) BEFORE the status flip, so
      // postDispatchConsumption still has something real to cost after.
      const pieces = await queryAll(
        "SELECT id, code, unit_cost FROM stock_pieces WHERE bom_item_id = ? AND status IN ('available', 'reserved')",
        [row.bom_item_id]
      );
      await execute(
        "UPDATE stock_pieces SET status = 'consumed' WHERE bom_item_id = ? AND status IN ('available', 'reserved')",
        [row.bom_item_id]
      );
      await postDispatchConsumption(pieces, pl.company, user.username);
    }
  }
  // Status is the meaningful transition (Pending → Ready → Dispatched) — worth its own audit action.
  if ('status' in b) {
    await audit('packing_status_change', { actor: user.username, detail: `list ${params.id} -> ${b.status}` });
    if (b.status === 'packed' || b.status === 'dispatched') {
      if (pl.project_id) await syncPackingMilestone(pl.project_id, user.username);
    }
  }
  return NextResponse.json({ ok: true });
}

// Discard a whole draft — the gap the per-line DELETE on /items never covered: removing every item
// one at a time still leaves an empty list behind, never actually removes it. Draft-only, same
// "correct/discard before it's real, never after" boundary as everywhere else in this app (a
// packed/dispatched list is a real committed action, corrected forward, not deleted). Reuses the
// per-item route's own `dispatch.packing.edit` action — same authority level, not a new key.
export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.edit');
  if (actionDenied) return actionDenied;

  const pl = await queryOne('SELECT status, packing_no FROM packing_lists WHERE id = ?', [params.id]);
  if (!pl) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (pl.status !== 'draft') {
    return NextResponse.json({ error: 'Only a draft list can be deleted — a packed/dispatched list is a real record.' }, { status: 409 });
  }
  const posted = await queryOne(
    "SELECT 1 FROM journal_entries WHERE source_type = 'dispatch_freight' AND source_id = ?", [params.id]
  );
  if (posted) {
    return NextResponse.json({ error: 'Freight for this list is already posted to the ledger — reverse it in Accounts first.' }, { status: 409 });
  }
  // Inward QC/Production Approval Workflow — a list can only be re-edited back to 'draft' by a
  // plain status PATCH (no state-machine restriction stops packed/dispatched -> draft), so a list
  // that was once submitted for pre-dispatch review can still reach here. pre_dispatch_approvals'
  // own FK into packing_lists is NO ACTION (real, enforced — Turso does enforce FKs on this
  // connection, confirmed live), so an unguarded delete here would throw a raw SQLITE_CONSTRAINT
  // error AFTER packing_items had already been deleted below, leaving a corrupted item-less list
  // behind. Blocked here instead, same clean-message pattern as the freight guard above it — and
  // the review history is never deletable anyway, matching every other decision-history table in
  // this app.
  const reviewed = await queryOne('SELECT 1 FROM pre_dispatch_approvals WHERE packing_list_id = ?', [params.id]);
  if (reviewed) {
    return NextResponse.json({ error: 'This list has a pre-dispatch review on record and can no longer be deleted.' }, { status: 409 });
  }

  // Turso enforces FKs on this connection — packing_items' ON DELETE CASCADE would fire on its own,
  // but its rows are removed explicitly here anyway for a clean, ordered delete.
  await execute('DELETE FROM packing_items WHERE packing_list_id = ?', [params.id]);
  await execute('DELETE FROM packing_lists WHERE id = ?', [params.id]);
  await audit('packing_deleted', { actor: user.username, detail: `list ${params.id} (${pl.packing_no})` });
  return NextResponse.json({ ok: true });
}
