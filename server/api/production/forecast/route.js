// Production Forecasting (STERP item 20) — upcoming material/production load off open Work Orders.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getProductionForecast } from '@/lib/data';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const horizonDays = Number(new URL(req.url).searchParams.get('days')) || 30;
  return NextResponse.json(await getProductionForecast(horizonDays));
}
