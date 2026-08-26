// scripts/selfcheck-qc-iiia.mjs — runnable check for the Form III A / IV A / Mountings classifier
// and group-routing logic (lib/qc-bom-sync.js's classify()/matchIiiaGroup()). Same precedent as
// scripts/selfcheck-named-parts.mjs: the real functions pull in lib/data.js's live Turso connection,
// so the core logic is copied by hand here against an in-memory libsql DB, kept in lockstep with
// lib/qc-bom-sync.js.
//   node scripts/selfcheck-qc-iiia.mjs
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { DIMENSIONAL_CATEGORIES } from '../lib/bom-fields.mjs';

const db = createClient({ url: ':memory:' });
async function run(sql, args = []) { return db.execute({ sql, args }); }
async function all(sql, args = []) { return (await run(sql, args)).rows; }

await run(`CREATE TABLE qc_iiia_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER,
  assembly_id INTEGER, group_label TEXT, drawing_no TEXT)`);

// ---- classify() (mirrors lib/qc-bom-sync.js) ----
function classify(b) {
  if (b.category === 'standard') return 'mounting';
  if (DIMENSIONAL_CATEGORIES.includes(b.category) || b.requires_mtc) return 'material';
  if (!b.category && !b.requires_mtc) return b.moc && String(b.moc).trim() ? 'material' : 'mounting';
  return 'mounting';
}

// Test 1: a bought-out fitting (category='standard') with an MOC set is still a mounting — the
// exact bug this classifier fixes (the old moc-presence rule would have called this 'material').
assert.equal(classify({ category: 'standard', moc: 'CS', requires_mtc: 0 }), 'mounting',
  'a category=standard valve with an MOC must route to Mountings, not Form IV A');

// Test 2: a dimensional raw-material line is Form IV A material regardless of moc text.
assert.equal(classify({ category: 'plate', moc: 'SA516 Gr.70' }), 'material',
  'a dimensional (plate) line must route to Form IV A material');

// Test 3: requires_mtc=1 alone (no dimensional category) still routes to material.
assert.equal(classify({ category: '', requires_mtc: 1 }), 'material',
  'a line flagged requires_mtc must route to Form IV A material even without a dimensional category');

// Test 4: legacy row — no category, no requires_mtc — falls back to the old moc-presence rule.
assert.equal(classify({ category: null, requires_mtc: 0, moc: 'MS' }), 'material',
  'a legacy row with moc set falls back to material (old rule), for un-categorized data');
assert.equal(classify({ category: null, requires_mtc: 0, moc: '' }), 'mounting',
  'a legacy row with no moc falls back to mounting (old rule)');

// ---- matchIiiaGroup() (mirrors lib/qc-bom-sync.js, simplified — no drawing_no side effect here) ----
async function matchIiiaGroup(documentId, b) {
  if (b.assembly_id == null && !b.group_label) return null;
  const groups = await all('SELECT * FROM qc_iiia_groups WHERE document_id = ?', [documentId]);
  const g = groups.find(g => (b.assembly_id != null && g.assembly_id === b.assembly_id))
    || groups.find(g => b.group_label && g.group_label === b.group_label);
  return g ? g.id : null;
}

const { lastInsertRowid: groupId } = await run(
  `INSERT INTO qc_iiia_groups (document_id, assembly_id, group_label) VALUES (1, 42, NULL)`);

// Test 5: a material line whose assembly_id matches a group routes into that group.
assert.equal(await matchIiiaGroup(1, { assembly_id: 42, group_label: null }), Number(groupId),
  'a line matching a group by assembly_id must route into that Form III A group');

// Test 6: no assembly/group_label match -> ungrouped (Form IV A).
assert.equal(await matchIiiaGroup(1, { assembly_id: 99, group_label: null }), null,
  'a line with no matching assembly_id/group_label must stay ungrouped (Form IV A)');

// Test 7: a group keyed by group_label (PMB import band, no Engineering assembly) still matches.
await run(`INSERT INTO qc_iiia_groups (document_id, assembly_id, group_label) VALUES (1, NULL, 'FEED PIPELINE')`);
const byLabel = await matchIiiaGroup(1, { assembly_id: null, group_label: 'FEED PIPELINE' });
assert.ok(byLabel, 'a line matching a group by group_label must route into that Form III A group');

console.log('All QC III A / IV A / Mountings classifier checks passed.');
