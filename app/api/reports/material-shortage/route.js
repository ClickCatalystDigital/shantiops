// app/api/reports/material-shortage/route.js — Production management report: outstanding material
// demand across open Work Orders within a horizon (forward-looking, not a historical period — same
// data getProductionForecast() already computes for the Forecast tab, §5l). No company split — a
// shortage blocks whichever Work Order needs it regardless of legal entity.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getProductionForecast } from '@/lib/data';
import { getPlan } from '@/lib/plan-coverage';

import { queryAll } from '@/lib/db';
async function getOpenWorkOrderProjects() {
  return (await queryAll("SELECT DISTINCT project_id FROM work_orders WHERE status IN ('released','in_progress')")).map(r => r.project_id);
}

export async function computeMaterialShortage(_company, { horizonDays } = {}) {
  const forecast = await getProductionForecast(Number(horizonDays) || 30);
  // Real shortfall, not just demand: what is still short after stock, remnants, reservations and
  // open POs, for the projects those Work Orders belong to (same engine as Planning -> Material Plan).
  const pids = [...new Set((await getOpenWorkOrderProjects()).filter(Boolean))];
  const plan = pids.length ? await getPlan({ projectIds: pids }) : { rows: [] };
  const short = new Map();
  for (const r of plan.rows) {
    if (!(r.short > 0) || r.status === 'unreleased') continue;
    const k = r.description;
    const cur = short.get(k) || { material: k, short: 0, projects: new Set(), worst: r.status };
    cur.short += r.short; cur.projects.add(r.project_label);
    short.set(k, cur);
  }
  const shortfalls = [...short.values()].map(x => ({ material: x.material, short: Math.round(x.short * 100) / 100, projects: [...x.projects] }))
    .sort((a, b) => b.short - a.short).slice(0, 50);
  return {
    shortfalls,
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
