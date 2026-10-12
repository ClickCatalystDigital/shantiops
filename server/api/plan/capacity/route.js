import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getCapacity } from '@/lib/plan-schedule';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const weeks = Math.min(26, Math.max(2, Number(new URL(req.url).searchParams.get('weeks')) || 8));
  return NextResponse.json(await getCapacity({ weekCount: weeks }));
}
