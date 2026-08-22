// app/api/reports/production-cost-variance/route.js — Production management report: planned vs
// actual material+labour per Work Order over a period. See lib/data.js's
// getProductionCostVarianceLines — reuses getWorkOrderCosting() per Work Order (§5l), not a second
// cost calculation.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getProductionCostVarianceLines } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function computeProductionCostVariance(company, { from, to } = {}) {
  const lines = await getProductionCostVarianceLines(company, { from, to });
  return {
    lines,
    totalPlanned: lines.reduce((s, l) => s + l.plannedTotal, 0),
    totalActual: lines.reduce((s, l) => s + l.actualTotal, 0),
    totalVariance: lines.reduce((s, l) => s + l.totalVariance, 0),
  };
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  return NextResponse.json(await computeProductionCostVariance(company, { from, to }));
}
