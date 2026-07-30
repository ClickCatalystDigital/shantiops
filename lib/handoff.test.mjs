// lib/handoff.test.mjs — node --test lib/handoff.test.mjs. No framework, no fixtures, no config.
//
// The department sequence is inlined rather than imported from lib/milestones.js: that file uses
// ESM `export` syntax with no "type":"module" in package.json, so a plain node import of it
// reparses with a noisy MODULE_TYPELESS_PACKAGE_JSON warning on every run. Inlining keeps this
// file dependency-free — it must still match MILESTONE_TEMPLATE's department column exactly.
import test from 'node:test';
import assert from 'node:assert';
import { handoffTarget, nextBySortOrder } from './handoff.mjs';

const DEPARTMENTS_IN_ORDER = [
  'Design', 'Design', 'Design', 'Design',                                   // 0-3
  'Procurement', 'Procurement', 'Procurement', 'Procurement', 'Procurement', // 4-8
  'Production', 'Production', 'Production', 'Production', 'Production',     // 9-13
  'Production', 'Production', 'Production', 'Production', 'Production',     // 14-18
  'QC',                                                                     // 19
  'Production', 'Production',                                              // 20-21
  'Dispatch',                                                               // 22
  'Installation', 'Installation',                                          // 23-24
];

const rows = DEPARTMENTS_IN_ORDER.map((department, i) => ({ id: i + 1, sort_order: i, department }));

test('fires exactly at the 6 department boundaries', () => {
  const fired = rows.filter(r => handoffTarget(rows, r)).map(r => r.sort_order);
  assert.deepStrictEqual(fired, [3, 8, 18, 19, 21, 22]);
});

test('QC(19) -> Production(20): next department is not monotonic', () => {
  assert.strictEqual(handoffTarget(rows, rows[19]).department, 'Production');
});

test('mid-run and last milestone produce nothing', () => {
  assert.strictEqual(handoffTarget(rows, rows[10]), null);   // Production -> Production
  assert.strictEqual(handoffTarget(rows, rows[24]), null);   // end of chain
});

test('PM-reassigned department is honoured over the template', () => {
  const edited = rows.map(r => (r.sort_order === 20 ? { ...r, department: 'Dispatch' } : r));
  assert.strictEqual(handoffTarget(edited, edited[19]).department, 'Dispatch');
});

test('a blank department on either side is a no-op, not a crash', () => {
  assert.strictEqual(handoffTarget(rows, { ...rows[3], department: null }), null);
  const blanked = rows.map(r => (r.sort_order === 4 ? { ...r, department: null } : r));
  assert.strictEqual(handoffTarget(blanked, blanked[3]), null);
});

test('sort_order ties break on id', () => {
  const tied = [{ id: 1, sort_order: 0, department: 'A' }, { id: 2, sort_order: 0, department: 'B' }];
  assert.strictEqual(nextBySortOrder(tied, tied[0]).id, 2);
});
