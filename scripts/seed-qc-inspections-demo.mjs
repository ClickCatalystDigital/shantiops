// scripts/seed-qc-inspections-demo.mjs — additive seed data for QC's Calibration Due/Status and
// Job-Work Inspection Register reports (both at 0 rows on the dev DB, so those reports would render
// truly empty), plus a few more qc_records so Inspection Pass/Fail Summary shows more than 4
// test_type/result combos. Same additive precedent as scripts/seed-report-demo-extra.mjs: only ever
// touches rows tagged created_by = MARK, re-runnable (deletes its own rows first), never touches
// existing demo projects/data.
//
// Run: node --env-file=.env.local scripts/seed-qc-inspections-demo.mjs
import { createClient } from '@libsql/client';

const MARK = 'qc-inspections-demo-seed';
const client = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

async function run(sql, args = []) { return client.execute({ sql, args }); }
async function insert(sql, args = []) { return (await run(sql, args)).lastInsertRowid; }

// Clean up previous runs.
await run(`DELETE FROM calibration_items WHERE created_by = ?`, [MARK]);
await run(`DELETE FROM job_work_inspections WHERE created_by = ?`, [MARK]);
await run(`DELETE FROM qc_records WHERE created_by = ?`, [MARK]);

const { rows: projects } = await run(
  `SELECT id, project_no FROM projects WHERE project_no IN ('SB-1018','SB-1023','SB-1024','SB-1025')`
);
const byNo = Object.fromEntries(projects.map(p => [p.project_no, p.id]));
for (const no of ['SB-1018', 'SB-1023', 'SB-1024', 'SB-1025']) {
  if (!byNo[no]) throw new Error(`Expected seed project ${no} not found`);
}

