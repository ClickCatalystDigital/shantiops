// app/api/reports/inventory-aging/route.js — REPORT-ENGINE-PLAN.md §10. Reuses
// lib/ledger.mjs's agingBuckets() (same "days since a reference date -> bucket" math as AR/AP
// Aging) — here the reference is last movement date instead of a due date, and "outstanding" is
// the item's stock value (never settles). No company split (Stores is one shared warehouse, same
// as Stock Valuation).
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getInventoryAgingLines } from '@/lib/data';
import { agingBuckets } from '@/lib/ledger.mjs';
import { todayISO } from '@/lib/date';

// Signature matches every other report's compute(company, {...}) even though this report has no
// company split — the generic export route always calls compute(company, options) positionally, so
// `asOf` must be the second positional param or it lands in the wrong slot (caught before shipping:
// computeStockValuation gets away with zero params only because it truly needs none).
export async function computeInventoryAging(company, { asOf } = {}) {
  const resolvedAsOf = asOf || todayISO();
  const raw = await getInventoryAgingLines();
  const rows = raw.map((r) => ({
    ref: r.item_code || `#${r.itemId}`,
    party: r.description,
    date: r.lastMovement || '1900-01-01', // no movement ever recorded -> treated as maximally aged
    dueDate: r.lastMovement || '1900-01-01',
    amount: Math.round((r.on_hand * r.avg_cost + Number.EPSILON) * 100) / 100,
    settled: 0,
  }));
  return { asOf: resolvedAsOf, ...agingBuckets(rows, resolvedAsOf) };
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const asOf = searchParams.get('as_of') || undefined;
  return NextResponse.json(await computeInventoryAging(null, { asOf }));
}
