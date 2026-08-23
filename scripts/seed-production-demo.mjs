// scripts/seed-production-demo.mjs — additive seed data for Production's report set (SYSTEM.md
// flagged thin coverage; job_card_time_logs was at 0 rows, so Labour Utilization showed nothing at
// all, and only 2 work_orders/4 job_cards existed with no completed/delayed status variety).
//
// Two kinds of change here:
//  1. Additive rows tagged for clean re-seeding: new work_orders/job_cards/job_card_time_logs
//     (created_by = MARK, children cleaned via their parent's work_order_id), material_issues
//     (issued_by = MARK), stock_pieces (code LIKE 'DEMO-PC-%'), and 3 new demo shop-floor employees
//     (employee_code LIKE 'DEMO-EMP-%') — same additive/re-runnable precedent as
//     scripts/seed-report-demo-extra.mjs.
//  2. Idempotent UPDATEs filling NULL cost_rate_per_hour / machine_hour_rate on a few EXISTING
//     Production employees/workstations — both were entirely unset DB-wide, so Labour Utilization's
//     cost column and Production Cost Variance's planned labour cost were always going to read zero
//     regardless of how much time-log data got seeded. Setting a real rate on already-Production-
//     tagged records is filling in missing baseline data, not fabricating new demo entities — safe
//     to re-run (same value every time), and touches no other department's data.
//
// Run: node --env-file=.env.local scripts/seed-production-demo.mjs
import { createClient } from '@libsql/client';

const MARK = 'production-demo-seed';
const client = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

async function run(sql, args = []) { return client.execute({ sql, args }); }
async function insert(sql, args = []) { return (await run(sql, args)).lastInsertRowid; }

// --- Clean up previous runs (children first for FKs). ----------------------------------------
await run(`DELETE FROM job_card_time_logs WHERE job_card_id IN (
  SELECT id FROM job_cards WHERE work_order_id IN (SELECT id FROM work_orders WHERE created_by = ?)
)`, [MARK]);
await run(`DELETE FROM material_issues WHERE issued_by = ?`, [MARK]); // FK to job_cards — must go before job_cards
await run(`DELETE FROM job_cards WHERE work_order_id IN (SELECT id FROM work_orders WHERE created_by = ?)`, [MARK]);
await run(`DELETE FROM work_order_materials WHERE work_order_id IN (SELECT id FROM work_orders WHERE created_by = ?)`, [MARK]);
await run(`DELETE FROM work_order_operations WHERE work_order_id IN (SELECT id FROM work_orders WHERE created_by = ?)`, [MARK]);
await run(`DELETE FROM work_orders WHERE created_by = ?`, [MARK]);
await run(`DELETE FROM stock_pieces WHERE code LIKE 'DEMO-PC-%'`);
await run(`DELETE FROM employees WHERE employee_code LIKE 'DEMO-EMP-%'`);

function daysFromNow(n) { return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10); }
function dtFromNow(n) { return new Date(Date.now() + n * 86400000).toISOString().slice(0, 19).replace('T', ' '); }

// --- Fill missing baseline rates on existing Production employees/workstations. ----------------
await run(`UPDATE employees SET cost_rate_per_hour = 350 WHERE id = 2 AND cost_rate_per_hour IS NULL`); // Production Head
await run(`UPDATE employees SET trade = 'Fitter', cost_rate_per_hour = 420 WHERE id = 11 AND cost_rate_per_hour IS NULL`); // K. Manmohan
await run(`UPDATE employees SET cost_rate_per_hour = 400 WHERE id = 24 AND cost_rate_per_hour IS NULL`); // test name (Machinist)
await run(`UPDATE workstations SET machine_hour_rate = 600 WHERE id = 4 AND machine_hour_rate IS NULL`); // Weld Bay 1
await run(`UPDATE workstations SET machine_hour_rate = 600 WHERE id = 5 AND machine_hour_rate IS NULL`); // Weld Bay 2
await run(`UPDATE workstations SET machine_hour_rate = 450 WHERE id = 2 AND machine_hour_rate IS NULL`); // Plasma Cutter
await run(`UPDATE workstations SET machine_hour_rate = 750 WHERE id = 6 AND machine_hour_rate IS NULL`); // CNC Lathe
await run(`UPDATE workstations SET machine_hour_rate = 350 WHERE id = 1 AND machine_hour_rate IS NULL`); // Marking Table

