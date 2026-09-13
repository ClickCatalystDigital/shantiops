import { NextResponse } from 'next/server';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { getPreDispatchApprovalDetail } from '@/lib/data';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!['QC', 'Production', 'Dispatch'].some(d => canAccessDepartment(user, d))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const detail = await getPreDispatchApprovalDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(detail);
}
