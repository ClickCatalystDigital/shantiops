import { NextResponse } from 'next/server';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { getLeaveTypes } from '@/lib/data';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!isPM(user) && !canAccessDepartment(user, 'HR')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await getLeaveTypes());
}
