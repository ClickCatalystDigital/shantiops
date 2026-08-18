// app/api/price-lists/route.js — STERP "Price Lists" (SYSTEM.md §5e). GET with no params returns
// the full management-tab list (getPriceLists, joined for display); GET with ?item_id= (and
// optional &customer_id=) returns the single best-matching active rate — customer-specific wins
// over the NULL/default row, most recent valid_from wins a tie — for NewQuotationDialog's
// rate auto-fill. Sales-owned, same gating shape as app/api/suppliers/route.js (a single
// department's own master data, not the dual Sales/Marketing CRM gate quotations/customers use).
import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, isInternal } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getPriceLists } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const itemId = searchParams.get('item_id');
  if (itemId) {
    const customerId = searchParams.get('customer_id');
    const rows = await queryAll(
      `SELECT * FROM price_lists
        WHERE item_id = ?
          AND (customer_id IS NULL OR customer_id = ?)
          AND (valid_from IS NULL OR date(valid_from) <= date('now'))
          AND (valid_until IS NULL OR date(valid_until) >= date('now'))
        ORDER BY (customer_id IS NULL), valid_from DESC
        LIMIT 1`,
      [itemId, customerId || -1]
    );
    return NextResponse.json(rows[0] || null);
  }

  return NextResponse.json(await getPriceLists());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Sales');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Sales', 'sales.price_list.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  if (!b.item_id) return NextResponse.json({ error: 'Item is required' }, { status: 400 });
  const rate = Number(b.rate);
  if (!(rate > 0)) return NextResponse.json({ error: 'Rate must be a positive number' }, { status: 400 });

  const { lastId } = await execute(
    `INSERT INTO price_lists (customer_id, item_id, rate, uom, valid_from, valid_until, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [b.customer_id || null, b.item_id, rate, b.uom || null, b.valid_from || null, b.valid_until || null,
      b.notes || null, user.username]
  );
  await audit('price_list_created', { actor: user.username, detail: `item ${b.item_id}${b.customer_id ? ` / customer ${b.customer_id}` : ' / default'}` });
  return NextResponse.json({ id: Number(lastId) });
}
