// scripts/traceability-flags-selfcheck.mjs — runnable check for Inventory Identity & Traceability,
// Phase 1 (bom_items.requires_heat_no/requires_mtc/requires_supplier_batch/requires_serial_no,
// items.default_requires_*, the receipt-time presence gate, the release-freeze guard, and the
// drawing-revision snapshot). Same precedent as scripts/remnant-cutting-selfcheck.mjs: the real
// logic lives in ESM .js only loadable through Next's bundler, so the gate/guard functions are
// mirrored here by hand, kept in lockstep, over an in-memory libsql DB with synthetic fixtures.
//   node scripts/traceability-flags-selfcheck.mjs
import assert from 'node:assert';
import { createClient } from '@libsql/client';

const db = createClient({ url: ':memory:' });
async function run(sql, args = []) { return db.execute({ sql, args }); }
async function one(sql, args = []) { return (await run(sql, args)).rows[0]; }

await run(`CREATE TABLE projects (id INTEGER PRIMARY KEY, project_no TEXT, bom_release_revision INTEGER DEFAULT 0)`);
await run(`CREATE TABLE milestones (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, milestone_key TEXT, status TEXT, actual_end DATETIME)`);
await run(`CREATE TABLE calc_drawings (id INTEGER PRIMARY KEY, project_id INTEGER, name TEXT, revision TEXT)`);
await run(`CREATE TABLE items (
  id INTEGER PRIMARY KEY, item_name TEXT, group_name TEXT,
  default_requires_heat_no INTEGER DEFAULT 0, default_requires_mtc INTEGER DEFAULT 0,
  default_requires_supplier_batch INTEGER DEFAULT 0, default_requires_serial_no INTEGER DEFAULT 0
)`);
await run(`CREATE TABLE test_certificates (id INTEGER PRIMARY KEY, certificate_no TEXT)`);
await run(`CREATE TABLE bom_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, drawing_id INTEGER, item_id INTEGER,
  released_at_revision INTEGER, drawing_revision_at_release TEXT, purchase_status TEXT DEFAULT 'Enquiry',
  requires_heat_no INTEGER DEFAULT 0, requires_mtc INTEGER DEFAULT 0,
  requires_supplier_batch INTEGER DEFAULT 0, requires_serial_no INTEGER DEFAULT 0,
  received_heat_no TEXT, received_mtc_no TEXT, received_supplier_batch_no TEXT, received_serial_no TEXT
)`);
await run(`CREATE TABLE stock_pieces (id INTEGER PRIMARY KEY AUTOINCREMENT, inventory_item_id INTEGER, heat_no TEXT, test_certificate_id INTEGER)`);

// ---- A1.1 / A1.2: receivePiece()'s presence gate (mirrors lib/stock-pieces.js) ----
async function receivePiece({ bomItemId, heat_no, test_certificate_id }) {
  if (test_certificate_id) {
    const cert = await one('SELECT id FROM test_certificates WHERE id = ?', [test_certificate_id]);
    if (!cert) throw new Error('Test certificate not found');
  }
  if (bomItemId) {
    const bomItem = await one('SELECT requires_heat_no, requires_mtc FROM bom_items WHERE id = ?', [bomItemId]);
    if (bomItem?.requires_heat_no && !String(heat_no || '').trim()) {
      throw new Error('This requirement needs a heat number before it can be received');
    }
    if (bomItem?.requires_mtc && !test_certificate_id) {
      throw new Error('This requirement needs an MTC/certificate before it can be received');
    }
  }
  return { ok: true };
}

await run(`INSERT INTO projects (id, project_no) VALUES (1, 'SB-1001')`);
await run(`INSERT INTO test_certificates (id, certificate_no) VALUES (1, 'MTC-8821')`);
await run(`INSERT INTO bom_items (id, project_id, requires_heat_no) VALUES (1, 1, 1)`);
await run(`INSERT INTO bom_items (id, project_id, requires_mtc) VALUES (2, 1, 1)`);

{
  await assert.rejects(() => receivePiece({ bomItemId: 1, heat_no: '' }), /heat number/, 'requires_heat_no=1 with empty heat must reject');
  await assert.doesNotReject(() => receivePiece({ bomItemId: 1, heat_no: 'H45821' }), 'requires_heat_no=1 with a real heat must pass');
}
console.log('presence gate — heat: ok (A1.1)');

