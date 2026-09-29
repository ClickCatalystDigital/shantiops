// Price history of one product — newest first. Rows are written by PATCH when price or cost changes.
// A product with no rows yet gets its current price shown as the starting entry.
import { NextResponse } from 'next/server';
import { queryAll, queryOne } from '@/lib/db';
import { getFreshSessionUser, isInternal } from '@/lib/auth';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const rows = await queryAll('SELECT price, cost_price, changed_by, changed_at FROM product_price_history WHERE product_id = ? ORDER BY id DESC', [params.id]);
  if (!rows.length) {
    const p = await queryOne('SELECT price, cost_price, created_at AS changed_at FROM sales_products WHERE id = ?', [params.id]);
    if (p && (p.price != null || p.cost_price != null)) rows.push({ ...p, changed_by: 'initial' });
  }
  return NextResponse.json(rows);
}
