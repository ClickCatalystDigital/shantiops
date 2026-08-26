// One-off schema migration for Form III A groups (real client sample SB-1097 — a III A sheet is a
// per-named-sub-assembly certificate, e.g. "Feed pipeline", distinct from Form IV A's full parts
// table). Additive only, re-runnable (guards on PRAGMA table_info before each ALTER) — same idiom as
// scripts/migrate-named-parts.mjs, applied directly against the live Turso DB since there's no
// migrations folder.
//
// Run: node --env-file=.env.local scripts/migrate-qc-iiia-groups.mjs
import { createClient } from '@libsql/client';
const client = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

async function run(sql) { await client.execute(sql); console.log('OK:', sql.trim().split('\n')[0]); }

async function addColumn(table, name, ddl) {
  const cols = (await client.execute(`PRAGMA table_info(${table})`)).rows.map(r => r.name);
  if (!cols.includes(name)) await run(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  else console.log(`SKIP: ${table}.${name} already exists`);
}

await run(`CREATE TABLE IF NOT EXISTS qc_iiia_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES qc_documents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  assembly_id INTEGER REFERENCES bom_assemblies(id),
  group_label TEXT,
  design_pressure TEXT,
  design_temp TEXT,
  hydro_test_pressure TEXT,
  hydro_test_date TEXT,
  process_of_manufacture TEXT,
  mode_of_flange_attachment TEXT,
  flange_particulars TEXT,
  size_of_branch TEXT,
  heat_treatment TEXT,
  identification_marks TEXT,
  drawing_no TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
)`);
await run(`CREATE INDEX IF NOT EXISTS idx_qc_iiia_groups_document ON qc_iiia_groups(document_id)`);

await addColumn('qc_document_parts', 'iiia_group_id', 'iiia_group_id INTEGER REFERENCES qc_iiia_groups(id)');

console.log('Done.');
