// One-off schema migration for QC's "auto-populate/sync parts from BOM" feature. Additive only,
// re-runnable (CREATE UNIQUE INDEX IF NOT EXISTS) — same idiom as scripts/migrate-tc-match.mjs,
// applied directly against the live Turso DB since there's no migrations folder.
//
// A partial index (WHERE bom_item_id IS NOT NULL) so manually-added parts, which never carry a
// bom_item_id, are untouched by it — it only guards against the same BOM line being synced into
// the same document twice (creation-time seed racing a manual "Sync from BOM" click, or a
// double-click on Sync itself).
//
// Run: node --env-file=.env.local scripts/migrate-qc-bom-sync.mjs
import { createClient } from '@libsql/client';
const client = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

async function run(sql) { await client.execute(sql); console.log('OK:', sql.trim().split('\n')[0]); }

await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_qc_document_parts_doc_bom_uniq
  ON qc_document_parts(document_id, bom_item_id) WHERE bom_item_id IS NOT NULL`);

console.log('Done.');
