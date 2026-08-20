// app/api/purchase-returns/[id]/route.js — mirror of app/api/sales-returns/[id]/route.js, opposite
// stock direction: removing returned material from on-hand instead of crediting it back.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { shouldAdjustStock } from '@/lib/bom-structure.mjs';

const FIELDS = ['inspection_outcome', 'stock_action', 'inventory_item_id', 'debit_note_ref', 'reason'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Procurement', 'procurement.return.write');
  if (actionDenied) return actionDenied;

  const row = await queryOne('SELECT * FROM purchase_returns WHERE id = ?', [params.id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  if (b.stock_action === 'removed_from_stock' && !(b.inventory_item_id || row.inventory_item_id)) {
    return NextResponse.json({ error: 'Pick which inventory item this material returns from' }, { status: 400 });
  }
  const sets = [];
  const args = [];
  for (const f of FIELDS) {
    if (f in b) { sets.push(`${f} = ?`); args.push(b[f] === '' ? null : b[f]); }
  }
  if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  args.push(params.id);
  await execute(`UPDATE purchase_returns SET ${sets.join(', ')} WHERE id = ?`, args);

  // Decrement stock only on the transition into removed_from_stock — mirrors sales-returns'
  // on_hand = on_hand + ? idiom in the opposite direction, guarded so a later re-save (e.g. editing
  // debit_note_ref) never double-decrements.
  if (shouldAdjustStock(b.stock_action, row.stock_action)) {
    const invItemId = b.inventory_item_id || row.inventory_item_id;
    await execute('UPDATE inventory_items SET on_hand = MAX(0, on_hand - ?) WHERE id = ?', [row.qty, invItemId]);
  }

  await audit('purchase_return_edit', { actor: user.username, detail: `return ${params.id}: ${Object.keys(b).join(',')}` });
  return NextResponse.json({ ok: true });
}