{
  await assert.rejects(() => receivePiece({ bomItemId: 2, test_certificate_id: null }), /MTC/, 'requires_mtc=1 with no cert must reject');
  await assert.rejects(() => receivePiece({ bomItemId: 2, test_certificate_id: 999 }), /not found/, 'requires_mtc=1 with a non-existent cert id must reject');
  await assert.doesNotReject(() => receivePiece({ bomItemId: 2, test_certificate_id: 1 }), 'requires_mtc=1 with a real cert must pass');
}
console.log('presence gate — MTC FK: ok (A1.2)');

{
  // Explicitly NOT checked: that the cert's own chemistry/heat matches this piece. Presence + FK
  // existence only (18.2) — asserting the boundary itself, not just the passing cases above.
  const result = await receivePiece({ bomItemId: 2, test_certificate_id: 1, heat_no: 'WRONG-HEAT-ON-PURPOSE' });
  assert.ok(result.ok, 'Phase 1 never cross-validates cert content against the piece — presence/FK only, by design');
}
console.log('presence gate — integrity boundary confirmed (18.2): ok');

// ---- A1.5: a line with all four flags 0 behaves exactly as before ----
{
  await run(`INSERT INTO bom_items (id, project_id) VALUES (3, 1)`);
  await assert.doesNotReject(() => receivePiece({ bomItemId: 3, heat_no: '', test_certificate_id: null }), 'no flags set must never gate anything');
}
console.log('no-regression (all flags 0): ok (A1.5)');

// ---- A1.3: default-seeding (mirrors components/PrWorkspace.jsx's pure helpers) ----
const DIMENSIONAL_CATEGORIES = ['plate', 'flat', 'round', 'square', 'octagonal', 'angle', 'beam', 'channel', 'tee'];
function defaultTraceabilityFromItem(item) {
  const any = item.default_requires_heat_no || item.default_requires_mtc || item.default_requires_supplier_batch || item.default_requires_serial_no;
  if (!any) return null;
  return {
    requires_heat_no: !!item.default_requires_heat_no, requires_mtc: !!item.default_requires_mtc,
    requires_supplier_batch: !!item.default_requires_supplier_batch, requires_serial_no: !!item.default_requires_serial_no,
  };
}
function defaultTraceabilityFromCategory(category) {
  return DIMENSIONAL_CATEGORIES.includes(category)
    ? { requires_heat_no: true, requires_mtc: true, requires_supplier_batch: false, requires_serial_no: false }
    : { requires_heat_no: false, requires_mtc: false, requires_supplier_batch: false, requires_serial_no: false };
}

{
  // Catalog item with its own default set — wins outright, category is irrelevant.
  const itemWithDefault = { default_requires_heat_no: 0, default_requires_mtc: 0, default_requires_supplier_batch: 1, default_requires_serial_no: 0 };
  const seeded = defaultTraceabilityFromItem(itemWithDefault) || defaultTraceabilityFromCategory('bolt');
  assert.deepStrictEqual(seeded, { requires_heat_no: false, requires_mtc: false, requires_supplier_batch: true, requires_serial_no: false },
    'item-master default must win over category fallback when the item has any default set');

  // Catalog item with no defaults at all — falls back to category (dimensional -> heat+mtc).
  const itemNoDefault = { default_requires_heat_no: 0, default_requires_mtc: 0, default_requires_supplier_batch: 0, default_requires_serial_no: 0 };
  const fellBack = defaultTraceabilityFromItem(itemNoDefault) || defaultTraceabilityFromCategory('plate');
  assert.deepStrictEqual(fellBack, { requires_heat_no: true, requires_mtc: true, requires_supplier_batch: false, requires_serial_no: false },
    'an item with zero defaults must fall back to the category default, not silently stay all-false');

  // Free-text line, non-dimensional category -> all off.
  const freeText = defaultTraceabilityFromCategory('standard');
  assert.deepStrictEqual(freeText, { requires_heat_no: false, requires_mtc: false, requires_supplier_batch: false, requires_serial_no: false },
    'a non-dimensional category must default to no requirements');
}
console.log('default-seeding (item > category > none): ok (A1.3)');

