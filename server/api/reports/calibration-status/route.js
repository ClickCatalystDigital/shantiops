// app/api/reports/calibration-status/route.js — QC report. Equipment/jig-fixture calibration bank
// (lib/data.js's getCalibrationItems, needsCompany: false — same reasoning as Stock Valuation: the
// bank isn't project/company-scoped).
import { NextResponse } from 'next/server';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { getCalibrationItems } from '@/lib/data';

export async function computeCalibrationStatus() {
  const items = await getCalibrationItems();
  const counts = { expired: 0, due_soon: 0, ok: 0, blocked: 0 };
  for (const i of items) counts[i.status] = (counts[i.status] || 0) + 1;
  return { items, ...counts, total: items.length };
}

export async function GET() {
  const user = await getFreshSessionUser();
  if (!isPM(user) && !canAccessDepartment(user, 'QC')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await computeCalibrationStatus());
}
