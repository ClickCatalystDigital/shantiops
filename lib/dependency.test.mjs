// lib/dependency.test.mjs — node --test lib/dependency.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { milestoneReadiness, projectDependencyStatus, outOfOrderFlag } from './dependency.mjs';

const rows = [
  { id: 1, milestone_key: 'release_bom', milestone_label: 'Release BOM / PR', department: 'Design', status: 'done', actual_end: '2026-08-01', depends_on_key: null },
  { id: 2, milestone_key: 'procurement_procured', milestone_label: 'Procured', department: 'Procurement', status: 'pending', actual_end: null, depends_on_key: 'release_bom' },
  { id: 3, milestone_key: 'marking_cutting', milestone_label: 'Marking, Cutting, Rolling Shell', department: 'Production', status: 'pending', actual_end: null, depends_on_key: 'procurement_procured' },
];

test('ready when predecessor is done and no signal check applies', () => {
  const r = milestoneReadiness(rows[1], rows, []);
  assert.strictEqual(r.ready, true);
  assert.strictEqual(r.blocked_by, null);
});

test('blocked structurally when predecessor is not done (checked before any signal)', () => {
  const r = milestoneReadiness(rows[2], rows, []); // procurement_procured is still pending
  assert.strictEqual(r.ready, false);
  assert.strictEqual(r.blocked_by.type, 'milestone');
  assert.strictEqual(r.blocked_by.key, 'procurement_procured');
});

test('marking_cutting blocked by live BOM signal even once predecessor is done', () => {
  const readyRows = rows.map(r => (r.id === 2 ? { ...r, status: 'done', actual_end: '2026-08-05' } : r));
  const bomItems = [{ purchase_status: 'Transit' }];
  const r = milestoneReadiness(readyRows[2], readyRows, bomItems);
  assert.strictEqual(r.ready, false);
  assert.strictEqual(r.blocked_by.type, 'signal');
});

test('marking_cutting ready once every BOM item has reached Received or later', () => {
  const readyRows = rows.map(r => (r.id === 2 ? { ...r, status: 'done', actual_end: '2026-08-05' } : r));
  const bomItems = [{ purchase_status: 'Received' }, { purchase_status: 'In-Stock' }];
  const r = milestoneReadiness(readyRows[2], readyRows, bomItems);
  assert.strictEqual(r.ready, true);
  assert.strictEqual(r.blocked_by, null);
});

test('marking_cutting with no BOM at all is not blocked on the signal (nothing to block on)', () => {
  const readyRows = rows.map(r => (r.id === 2 ? { ...r, status: 'done', actual_end: '2026-08-05' } : r));
  const r = milestoneReadiness(readyRows[2], readyRows, []);
  assert.strictEqual(r.ready, true);
});

test('an already-done milestone is always ready, dependency or not', () => {
  const doneRows = rows.map(r => ({ ...r, status: 'done', actual_end: '2026-08-01' }));
  const r = milestoneReadiness(doneRows[2], doneRows, []);
  assert.strictEqual(r.ready, true);
});

test('missing depends_on_key target (stale/renamed key) does not crash', () => {
  const r = milestoneReadiness({ ...rows[1], depends_on_key: 'nonexistent_key' }, rows, []);
  assert.strictEqual(r.ready, true); // predecessor not found -> nothing to block on
});

test('projectDependencyStatus returns one entry per row, same order', () => {
  const out = projectDependencyStatus(rows, []);
  assert.strictEqual(out.length, 3);
  assert.deepStrictEqual(out.map(o => o.milestone_key), rows.map(r => r.milestone_key));
});

test('outOfOrderFlag: null when a milestone finished in the correct order', () => {
  const inOrder = rows.map(r => ({ ...r, status: 'done', actual_end: '2026-08-01' }));
  assert.strictEqual(outOfOrderFlag(inOrder[2], inOrder), null);
});

test('outOfOrderFlag: flags a milestone done while its predecessor is not', () => {
  const skipped = rows.map(r => (r.id === 3 ? { ...r, status: 'done', actual_end: '2026-08-02' } : r));
  const flag = outOfOrderFlag(skipped[2], skipped); // marking_cutting done, procurement_procured still pending
  assert.strictEqual(flag.type, 'milestone');
  assert.strictEqual(flag.key, 'procurement_procured');
});

test('outOfOrderFlag: null for a not-yet-done milestone (that is blocked_by\'s job, not this one\'s)', () => {
  assert.strictEqual(outOfOrderFlag(rows[2], rows), null); // marking_cutting is still pending, not done
});

test('outOfOrderFlag: null with no depends_on_key', () => {
  const noDep = { ...rows[0], status: 'done', actual_end: '2026-08-01', depends_on_key: null };
  assert.strictEqual(outOfOrderFlag(noDep, rows), null);
});

test('projectDependencyStatus includes out_of_order alongside ready/blocked_by', () => {
  const skipped = rows.map(r => (r.id === 3 ? { ...r, status: 'done', actual_end: '2026-08-02' } : r));
  const out = projectDependencyStatus(skipped, []);
  assert.strictEqual(out[2].out_of_order.key, 'procurement_procured');
  assert.strictEqual(out[2].ready, true); // done-short-circuit still applies to readiness itself
});