function daysFromNow(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

// --- calibration_items: ~10 rows spanning all 4 derived statuses (calibrationStatus() in
// lib/qc-inspections.mjs: expired = due_date in the past, due_soon = within 30 days, ok = further
// out, blocked = manual override regardless of date). ---------------------------------------------
const calibrationItems = [
  ['instrument', 'Digital Vernier Caliper 200mm', 'INST-001', 12, daysFromNow(-40), daysFromNow(-40 + 365), 0],
  ['instrument', 'Ultrasonic Thickness Gauge', 'INST-014', 12, daysFromNow(-395), daysFromNow(-30), 0],
  ['instrument', 'Pressure Gauge 0-25 Bar', 'INST-022', 6, daysFromNow(-160), daysFromNow(10), 0],
  ['instrument', 'Digital Multimeter', 'INST-031', 12, daysFromNow(-340), daysFromNow(25), 0],
  ['instrument', 'Micrometer Screw Gauge 25mm', 'INST-007', 12, daysFromNow(-150), daysFromNow(215), 0],
  ['instrument', 'Surface Roughness Tester', 'INST-018', 12, daysFromNow(-100), daysFromNow(265), 0],
  ['jig_fixture', 'Welding Positioner Jig #3', 'JIG-003', 6, daysFromNow(-90), daysFromNow(90), 0],
  ['jig_fixture', 'Hydro Test Fixture A', 'JIG-011', 12, daysFromNow(-200), daysFromNow(165), 0],
  ['instrument', 'Dead Weight Tester', 'INST-009', 12, daysFromNow(-500), daysFromNow(-135), 1],
  ['jig_fixture', 'Rotary Table Fixture B', 'JIG-018', 6, daysFromNow(-300), daysFromNow(-120), 1],
];
for (const [type, name, identifier, scheduleMonths, lastCal, due, blocked] of calibrationItems) {
  await run(
    `INSERT INTO calibration_items (type, name, identifier, schedule_months, last_calibrated_on, due_date, blocked, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    [type, name, identifier, scheduleMonths, lastCal, due, blocked, MARK]
  );
}

// --- job_work_inspections: ~8 rows across existing projects, spread over the last 60 days, mixed
// closed (with variance)/in-flight/failed. ---------------------------------------------------------
const jobWorkRows = [
  [byNo['SB-1018'], 'Precision Galvanizing Works', -55, -48, 120, 118, -47, 'pass'],
  [byNo['SB-1018'], 'Shakti Heat Treatment', -40, -33, 60, 58, -32, 'pass'],
  [byNo['SB-1023'], 'Precision Galvanizing Works', -30, -23, 45, 45, -22, 'pass'],
  [byNo['SB-1023'], 'Metro Sandblasting Co', -20, -13, 80, 72, -12, 'fail'],
  [byNo['SB-1024'], 'Shakti Heat Treatment', -15, -8, 30, 29, -7, 'pass'],
  [byNo['SB-1024'], 'Precision Galvanizing Works', -10, -3, 25, null, null, 'pending'],
  [byNo['SB-1025'], 'Metro Sandblasting Co', -5, 2, 40, null, null, 'pending'],
  [byNo['SB-1025'], 'Shakti Heat Treatment', -50, -43, 90, 88, -42, 'pass'],
];
for (const [projectId, jobWorker, sentOffset, expectedOffset, sentQty, receivedQty, receivedOffset, result] of jobWorkRows) {
  await run(
    `INSERT INTO job_work_inspections
       (project_id, job_worker_name, sent_date, expected_return_date, sent_qty, received_qty, received_date, result, created_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      projectId, jobWorker, daysFromNow(sentOffset), daysFromNow(expectedOffset), sentQty,
      receivedQty, receivedOffset === null ? null : daysFromNow(receivedOffset), result, MARK,
    ]
  );
}

// --- qc_records: existing 5 rows cover 4 test_type/result combos (Hydro Test pass/pending,
// Incoming Inspection fail, Material Test Certificate pass). Add new test_types plus a fail/pending
// mix so Inspection Pass/Fail Summary shows real variety. ------------------------------------------
const qcRecordRows = [
  [byNo['SB-1018'], 'NDE - DP Test', 'pass', 'qc_head', -20, 'Dye penetrant test on shell welds, no indications found.'],
  [byNo['SB-1023'], 'NDE - DP Test', 'pass', 'qc_head', -15, null],
  [byNo['SB-1024'], 'NDE - DP Test', 'fail', 'qc_head', -10, 'Linear indication found on longitudinal seam weld, re-weld required.'],
  [byNo['SB-1025'], 'Dimensional Inspection', 'pass', 'qc_head', -25, 'Shell OD/length within drawing tolerance.'],
  [byNo['SB-1018'], 'Dimensional Inspection', 'pass', 'qc_head', -18, null],
  [byNo['SB-1023'], 'Dimensional Inspection', 'pending', 'qc_head', null, 'Awaiting final assembly before measurement.'],
  [byNo['SB-1024'], 'Hydro Test', 'fail', 'qc_head', -8, 'Pressure drop observed during hold — leak at nozzle weld, repair scheduled.'],
  [byNo['SB-1025'], 'Hydro Test', 'pass', 'qc_head', -12, 'Held at test pressure per IBR, no leaks.'],
  [byNo['SB-1023'], 'Material Test Certificate', 'pending', 'qc_head', null, 'Certificate requested from steel maker, not yet received.'],
  [byNo['SB-1025'], 'Incoming Inspection', 'pass', 'qc_head', -30, 'Plate dimensions and thickness within spec.'],
];
for (const [projectId, testType, result, inspector, testedOffset, notes] of qcRecordRows) {
  await run(
    `INSERT INTO qc_records (project_id, test_type, result, inspector, tested_on, notes, created_by)
     VALUES (?,?,?,?,?,?,?)`,
    [projectId, testType, result, inspector, testedOffset === null ? null : daysFromNow(testedOffset), notes, MARK]
  );
}

console.log(`Seeded: ${calibrationItems.length} calibration items, ${jobWorkRows.length} job-work inspections, ${qcRecordRows.length} qc_records.`);
