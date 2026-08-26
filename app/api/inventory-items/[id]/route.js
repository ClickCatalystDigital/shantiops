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

const FIELDS = ['description', 'spec', 'on_hand', 'location', 'reorder_point', 'item_code', 'item_id', 'category', 'moc'];
const NUMERIC = new Set(['on_hand', 'reorder_point', 'item_id']);
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
