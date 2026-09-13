import { NextResponse } from 'next/server';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { getInwardApprovalDetail } from '@/lib/data';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'QC') && !canAccessDepartment(user, 'Stores')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const detail = await getInwardApprovalDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(detail);
}