// --- 3 new demo shop-floor employees (obvious DEMO- prefix, per SYSTEM.md's "keep demo data, name
// it obviously" precedent — no created_by column on employees to tag with MARK instead). -----------
const emp1 = await insert(
  `INSERT INTO employees (employee_code, name, employee_type, department, trade, active, cost_rate_per_hour)
   VALUES (?,?,?,?,?,?,?)`,
  ['DEMO-EMP-1', 'Demo Welder — G. Suresh', 'worker', 'Production', 'Welder', 1, 500]
);
const emp2 = await insert(
  `INSERT INTO employees (employee_code, name, employee_type, department, trade, active, cost_rate_per_hour)
   VALUES (?,?,?,?,?,?,?)`,
  ['DEMO-EMP-2', 'Demo Fitter — N. Ramesh', 'worker', 'Production', 'Fitter', 1, 420]
);
const emp3 = await insert(
  `INSERT INTO employees (employee_code, name, employee_type, department, trade, active, cost_rate_per_hour)
   VALUES (?,?,?,?,?,?,?)`,
  ['DEMO-EMP-3', 'Demo Painter — B. Krishna', 'worker', 'Production', 'Painter', 1, 380]
);
const PRODUCTION_HEAD = 2, MANMOHAN = 11, MACHINIST = 24;

// --- 4 new work orders spanning the status variety Work Order Register/Cost Variance need. -------
const wo1 = await insert( // completed
  `INSERT INTO work_orders (wo_no, project_id, mode, qty_planned, planned_start, planned_end, status, created_by)
   VALUES (?,?,?,?,?,?,?,?)`,
  ['WO-DEMO-1', 16, 'against_order', 20, daysFromNow(-23), daysFromNow(-9), 'completed', MARK]
);
const wo2 = await insert( // in_progress, planned_end in the past -> trips the existing delayed flag
  `INSERT INTO work_orders (wo_no, project_id, mode, qty_planned, planned_start, planned_end, status, created_by)
   VALUES (?,?,?,?,?,?,?,?)`,
  ['WO-DEMO-2', 18, 'against_order', 15, daysFromNow(-19), daysFromNow(-6), 'in_progress', MARK]
);
const wo3 = await insert( // in_progress, on schedule
  `INSERT INTO work_orders (wo_no, project_id, mode, qty_planned, planned_start, planned_end, status, created_by)
   VALUES (?,?,?,?,?,?,?,?)`,
  ['WO-DEMO-3', 19, 'against_order', 12, daysFromNow(-9), daysFromNow(21), 'in_progress', MARK]
);
const wo4 = await insert( // draft
  `INSERT INTO work_orders (wo_no, project_id, mode, qty_planned, status, created_by)
   VALUES (?,?,?,?,?,?)`,
  ['WO-DEMO-4', 23, 'against_order', 10, 'draft', MARK]
);

// Planned baseline (work_order_operations / work_order_materials) so Production Cost Variance has a
// non-zero plan to compare against, not just an actual with nothing to vary against.
const OP_WELDING = 5, OP_FITUP = 4, OP_CUTTING = 2, OP_MACHINING = 7, OP_MARKING = 1;
const WS_WELD1 = 4, WS_WELD2 = 5, WS_PLASMA = 2, WS_CNC = 6, WS_MARKING = 1;
await run(`INSERT INTO work_order_operations (work_order_id, seq, operation_id, workstation_id, planned_minutes) VALUES (?,?,?,?,?)`, [wo1, 1, OP_WELDING, WS_WELD1, 1800]);
await run(`INSERT INTO work_order_operations (work_order_id, seq, operation_id, workstation_id, planned_minutes) VALUES (?,?,?,?,?)`, [wo2, 1, OP_FITUP, WS_WELD2, 1200]);
await run(`INSERT INTO work_order_operations (work_order_id, seq, operation_id, workstation_id, planned_minutes) VALUES (?,?,?,?,?)`, [wo2, 2, OP_WELDING, WS_WELD1, 900]);
await run(`INSERT INTO work_order_operations (work_order_id, seq, operation_id, workstation_id, planned_minutes) VALUES (?,?,?,?,?)`, [wo3, 1, OP_CUTTING, WS_PLASMA, 600]);
await run(`INSERT INTO work_order_operations (work_order_id, seq, operation_id, workstation_id, planned_minutes) VALUES (?,?,?,?,?)`, [wo3, 2, OP_MACHINING, WS_CNC, 800]);
await run(`INSERT INTO work_order_operations (work_order_id, seq, operation_id, workstation_id, planned_minutes) VALUES (?,?,?,?,?)`, [wo4, 1, OP_MARKING, WS_MARKING, 300]);

