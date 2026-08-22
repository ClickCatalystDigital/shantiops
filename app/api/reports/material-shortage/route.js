// app/api/reports/material-shortage/route.js — Production management report: outstanding material
// demand across open Work Orders within a horizon (forward-looking, not a historical period — same
// data getProductionForecast() already computes for the Forecast tab, §5l). No company split — a
// shortage blocks whichever Work Order needs it regardless of legal entity.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getProductionForecast } from '@/lib/data';

export async function computeMaterialShortage(_company, { horizonDays } = {}) {
  const forecast = await getProductionForecast(Number(horizonDays) || 30);
  return {
    materialDemand: forecast.materialDemand,
    workOrders: forecast.workOrders,
    horizonDays: forecast.horizonDays,
  };
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const horizonDays = searchParams.get('horizon_days') || undefined;
  return NextResponse.json(await computeMaterialShortage(undefined, { horizonDays }));
}