// ---- A1.4: release-freeze guard (mirrors app/api/bom-items/[id]/route.js) ----
async function assertNotFrozen(bomItemId) {
  const item = await one('SELECT project_id FROM bom_items WHERE id = ?', [bomItemId]);
  const milestone = await one(`SELECT actual_end, status FROM milestones WHERE project_id = ? AND milestone_key = 'release_bom'`, [item.project_id]);
  const released = !!(milestone?.actual_end || milestone?.status === 'done');
  if (released) throw new Error('Traceability requirements are frozen — reopen Release BOM to change them');
}

{
  await run(`INSERT INTO milestones (project_id, milestone_key, status, actual_end) VALUES (1, 'release_bom', 'done', CURRENT_TIMESTAMP)`);
  await assert.rejects(() => assertNotFrozen(1), /frozen/, 'editing a requires_* flag on a released line must reject');

  // Un-release (mirrors POST /api/milestones/[id]/reopen): clears actual_end + status, but never
  // touches bom_items.released_at_revision — confirming the guard must check the LIVE milestone,
  // not that persistent column, or a reopened project would stay incorrectly frozen forever.
  await run(`UPDATE bom_items SET released_at_revision = 1 WHERE project_id = 1`);
  await run(`UPDATE milestones SET actual_end = NULL, status = 'in_progress' WHERE project_id = 1 AND milestone_key = 'release_bom'`);
  await assert.doesNotReject(() => assertNotFrozen(1), 'after un-release, editing must be allowed again even though released_at_revision is still stamped');
  const stillStamped = await one('SELECT released_at_revision FROM bom_items WHERE project_id = 1 LIMIT 1');
  assert.strictEqual(stillStamped.released_at_revision, 1, 'released_at_revision is confirmed NOT cleared by reopen — the live-milestone check is what makes the guard correct');
}
console.log('release-freeze guard (checks live milestone, not the persistent column): ok (A1.4)');

// ---- A1.6: drawing-revision snapshot survives a later drawing revision ----
{
  await run(`INSERT INTO calc_drawings (id, project_id, name, revision) VALUES (10, 1, 'GA Drawing', 'R2')`);
  await run(`INSERT INTO bom_items (id, project_id, drawing_id) VALUES (4, 1, 10)`);
  // Release: stamp the snapshot from the drawing's revision at that instant (mirrors the
  // release-bom route's correlated UPDATE).
  await run(
    `UPDATE bom_items SET drawing_revision_at_release = (SELECT revision FROM calc_drawings WHERE calc_drawings.id = bom_items.drawing_id)
      WHERE project_id = 1 AND drawing_id IS NOT NULL`
  );
  let line = await one('SELECT drawing_revision_at_release FROM bom_items WHERE id = 4');
  assert.strictEqual(line.drawing_revision_at_release, 'R2', 'snapshot must capture the revision in force at release time');

  // Drawing is later bumped to R3 — the already-released line must still report R2.
  await run(`UPDATE calc_drawings SET revision = 'R3' WHERE id = 10`);
  line = await one('SELECT drawing_revision_at_release FROM bom_items WHERE id = 4');
  assert.strictEqual(line.drawing_revision_at_release, 'R2', 'a later drawing revision must never silently rewrite an already-released line\'s snapshot');

  // The display query's COALESCE(snapshot, live) — mirrors lib/data.js's getProjectBom.
  const displayed = await one(
    `SELECT COALESCE(b.drawing_revision_at_release, dw.revision) AS drawing_revision
       FROM bom_items b LEFT JOIN calc_drawings dw ON dw.id = b.drawing_id WHERE b.id = 4`
  );
  assert.strictEqual(displayed.drawing_revision, 'R2', 'the display query must prefer the frozen snapshot once one exists');

  // An unreleased line (no snapshot yet) must still show the live current revision.
  await run(`INSERT INTO bom_items (id, project_id, drawing_id) VALUES (5, 1, 10)`);
  const unreleased = await one(
    `SELECT COALESCE(b.drawing_revision_at_release, dw.revision) AS drawing_revision
       FROM bom_items b LEFT JOIN calc_drawings dw ON dw.id = b.drawing_id WHERE b.id = 5`
  );
  assert.strictEqual(unreleased.drawing_revision, 'R3', 'an unreleased line has no snapshot yet, so it must still track the live revision');
}
console.log('drawing-revision snapshot: ok (A1.6)');

