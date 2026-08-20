// lib/qc-inspections-selfcheck.mjs — runnable check for lib/qc-inspections.mjs (STERP items 33-35,
// §5p). Mirrors lib/bom-structure-selfcheck.mjs's precedent.
//   node lib/qc-inspections-selfcheck.mjs
import assert from 'node:assert';
import { jobWorkVariance, calibrationStatus } from './qc-inspections.mjs';

function selfcheck() {
  // --- Job-Work Inspection variance (STERP item 33) ---
  assert.strictEqual(jobWorkVariance(100, 95), 5, 'sent minus received');
  assert.strictEqual(jobWorkVariance(100, 100), 0, 'no shortfall');
  assert.strictEqual(jobWorkVariance(100, null), null, 'not yet received — no variance to report');
  assert.strictEqual(jobWorkVariance(null, null), null);

  // --- Calibration due/expired/blocked status (STERP items 34/35) ---
  const today = '2026-08-20';
  const soon = '2026-09-19'; // +30 days
  assert.strictEqual(calibrationStatus({ due_date: '2026-07-01', blocked: 0 }, today, soon), 'expired');
  assert.strictEqual(calibrationStatus({ due_date: '2026-09-01', blocked: 0 }, today, soon), 'due_soon');
  assert.strictEqual(calibrationStatus({ due_date: '2027-01-01', blocked: 0 }, today, soon), 'ok');
  assert.strictEqual(calibrationStatus({ due_date: null, blocked: 0 }, today, soon), 'ok', 'no due date means nothing to be overdue against');
  assert.strictEqual(calibrationStatus({ due_date: '2026-07-01', blocked: 1 }, today, soon), 'blocked', 'manual block always wins over the date');

  console.log('lib/qc-inspections.mjs self-check: all assertions passed.');
}

selfcheck();
