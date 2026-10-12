import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getSchedule } from '@/lib/plan-schedule';

export async function GET() {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  return NextResponse.json(await getSchedule());
}
