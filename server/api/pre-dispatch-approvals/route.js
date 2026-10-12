// Inward QC/Production Approval Workflow — the pending pre-dispatch review queue. Read access is
// QC + Production + Dispatch — every party the requirement names as needing visibility into status.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { getPendingPreDispatchApprovals } from '@/lib/data';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!['QC', 'Production', 'Dispatch'].some(d => canAccessDepartment(user, d))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await getPendingPreDispatchApprovals());
}
