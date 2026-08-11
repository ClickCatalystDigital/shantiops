import { NextResponse } from 'next/server';
import { getSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { getLeaveTypes } from '@/lib/data';

export async function GET() {
  const user = getSessionUser();
  if (!isPM(user) && !canAccessDepartment(user, 'HR')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await getLeaveTypes());
}
