// app/api/inventory-items/[id]/route.js — V2-CHANGES.md Group 6 Phase 6.2. Mirrors
// app/api/suppliers/[id]/route.js's plain-field-PATCH shape. on_hand is directly editable here
// (a manual stock-take correction) — Phase 6.3's reserve/issue/release routes are the normal
// path for it moving through the reserve→issue workflow, this is Stores' own override.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getSessionUser, requireDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

const FIELDS = ['description', 'spec', 'on_hand', 'location', 'reorder_point', 'item_code'];
const NUMERIC = new Set(['on_hand', 'reorder_point']);

export async function PATCH(req, { params }) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;

  const item = await queryOne('SELECT * FROM inventory_items WHERE id = ?', [params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const sets = [];
  const args = [];
  for (const f of FIELDS) {
    if (f in b) {
      sets.push(`${f} = ?`);
      args.push(NUMERIC.has(f) ? (b[f] === '' || b[f] == null ? null : Number(b[f])) : (b[f] || null));
    }
  }
  if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  args.push(params.id);

  await execute(`UPDATE inventory_items SET ${sets.join(', ')} WHERE id = ?`, args);
  await audit('inventory_item_edit', { actor: user.username, detail: `item ${params.id}: ${Object.keys(b).join(',')}` });
  return NextResponse.json({ ok: true });
}
