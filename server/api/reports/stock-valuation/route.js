// app/api/reports/stock-valuation/route.js — REPORT-ENGINE-PLAN.md §10 Phase 1. on_hand × avg_cost
// per item, gated to Stores (not Accounts — this is a Stores-owned number, no company split since
// inventory_items itself has none). computeStockValuation is exported for the PDF export to reuse.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getStockValuation } from '@/lib/data';

export async function computeStockValuation() {
  const items = await getStockValuation();
  const totalValue = items.reduce((s, i) => s + (i.value || 0), 0);
  return { items, totalValue: Math.round((totalValue + Number.EPSILON) * 100) / 100 };
}

export async function GET() {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  return NextResponse.json(await computeStockValuation());
}