// =====================================================================================
// A1.7 — the free-text GRN path (bom_items.purchase_status -> 'Received') must be gated
// too, not just the piece-tracked receivePiece() path. Gap found in review, 2026-08-26:
// this is the DOMINANT real-world receiving path and had zero enforcement.
// =====================================================================================
async function patchGate(item, changed) {
  if (changed.purchase_status === 'Received' && item.purchase_status !== 'Received') {
    const effective = f => (f in changed ? changed[f] : item[f]);
    const missing = [];
    if (item.requires_heat_no && !String(effective('received_heat_no') || '').trim()) missing.push('a heat number');
    if (item.requires_mtc && !String(effective('received_mtc_no') || '').trim()) missing.push('an MTC/certificate number');
    if (item.requires_supplier_batch && !String(effective('received_supplier_batch_no') || '').trim()) missing.push('a supplier batch number');
    if (item.requires_serial_no && !String(effective('received_serial_no') || '').trim()) missing.push('a serial number');
    if (missing.length) throw new Error(`Can't mark Received — this line needs ${missing.join(', ')} first`);
  }
  return { ok: true };
}

{
  await run(`INSERT INTO bom_items (id, project_id, purchase_status, requires_heat_no, requires_mtc) VALUES (10, 1, 'Ordered', 1, 1)`);
  const line = await one('SELECT * FROM bom_items WHERE id = 10');

  // Marking Received with no received_* fields at all must reject.
  await assert.rejects(() => patchGate(line, { purchase_status: 'Received' }), /heat number.*MTC|MTC.*heat number/,
    'a flagged line reaching Received with nothing captured must reject and name every missing field');

  // Marking Received with only ONE of the two required fields must still reject.
  await assert.rejects(() => patchGate(line, { purchase_status: 'Received', received_heat_no: 'H-777' }), /MTC/,
    'partially satisfying the requirement must still reject on the remaining gap');

  // Supplying both required fields IN THE SAME REQUEST (the real Stores UI flow — one PATCH sets
  // purchase_status and the received_* fields together) must succeed.
  await assert.doesNotReject(
    () => patchGate(line, { purchase_status: 'Received', received_heat_no: 'H-777', received_mtc_no: 'MTC-9001' }),
    'supplying purchase_status and the required fields in one request must be accepted'
  );

  // A line that already HAS the field captured from an earlier PATCH (not resent in this request)
  // must resolve via the stored value, not just what this specific request body carries.
  await run(`UPDATE bom_items SET received_heat_no = 'H-777', received_mtc_no = 'MTC-9001' WHERE id = 10`);
  const withStored = await one('SELECT * FROM bom_items WHERE id = 10');
  await assert.doesNotReject(() => patchGate(withStored, { purchase_status: 'Received' }),
    'a previously-captured received_* value must satisfy the gate even if this request only sends purchase_status');

  // An unflagged line must behave exactly as before this fix — zero change.
  await run(`INSERT INTO bom_items (id, project_id, purchase_status) VALUES (11, 1, 'Ordered')`);
  const plain = await one('SELECT * FROM bom_items WHERE id = 11');
  await assert.doesNotReject(() => patchGate(plain, { purchase_status: 'Received' }),
    'a line with no requires_* flags must reach Received exactly as before, no regression');

  // Re-saving an already-Received row (no transition) must never re-check, even if a flag is unmet —
  // matches every other guard in this route's own "only fire on the transition" idiom.
  await run(`INSERT INTO bom_items (id, project_id, purchase_status, requires_heat_no) VALUES (12, 1, 'Received', 1)`);
  const already = await one('SELECT * FROM bom_items WHERE id = 12');
  await assert.doesNotReject(() => patchGate(already, { grn_qty_text: '5 Nos' }),
    'a re-save of an already-Received row must not re-trigger the gate on an unrelated field edit');
}
console.log('GRN-path receiving gate (the dominant real-world path, not just receivePiece()): ok (A1.7)');

console.log('\nAll Phase 1 traceability-flag self-checks passed.');
