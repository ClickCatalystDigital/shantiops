import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { editableBomFields, PURCHASE_STATUSES } from '@/lib/bom-fields.mjs';
import { releaseReservationsForItem } from '@/lib/procurement';
import { notifyDepartment } from '@/lib/notify';
import { syncProcurementMilestones } from '@/lib/milestone-auto';

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
  // V2-CHANGES.md D4 (Phase 5.0): purchase_status is now a mixed-case enum (Enquiry/Comparison/
  // Ordered/Transit/Received/Cancelled/In-Stock) — no more blind .toUpperCase(), validate against
  // the known list instead so a bad value 400s here rather than landing as silent junk.
  if (keys.includes('purchase_status') && b.purchase_status && !PURCHASE_STATUSES.includes(b.purchase_status)) {
    return NextResponse.json({ error: `Unknown purchase_status: ${b.purchase_status}` }, { status: 400 });
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
  await execute(
    `UPDATE bom_items SET ${Object.keys(changed).map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(changed), params.id]);

  // Procurement's own inline Status dropdown (BomTable.jsx) is the one path that can set any
  // purchase_status value directly, bypassing advancePurchaseStatus's forward-only ratchet —
  // resync the 5 stage milestones against real BOM state whenever this happens.
  if ('purchase_status' in changed) await syncProcurementMilestones(item.project_id);

  // V2-CHANGES.md Group 6 Phase 6.3/6.4 (D7) — build stock: a source='stock' item reaching
  // Received increments the inventory line it was raised against (inventory_item_id/inventory_qty,
  // set at PR-raise time, Phase 6.4). Guarded on the *prior* status (item, fetched before this
  // UPDATE) so a re-save of an already-Received row never double-counts — same "only fire on the
  // transition" idiom the Stages route's wasDone guard uses (SYSTEM.md §3c).
  if (item.source === 'stock' && item.purchase_status !== 'Received' && changed.purchase_status === 'Received'
      && item.inventory_item_id && item.inventory_qty) {
    await execute('UPDATE inventory_items SET on_hand = on_hand + ? WHERE id = ?', [item.inventory_qty, item.inventory_item_id]);
  }
  // V2-CHANGES.md Group 6 Phase 6.3 gap found post-ship, live-verified: the Status tab's manual
  // override can also set purchase_status='Cancelled', bypassing the dedicated
  // /api/bom-items/[id]/cancel route (Eng/Design only) — which is where the reservation-release
  // call lived. Without this, a manually-cancelled item's active reservation stayed phantom-
  // committed against `available` with no automatic cleanup. Mirrors the dedicated route's own
  // guard: only fires on the transition *into* Cancelled, not a re-save of an already-cancelled row.
  if (item.purchase_status !== 'Cancelled' && changed.purchase_status === 'Cancelled') {
    await releaseReservationsForItem(item.id);
  }
  // STORES-SALES-CHANGES.md — Stores previously had zero signal when something they were waiting
  // on actually got procured; they'd only find out by checking the BOM themselves. Only fires on
  // the transition into Received, same idiom as the Cancelled guard above.
  if (item.purchase_status !== 'Received' && changed.purchase_status === 'Received') {
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
  const deniedResp = requireDepartment(user, 'Engineering');
  if (deniedResp) return deniedResp;
  const actionDenied = await requireAction(user, 'Engineering', 'engineering.bom.delete_item');
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
