// app/api/sales-returns/[id]/route.js — inspection outcome, stock action, and credit-note
// reference get set/updated here as the return moves through its lifecycle.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

const FIELDS = ['inspection_outcome', 'stock_action', 'inventory_item_id', 'credit_note_ref', 'reason'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Sales');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Sales', 'sales.return.write');
  if (actionDenied) return actionDenied;

  const row = await queryOne('SELECT * FROM sales_returns WHERE id = ?', [params.id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  if (b.stock_action === 'returned_to_stock' && !(b.inventory_item_id || row.inventory_item_id)) {
    return NextResponse.json({ error: 'Pick which inventory item this material returns to' }, { status: 400 });
  }
  const sets = [];
  const args = [];
  for (const f of FIELDS) {
    if (f in b) { sets.push(`${f} = ?`); args.push(b[f] === '' ? null : b[f]); }
  }
  if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  args.push(params.id);
  await execute(`UPDATE sales_returns SET ${sets.join(', ')} WHERE id = ?`, args);

  // Credit stock only on the transition into returned_to_stock — reusing the same
  // `on_hand = on_hand + ?` idiom app/api/bom-items/[id]/route.js's stock-build receipt already
  // uses — guarded so a later re-save (e.g. editing credit_note_ref) never double-counts.
  if (b.stock_action === 'returned_to_stock' && row.stock_action !== 'returned_to_stock') {
    const invItemId = b.inventory_item_id || row.inventory_item_id;
    await execute('UPDATE inventory_items SET on_hand = on_hand + ? WHERE id = ?', [row.qty, invItemId]);
  }

  await audit('sales_return_edit', { actor: user.username, detail: `return ${params.id}: ${Object.keys(b).join(',')}` });
  return NextResponse.json({ ok: true });
}
