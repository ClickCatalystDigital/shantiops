import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll, withTransaction } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { COMPANY_NAMES } from '@/lib/company-profiles';
import { issueReservation } from '@/lib/procurement';
import { syncPackingMilestone } from '@/lib/milestone-auto';
import { postDispatchConsumption } from '@/lib/stock-pieces';
import { notifyUser, notifyDepartmentHeads } from '@/lib/notify';
import { dissolveSmallShipments } from '@/lib/shipments';
import { cleanTrackingUrl } from '@/lib/carrier.mjs';
import { tabLink } from '@/lib/alert-links.mjs';

const EDITABLE = ['customer_name', 'customer_address', 'invoice_no', 'invoice_date', 'package_type',
  'dc_no', 'dc_date', 'vehicle_no', 'dispatch_through', 'contact_person', 'status',
  'sales_invoice_id', 'freight_amount', 'freight_paid_by', 'eway_bill_no', 'eway_bill_date',
  'transport_distance_km', 'transport_mode', 'vehicle_type', 'company', 'master_section',
  'carrier_doc_no', 'carrier_doc_date', 'container_no', 'tracking_url', 'expected_delivery_date'];
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
  if (b.company && !COMPANY_NAMES.includes(b.company)) {
    return NextResponse.json({ error: `Unknown company: ${b.company}` }, { status: 400 });
  }
  if (b.vehicle_type && !VEHICLE_TYPES.includes(b.vehicle_type)) {
    return NextResponse.json({ error: `Unknown vehicle_type: ${b.vehicle_type}` }, { status: 400 });
  }
  if ('tracking_url' in b) {
    const t = cleanTrackingUrl(b.tracking_url);
    if (t.error) return NextResponse.json({ error: t.error }, { status: 400 });
    b.tracking_url = t.value;
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
    `SELECT pl.project_id, pl.dispatched_at, COALESCE(pl.company, p.company) AS company
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
      'SELECT DISTINCT bom_item_id FROM packing_bom_links WHERE packing_list_id = ? AND bom_item_id IS NOT NULL',
      [params.id]
    );
    for (const row of bomItemIds) {
      // Stock reserved for this line stays in Stores until it actually leaves the gate — issue it now
      // (on_hand drops, the line becomes In-Stock). Best-effort per reservation: a failure must not
      // block the dispatch itself, it just leaves the reservation visible under Allocator.
      const reserved = await queryAll(
        "SELECT id FROM inventory_reservations WHERE bom_item_id = ? AND status = 'active' AND qty > qty_issued", [row.bom_item_id]);
      for (const r of reserved) {
        try { await issueReservation(r.id, { username: user.username }); } catch { /* left for Stores to issue by hand */ }
      }
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
    // Order management (SYSTEM.md §5dr): the first dispatch marks the Sale Order Dispatched on the Order Tracker
    // (never downgrading a Closed/Cancelled one) and tells the sales owner. Best effort — the dispatch itself is already saved.
    if (isFirstDispatch && pl.project_id) {
      try {
        const so = await queryOne(
          `SELECT so.id, so.so_no, so.customer_name, so.track_status, so.status, COALESCE(so.sales_person_override, so.created_by) AS owner
             FROM sale_orders so JOIN projects p ON p.sale_order_id = so.id WHERE p.id = ?`, [pl.project_id]);
        if (so && so.status !== 'cancelled') {
          if (!['Closed', 'Dispatched'].includes(so.track_status)) await execute("UPDATE sale_orders SET track_status = 'Dispatched', stage_dispatched = 1 WHERE id = ?", [so.id]);
          const note = { kind: 'order_dispatched', title: `Order ${so.so_no} dispatched${so.customer_name ? ` — ${so.customer_name}` : ''}`, body: `Packing list ${pl.packing_no || params.id} was dispatched.`, link: tabLink('/sales', 'sale_orders', { highlight: `SO-${so.id}` }), dedupe_key: `dispatch:${params.id}` };
          const owner = so.owner ? await queryOne('SELECT id FROM users WHERE active = 1 AND username = ?', [so.owner]) : null;
          if (owner) await notifyUser(owner.id, note); else await notifyDepartmentHeads('Sales', note);
        }
      } catch (err) { console.error('order dispatch update', err); }
    }
  }
  return NextResponse.json({ ok: true });
}

// Delete a list that hasn't shipped (draft or ready/packed). A dispatched list is a real, committed
// record (stock consumed, order marked dispatched) and stays locked. Its lines go back to Pending
// automatically — Pending is just "BOM lines not on any list". Reuses the per-item route's own
// `dispatch.packing.edit` action: same authority level, not a new key.
export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.edit');
  if (actionDenied) return actionDenied;

  const pl = await queryOne('SELECT status, packing_no, project_id, eway_bill_no FROM packing_lists WHERE id = ?', [params.id]);
  if (!pl) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!['draft', 'packed'].includes(pl.status)) {
    return NextResponse.json({ error: 'A dispatched list is a real record and can no longer be deleted.' }, { status: 409 });
  }
  const posted = await queryOne(
    "SELECT 1 FROM journal_entries WHERE source_type = 'dispatch_freight' AND source_id = ?", [params.id]
  );
  if (posted) {
    return NextResponse.json({ error: 'Freight for this list is already posted to the ledger — reverse it in Accounts first.' }, { status: 409 });
  }
  if (pl.eway_bill_no) {
    return NextResponse.json({ error: 'An e-way bill exists for this list — cancel it first.' }, { status: 409 });
  }

  // Any pre-dispatch review rows (Turso enforces the FK) go with the list; resubmission_of_id points
  // at an earlier row of the same list, so it is cleared before the rows are removed.
  await withTransaction(async tx => {
    await tx.execute({ sql: 'UPDATE pre_dispatch_approvals SET resubmission_of_id = NULL WHERE packing_list_id = ?', args: [params.id] });
    await tx.execute({ sql: 'DELETE FROM pre_dispatch_approvals WHERE packing_list_id = ?', args: [params.id] });
    await tx.execute({ sql: 'DELETE FROM packing_items WHERE packing_list_id = ?', args: [params.id] });
    await tx.execute({ sql: 'DELETE FROM packing_lists WHERE id = ?', args: [params.id] });
  });
  try { await dissolveSmallShipments(); } catch { /* housekeeping only */ }
  await audit('packing_deleted', { actor: user.username, detail: `list ${params.id} (${pl.packing_no}) · was ${pl.status}` });
  return NextResponse.json({ ok: true });
}
