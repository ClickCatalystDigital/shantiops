// One-off schema migration for named boiler parts (Form IV A part-level granularity — Design plans
// a BOM/template line's named-part breakdown, Production tags which cut piece fulfills which named
// part, QC reconciles the two). Additive only, re-runnable (guards on PRAGMA table_info before each
// ALTER, DROP/CREATE INDEX IF EXISTS) — same idiom as scripts/migrate-tc-match.mjs, applied directly
// against the live Turso DB since there's no migrations folder.
//
// Run: node --env-file=.env.local scripts/migrate-named-parts.mjs
import { createClient } from '@libsql/client';
const client = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

async function run(sql) { await client.execute(sql); console.log('OK:', sql.trim().split('\n')[0]); }

async function addColumn(table, name, ddl) {
  const cols = (await client.execute(`PRAGMA table_info(${table})`)).rows.map(r => r.name);
  if (!cols.includes(name)) await run(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  else console.log(`SKIP: ${table}.${name} already exists`);
}

await addColumn('bom_items', 'named_parts_json', 'named_parts_json TEXT');
await addColumn('bom_template_items', 'named_parts_json', 'named_parts_json TEXT');
await addColumn('pr_items', 'named_parts_json', 'named_parts_json TEXT'); // write-only audit trail, same as pr_items.category_fields_json
await addColumn('stock_pieces', 'part_name', 'part_name TEXT');
await addColumn('qc_document_parts', 'stock_piece_id', 'stock_piece_id INTEGER REFERENCES stock_pieces(id)');

// Widen the qc_document_parts dedupe key: multiple named parts from one BOM line share that line's
// bom_item_id, so the old (document_id, bom_item_id) uniqueness would silently reject every named
// part after the first via syncQcPartsFromBom's INSERT OR IGNORE. NULL is distinct per-row in a
// SQLite unique index, so today's single-generic-row fallback (part_name absent) is unaffected.
await run('DROP INDEX IF EXISTS idx_qc_document_parts_doc_bom_uniq');
await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_qc_document_parts_doc_bom_part_uniq
  ON qc_document_parts(document_id, bom_item_id, part_name) WHERE bom_item_id IS NOT NULL`);

console.log('Done.');