const { rows: bomItems } = await run(
  `SELECT id, project_id FROM bom_items WHERE project_id IN (16,18,19,23) ORDER BY project_id, id`
);
const bomFor = (projectId) => bomItems.filter(b => b.project_id === projectId);
await run(`INSERT INTO work_order_materials (work_order_id, bom_item_id, qty_required, unit_cost) VALUES (?,?,?,?)`, [wo1, bomFor(16)[0]?.id ?? null, 500, 65]);
await run(`INSERT INTO work_order_materials (work_order_id, bom_item_id, qty_required, unit_cost) VALUES (?,?,?,?)`, [wo2, bomFor(18)[0]?.id ?? null, 350, 72]);
await run(`INSERT INTO work_order_materials (work_order_id, bom_item_id, qty_required, unit_cost) VALUES (?,?,?,?)`, [wo3, bomFor(19)[0]?.id ?? null, 200, 58]);
await run(`INSERT INTO work_order_materials (work_order_id, bom_item_id, qty_required, unit_cost) VALUES (?,?,?,?)`, [wo4, bomFor(23)[0]?.id ?? null, 150, 60]);

// --- Job Cards — a couple with qty_rejected > 0 to feed Rework/Rejection alongside the QC fail
// rows seed-qc-inspections-demo.mjs already adds. ------------------------------------------------
const jc1 = await insert(
  `INSERT INTO job_cards (project_id, section, operation_id, workstation_id, work_order_id, qty_planned, qty_done, qty_rejected, status, created_by)
   VALUES (?,?,?,?,?,?,?,?,?,?)`,
  [16, 'Shell Fabrication', OP_WELDING, WS_WELD1, wo1, 20, 20, 0, 'done', MARK]
);
const jc2 = await insert(
  `INSERT INTO job_cards (project_id, section, operation_id, workstation_id, work_order_id, qty_planned, qty_done, qty_rejected, status, created_by)
   VALUES (?,?,?,?,?,?,?,?,?,?)`,
  [18, 'Fit-up', OP_FITUP, WS_WELD2, wo2, 15, 8, 2, 'in_progress', MARK]
);
const jc3 = await insert(
  `INSERT INTO job_cards (project_id, section, operation_id, workstation_id, work_order_id, qty_planned, qty_done, qty_rejected, status, created_by)
   VALUES (?,?,?,?,?,?,?,?,?,?)`,
  [18, 'Welding', OP_WELDING, WS_WELD1, wo2, 15, 0, 0, 'pending', MARK]
);
const jc4 = await insert(
  `INSERT INTO job_cards (project_id, section, operation_id, workstation_id, work_order_id, qty_planned, qty_done, qty_rejected, status, created_by)
   VALUES (?,?,?,?,?,?,?,?,?,?)`,
  [19, 'Cutting', OP_CUTTING, WS_PLASMA, wo3, 12, 12, 1, 'done', MARK]
);
const jc5 = await insert(
  `INSERT INTO job_cards (project_id, section, operation_id, workstation_id, work_order_id, qty_planned, qty_done, qty_rejected, status, created_by)
   VALUES (?,?,?,?,?,?,?,?,?,?)`,
  [19, 'Machining', OP_MACHINING, WS_CNC, wo3, 12, 5, 0, 'in_progress', MARK]
);
const jc6 = await insert(
  `INSERT INTO job_cards (project_id, section, operation_id, workstation_id, work_order_id, qty_planned, qty_done, qty_rejected, status, created_by)
   VALUES (?,?,?,?,?,?,?,?,?,?)`,
  [23, 'Marking', OP_MARKING, WS_MARKING, wo4, 10, 0, 0, 'pending', MARK]
);

