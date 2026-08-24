// One-off schema migration for the QC TC<->BOM-item suggestion feature (see
// /Users/pujan/.claude/plans/build-a-system-suggests-sleepy-matsumoto.md). Additive only, re-runnable
// (guards on PRAGMA table_info / sqlite_master before each change) — same idiom as this repo's other
// schema evolution, applied directly against the live Turso DB since there's no migrations folder.
//
// Run: node --env-file=.env.local scripts/migrate-tc-match.mjs
import { createClient } from '@libsql/client';
const client = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

async function run(sql) { await client.execute(sql); console.log('OK:', sql.trim().split('\n')[0]); }

const cols = (await client.execute('PRAGMA table_info(qc_document_parts)')).rows.map(r => r.name);
if (!cols.includes('bom_item_id')) {
  await run('ALTER TABLE qc_document_parts ADD COLUMN bom_item_id INTEGER REFERENCES bom_items(id)');
} else {
  console.log('SKIP: qc_document_parts.bom_item_id already exists');
}

await run(`CREATE TABLE IF NOT EXISTS tc_item_match_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_spec TEXT NOT NULL,
  steel_maker TEXT NOT NULL,
  inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  approval_count INTEGER NOT NULL DEFAULT 0,
  rejection_count INTEGER NOT NULL DEFAULT 0,
  last_approved_by TEXT,
  last_approved_at DATETIME,
  UNIQUE(material_spec, steel_maker, inventory_item_id)
)`);

await run('CREATE INDEX IF NOT EXISTS idx_qc_document_parts_bom_item_id ON qc_document_parts(bom_item_id)');
await run('CREATE INDEX IF NOT EXISTS idx_bom_items_inventory_item_id ON bom_items(inventory_item_id)');

console.log('Done.');
