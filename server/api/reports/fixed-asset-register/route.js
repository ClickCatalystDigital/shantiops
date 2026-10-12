// app/api/reports/fixed-asset-register/route.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 9. One
// row per asset — cost/method/accumulated depreciation/book value/status — wiring `fixed_assets`
// (§5z) into the Report Engine catalog like every other report. No new calculation: book value is
// the one-line cost-minus-accumulated-depreciation derivation, everything else is already stored.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getFixedAssets } from '@/lib/fixed-assets';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function computeFixedAssetRegister(company) {
  const assets = (await getFixedAssets(company)).map(a => ({
    ...a,
    book_value: Math.round((a.cost - a.accumulated_depreciation + Number.EPSILON) * 100) / 100,
  }));
  return {
    assets,
    totalCost: assets.reduce((s, a) => s + (a.cost || 0), 0),
    totalAccumulatedDepreciation: assets.reduce((s, a) => s + (a.accumulated_depreciation || 0), 0),
    totalBookValue: assets.reduce((s, a) => s + (a.book_value || 0), 0),
  };
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  return NextResponse.json(await computeFixedAssetRegister(company));
}