// --- job_card_time_logs — the table Labour Utilization needs non-empty, minutes/cost across a
// spread of employees and dates in the last ~25 days. --------------------------------------------
const timeLogs = [
  [jc1, PRODUCTION_HEAD, -22, 240], [jc1, MANMOHAN, -21, 300], [jc1, emp1, -20, 360], [jc1, emp2, -19, 180],
  [jc2, emp1, -18, 270], [jc2, emp2, -16, 210], [jc2, MANMOHAN, -14, 150],
  [jc3, emp2, -10, 90],
  [jc4, MACHINIST, -9, 200], [jc4, emp1, -8, 220], [jc4, MANMOHAN, -7, 160],
  [jc5, MACHINIST, -6, 240], [jc5, emp3, -5, 120], [jc5, MACHINIST, -3, 180],
  [jc6, emp3, -2, 90], [jc6, MANMOHAN, -1, 60],
];
for (const [jobCardId, employeeId, offset, minutes] of timeLogs) {
  await run(
    `INSERT INTO job_card_time_logs (job_card_id, employee_id, minutes, created_by, created_at) VALUES (?,?,?,?,?)`,
    [jobCardId, employeeId, minutes, MARK, dtFromNow(offset)]
  );
}

// --- material_issues — a few more against real bom_items, varied cost/qty so Material Consumption
// isn't dominated by the single pre-existing row. --------------------------------------------------
const materialIssues = [
  [bomFor(16)[0]?.id, jc1, 480, 65, -20],
  [bomFor(18)[1]?.id, jc2, 320, 72, -17],
  [bomFor(19)[0]?.id, jc4, 190, 58, -8],
  [bomFor(19)[1]?.id, jc5, 60, 410, -6],
  [bomFor(23)[0]?.id, jc6, 140, 60, -2],
];
for (const [bomItemId, jobCardId, qty, unitCost, offset] of materialIssues) {
  if (!bomItemId) continue;
  await run(
    `INSERT INTO material_issues (bom_item_id, job_card_id, qty, issued_by, issued_at, unit_cost, total_cost)
     VALUES (?,?,?,?,?,?,?)`,
    [bomItemId, jobCardId, qty, MARK, dtFromNow(offset), unitCost, qty * unitCost]
  );
}

// --- stock_pieces — 2 more full parent+children cut events. getMaterialUtilizationLines only
// counts a "used" child that's recorded via parent_id (EXISTS check) — isolated inserts don't count.
const { rows: invItems } = await run(`SELECT id FROM inventory_items WHERE id IN (10, 11) ORDER BY id`);
const invId = invItems[0]?.id ?? 10;
for (let i = 0; i < 2; i++) {
  const cutAt = dtFromNow(-15 + i * 5);
  const parentCode = `DEMO-PC-${i + 1}`;
  const parent = await insert(
    `INSERT INTO stock_pieces (inventory_item_id, code, kind, length_mm, width_mm, thickness_mm, density, weight_kg, status, source, cut_by, cut_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [invId, parentCode, 'plate', 2000, 1000, 10, 7850, 157, 'consumed', 'purchase', MARK, cutAt, cutAt]
  );
  await run( // used child — same cut_at as parent (born already consumed by the same cut event)
    `INSERT INTO stock_pieces (inventory_item_id, code, kind, length_mm, width_mm, thickness_mm, weight_kg, status, source, parent_id, cut_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [invId, `${parentCode}-U1`, 'plate', 1750, 950, 10, 130.5, 'consumed', 'remnant', parent, cutAt, cutAt]
  );
  await run( // recovered remnant — no cut_at yet (not independently re-cut)
    `INSERT INTO stock_pieces (inventory_item_id, code, kind, length_mm, width_mm, thickness_mm, weight_kg, status, source, parent_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [invId, `${parentCode}-R1`, 'plate', 240, 1000, 10, 18.8, 'available', 'remnant', parent, cutAt]
  );
  await run( // scrap
    `INSERT INTO stock_pieces (inventory_item_id, code, kind, weight_kg, status, source, parent_id, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [invId, `${parentCode}-S1`, 'plate', 7.7, 'scrap', 'remnant', parent, cutAt]
  );
}

console.log('Seeded: 3 demo employees, 4 work orders, 6 job cards, 16 time logs, 5 material issues, 2 cut events (8 stock_pieces rows).');
