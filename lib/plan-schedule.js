// lib/plan-schedule.js — DB side of Planning -> Capacity and Schedule. Maths lives in lib/capacity.mjs.
import { queryAll } from './db';
import { buildCapacity } from './capacity.mjs';
import { getPlan } from './plan-coverage';
import { todayISO } from './date';

export async function getCapacity({ weekCount = 8 } = {}) {
  const today = todayISO();
  const [stations, ops] = await Promise.all([
    queryAll('SELECT id, name, shifts_per_day, hours_per_shift, working_days_per_week FROM workstations WHERE active = 1 ORDER BY name'),
    queryAll(
      `SELECT wop.workstation_id, wop.planned_minutes AS minutes, wo.id AS wo_id, wo.wo_no,
              wo.planned_start AS start, wo.planned_end AS end
         FROM work_order_operations wop JOIN work_orders wo ON wo.id = wop.work_order_id
        WHERE wop.status != 'done' AND wop.workstation_id IS NOT NULL AND wop.planned_minutes > 0
          AND wo.status IN ('released','in_progress')`),
  ]);
  return { ...buildCapacity({ ops, stations, today, weekCount }), stations_config: stations, today };
}

// Open Work Orders with progress and whether their project's material is ready (from the coverage
// engine, so the Schedule and the Material Plan can never disagree).
export async function getSchedule() {
  const today = todayISO();
  const wos = await queryAll(
    `SELECT wo.id, wo.wo_no, wo.mode, wo.status, wo.product_description, wo.qty_planned, wo.planned_start, wo.planned_end,
            wo.project_id, p.project_no, p.customer_name,
            (SELECT COUNT(*) FROM job_cards j WHERE j.work_order_id = wo.id) AS cards,
            (SELECT COUNT(*) FROM job_cards j WHERE j.work_order_id = wo.id AND j.status = 'done') AS cards_done
       FROM work_orders wo LEFT JOIN projects p ON p.id = wo.project_id
      WHERE wo.status IN ('released','in_progress')
      ORDER BY COALESCE(wo.planned_start, wo.planned_end, '9999'), wo.id`);
  const projectIds = [...new Set(wos.map(w => w.project_id).filter(Boolean))];
  const plan = projectIds.length ? await getPlan({ projectIds }) : { rows: [] };
  const byProject = new Map();
  for (const r of plan.rows) {
    const m = byProject.get(r.project_id) || { total: 0, short: 0, late: 0, unknown: 0 };
    m.total++;
    if (r.short > 0 && r.status !== 'unreleased') m.short++;
    if (r.status === 'late') m.late++;
    byProject.set(r.project_id, m);
  }
  return {
    today,
    workOrders: wos.map(w => {
      const m = byProject.get(w.project_id);
      const material = !w.project_id ? 'n/a' : !m ? 'unknown' : m.short || m.late ? 'blocked' : 'ready';
      return {
        ...w, delayed: !!(w.planned_end && w.planned_end < today),
        progress: w.cards ? w.cards_done / w.cards : 0,
        material, material_short: m?.short || 0, material_late: m?.late || 0,
      };
    }),
  };
}
