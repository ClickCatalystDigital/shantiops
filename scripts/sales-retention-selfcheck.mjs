// node --env-file=.env.local scripts/sales-retention-selfcheck.mjs
// Runs the real eligibility SQL against an in-memory SQLite with fixtures, and (if TURSO_URL is set)
// checks the live schema for tables referencing crm_notes / lead_stage_history we don't handle.
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { cutoffDate, effectiveCutoff, normalizeRetention, RETENTION_OPTIONS, retentionLabel, eligibleQuery, RETENTION_SOURCES } from '../lib/sales-retention.mjs';

assert.equal(cutoffDate('2026-09-30', 12), '2025-09-30');
assert.equal(cutoffDate('2026-03-31', 1), '2026-02-28');
assert.equal(cutoffDate('2026-01-15', 2), '2025-11-15');
assert.equal(cutoffDate('2026-09-30', 60), '2021-09-30');
assert.equal(effectiveCutoff('2025-01-01', '2024-01-01'), '2024-01-01');
assert.deepEqual(normalizeRetention({ enabled: true, months: 7 }), { enabled: false, months: null });
assert.deepEqual(normalizeRetention({ enabled: true, months: 18 }), { enabled: true, months: 18 });
assert.equal(retentionLabel(24), '2 years'); assert.equal(retentionLabel(18), '18 months'); assert.equal(retentionLabel(1), '1 month');
assert.ok(RETENTION_OPTIONS.includes(60));

const db = createClient({ url: ':memory:' });
await db.batch([
  `CREATE TABLE leads (id INTEGER PRIMARY KEY, owner_dept TEXT)`,
  `CREATE TABLE crm_notes (id INTEGER PRIMARY KEY, lead_id INTEGER, customer_id INTEGER, opportunity_id INTEGER, visit_date TEXT, created_at TEXT, next_plan_date TEXT)`,
  `CREATE TABLE lead_stage_history (id INTEGER PRIMARY KEY, lead_id INTEGER, from_stage TEXT, to_stage TEXT, changed_by TEXT, changed_at TEXT)`,
  `INSERT INTO leads VALUES (1,'Sales'),(2,'Sales'),(3,'Marketing')`,
  // lead 1: 3 old notes -> newest old one is the lead's latest, protected; 2 older ones eligible
  `INSERT INTO crm_notes VALUES (1,1,10,NULL,'2020-01-01','2020-01-01',NULL),(2,1,10,NULL,'2020-06-01','2020-06-01',NULL),(3,1,10,NULL,'2021-01-01','2021-01-01',NULL)`,
  // lead 2: old note with a follow-up still planned -> protected; another old one -> customer 11's latest is id 5, so 4 eligible
  `INSERT INTO crm_notes VALUES (4,2,11,NULL,'2020-02-01','2020-02-01',NULL),(5,2,11,NULL,'2020-03-01','2020-03-01','2099-01-01')`,
  // marketing lead, opportunity note, note with no date at all -> never eligible
  `INSERT INTO crm_notes VALUES (6,3,12,NULL,'2019-01-01','2019-01-01',NULL),(7,NULL,NULL,5,'2019-01-01','2019-01-01',NULL),(8,NULL,13,NULL,NULL,NULL,NULL)`,
  // customer-only old note, and a recent one that supersedes it
  `INSERT INTO crm_notes VALUES (9,NULL,14,NULL,'2020-01-01','2020-01-01',NULL),(10,NULL,14,NULL,'2026-09-01','2026-09-01',NULL)`,
  `INSERT INTO lead_stage_history VALUES (1,1,NULL,'Cold','x','2020-01-01 00:00:00'),(2,1,'Cold','Hot','x','2021-01-01 00:00:00'),(3,2,NULL,'Cold','x','2020-01-01 00:00:00'),(4,3,NULL,'Cold','x','2019-01-01 00:00:00'),(5,3,'Cold','Hot','x','2019-06-01 00:00:00')`,
], 'write');
const ids = async (key, o) => { const q = eligibleQuery(key, o, `${RETENTION_SOURCES[key].alias}.id AS id`); return (await db.execute(q)).rows.map(r => Number(r.id)).sort((a, b) => a - b); };
const o = { cutoff: '2025-01-01', today: '2026-09-30' };
assert.deepEqual(await ids('crm_notes', o), [1, 2, 4, 9]);          // 3 = lead 1's latest, 5 = planned, 6/7/8 = not Sales/opp/no date, 10 supersedes 9
assert.deepEqual(await ids('lead_stage_history', o), [1]); // lead 1's older row only; lead 2's only row stays; lead 3 is Marketing
assert.deepEqual(await ids('crm_notes', { ...o, maxId: 2 }), [1, 2]);   // a backup's max id caps the delete
const early = await ids('crm_notes', { ...o, cutoff: '2020-03-01' });
assert.ok(early.every(id => [1, 2, 4, 9].includes(id)) && early.length < 4); // a shorter cutoff never widens the set
const cnt = (await db.execute(eligibleQuery('crm_notes', o))).rows[0];
assert.equal(Number(cnt.n), 4); assert.equal(cnt.oldest, '2020-01-01');

if (process.env.TURSO_URL) {
  const live = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  const tables = (await live.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map(r => r.name);
  const handled = { crm_notes: ['crm_note_files'], lead_stage_history: [] };
  for (const t of tables) {
    const fks = (await live.execute(`PRAGMA foreign_key_list(${t})`)).rows;
    for (const fk of fks) if (handled[fk.table] && !handled[fk.table].includes(t)) throw new Error(`${t} references ${fk.table} but retention doesn't handle it`);
  }
  console.log('live FK check: ok');
}
console.log('sales-retention selfcheck: ok');
