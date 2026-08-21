// app/api/reports/stock-ledger/route.js — REPORT-ENGINE-PLAN.md §10. Mirror of
// customer-ledger/route.js: same runningLedger() rollup, tracking quantity per inventory item
// instead of money per party. No company split (Stores is one shared warehouse).
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getStockLedgerLines } from '@/lib/data';
import { queryOne } from '@/lib/db';
import { runningLedger } from '@/lib/ledger.mjs';

export async function computeStockLedger(company, { itemId, from, to } = {}) {
  if (!itemId) throw new Error('item_id is required');
  const [item, rows] = await Promise.all([
    queryOne('SELECT id, item_code, description FROM inventory_items WHERE id = ?', [itemId]),
    getStockLedgerLines(itemId),
  ]);
  if (!item) throw new Error('Inventory item not found');
  return { item, ...runningLedger(rows, { from, to }) };
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const itemId = searchParams.get('item_id') || undefined;
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  if (!itemId) return NextResponse.json({ item: null, openingBalance: 0, closingBalance: 0, entries: [] });
  try {
    return NextResponse.json(await computeStockLedger(null, { itemId, from, to }));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
