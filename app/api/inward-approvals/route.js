// Inward QC/Production Approval Workflow — the pending inward-review queue. Read access is QC +
// Stores (Stores physically holds the material and needs to see whether it's pending/rejected, but
// decide authority stays QC-Head-only — see [id]/decide/route.js).
import { NextResponse } from 'next/server';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { getPendingInwardApprovals } from '@/lib/data';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'QC') && !canAccessDepartment(user, 'Stores')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await getPendingInwardApprovals());
}
