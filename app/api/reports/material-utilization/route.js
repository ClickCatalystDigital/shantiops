// app/api/reports/material-utilization/route.js — Production management report: used vs
// remnant-recovered vs scrap weight per cut, the "material saved vs. scrapped" cost story
// (REPORT-ENGINE-PLAN.md §8). No company split — cut material is shared shop stock, same
// precedent as Stock Valuation. See lib/data.js's getMaterialUtilizationLines for the
// used/remnant/scrap derivation.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getMaterialUtilizationLines } from '@/lib/data';

export async function computeMaterialUtilization(_company, { from, to } = {}) {
  const lines = await getMaterialUtilizationLines({ from, to });
  const totalSource = lines.reduce((s, l) => s + l.source_weight, 0);
  const totalUsed = lines.reduce((s, l) => s + l.used_weight, 0);
  const totalRemnant = lines.reduce((s, l) => s + l.remnant_weight, 0);
  const totalScrap = lines.reduce((s, l) => s + l.scrap_weight, 0);
  return {
    lines, totalSource, totalUsed, totalRemnant, totalScrap,
    overallYieldPct: totalSource ? Math.round(((totalUsed + totalRemnant) / totalSource) * 100) : 0,
  };
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;
  return NextResponse.json(await computeMaterialUtilization(undefined, { from, to }));
}
