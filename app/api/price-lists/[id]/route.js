// app/api/price-lists/[id]/route.js — edit/remove a price list entry. Unlike supplier_quotes
// (append-only, by design — see lib/db.js's price_lists comment), a wrong rate here is just
// corrected or removed; there's no price-history integrity property to protect.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

const FIELDS = ['customer_id', 'item_id', 'rate', 'uom', 'valid_from', 'valid_until', 'notes'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Sales');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Sales', 'sales.price_list.write');
  if (actionDenied) return actionDenied;

  const row = await queryOne('SELECT id FROM price_lists WHERE id = ?', [params.id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  if ('rate' in b && !(Number(b.rate) > 0)) {
    return NextResponse.json({ error: 'Rate must be a positive number' }, { status: 400 });
  }
  const sets = [];
  const args = [];
  for (const f of FIELDS) {
    if (f in b) { sets.push(`${f} = ?`); args.push(b[f] === '' ? null : b[f]); }
  }
  if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  args.push(params.id);

  await execute(`UPDATE price_lists SET ${sets.join(', ')} WHERE id = ?`, args);
  await audit('price_list_edit', { actor: user.username, detail: `price list ${params.id}: ${Object.keys(b).join(',')}` });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Sales');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Sales', 'sales.price_list.write');
  if (actionDenied) return actionDenied;

  const row = await queryOne('SELECT id FROM price_lists WHERE id = ?', [params.id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await execute('DELETE FROM price_lists WHERE id = ?', [params.id]);
  await audit('price_list_delete', { actor: user.username, detail: `price list ${params.id}` });
  return NextResponse.json({ ok: true });
}
