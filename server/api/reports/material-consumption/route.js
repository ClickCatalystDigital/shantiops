// app/api/reports/material-consumption/route.js — REPORT-ENGINE-PLAN.md §10.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getMaterialConsumptionLines } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function computeMaterialConsumption(company, { from, to } = {}) {
  const lines = await getMaterialConsumptionLines(company, { from, to });
  return { lines, totalCost: lines.reduce((s, l) => s + (l.total_cost || 0), 0) };
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  return NextResponse.json(await computeMaterialConsumption(company, { from, to }));
}
