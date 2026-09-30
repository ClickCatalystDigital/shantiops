// app/api/inventory-items/[id]/route.js — V2-CHANGES.md Group 6 Phase 6.2. Mirrors
// app/api/suppliers/[id]/route.js's plain-field-PATCH shape. on_hand is directly editable here
// (a manual stock-take correction) — Phase 6.3's reserve/issue/release routes are the normal
// path for it moving through the reserve→issue workflow, this is Stores' own override.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { setTrackingMode } from '@/lib/tracking-mode';

const FIELDS = ['description', 'spec', 'on_hand', 'location', 'reorder_point', 'item_code', 'item_id', 'category', 'moc', 'category_fields_json', 'avg_cost'];
const NUMERIC = new Set(['on_hand', 'reorder_point', 'item_id', 'avg_cost']);
const TRACKING_MODES = new Set(['scalar', 'piece', 'batch', 'serial']);

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Stores', 'stores.inventory.write');
  if (actionDenied) return actionDenied;

  const item = await queryOne('SELECT * FROM inventory_items WHERE id = ?', [params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  // tracking_mode (I1-I3) goes through its own guarded path, never the plain field loop below: a
  // switch is only ever safe while the line has zero tracked child rows anywhere (stock_pieces/
  // inventory_batches/inventory_serials) — setTrackingMode() enforces that, a bare UPDATE would not.
  if ('tracking_mode' in b) {
    if (!TRACKING_MODES.has(b.tracking_mode)) {
      return NextResponse.json({ error: `Unknown tracking_mode: ${b.tracking_mode}` }, { status: 400 });
    }
    try {
      await setTrackingMode(Number(params.id), b.tracking_mode);
    } catch (e) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
  }

  const sets = [];
  const args = [];
  for (const f of FIELDS) {
    if (f in b) {
      sets.push(`${f} = ?`);
      args.push(NUMERIC.has(f) ? (b[f] === '' || b[f] == null ? null : Number(b[f])) : (b[f] || null));
    }
  }
  if (sets.length) {
    args.push(params.id);
    await execute(`UPDATE inventory_items SET ${sets.join(', ')} WHERE id = ?`, args);
  } else if (!('tracking_mode' in b)) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }
  await audit('inventory_item_edit', { actor: user.username, detail: `item ${params.id}: ${Object.keys(b).join(',')}` });
  return NextResponse.json({ ok: true });
}

// Delete an inventory item — only when nothing depends on it. An item that was ever received,
// reserved, issued, returned or allocated keeps its history, so it is refused with the reason; a
// mistaken or unused item (no movement, stock 0) can be removed. Same permission as editing.
const REFERENCING = [
  ['bom_items', 'inventory_item_id', 'BOM lines'], ['inventory_reservations', 'inventory_item_id', 'reservations'],
  ['stock_pieces', 'inventory_item_id', 'stock pieces'], ['inventory_batches', 'inventory_item_id', 'batches'],
  ['inventory_serials', 'inventory_item_id', 'serial units'], ['material_indent_items', 'inventory_item_id', 'indents'],
  ['inward_approvals', 'inventory_item_id', 'inward reviews'], ['sales_returns', 'inventory_item_id', 'sales returns'],
  ['purchase_returns', 'inventory_item_id', 'purchase returns'], ['tc_item_match_approvals', 'inventory_item_id', 'certificate matches'],
];

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Stores', 'stores.inventory.write');
  if (actionDenied) return actionDenied;

  const item = await queryOne('SELECT id, description, on_hand FROM inventory_items WHERE id = ?', [params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (Number(item.on_hand) !== 0) {
    return NextResponse.json({ error: `Stock on hand is ${item.on_hand} — set it to 0 (or issue it) before deleting.` }, { status: 409 });
  }
  for (const [table, col, label] of REFERENCING) {
    const r = await queryOne(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`, [item.id]);
    if (Number(r?.n) > 0) {
      return NextResponse.json({ error: `Can't delete — it is used by ${r.n} ${label}. Keep it for the history.` }, { status: 409 });
    }
  }
  // Its stock history goes with it (nothing else points at those rows).
  await execute('DELETE FROM stock_movements WHERE inventory_item_id = ?', [item.id]);
  await execute('DELETE FROM inventory_items WHERE id = ?', [item.id]);
  await audit('inventory_item_deleted', { actor: user.username, detail: item.description });
  return NextResponse.json({ ok: true });
}
