// Item Master standardization, PMB harvest round — 3 confirmed, manually-verified new rows.
//
// Source: 4 real client PMB files (STF-IBR-055/060/053/057), harvested via
// scripts/harvest-pmb-candidates.mjs. The raw harvest found 71 "genuinely not in catalog"
// dimensional/pipe candidates; every one was cross-checked by hand against the live catalog
// (`SELECT ... FROM items WHERE bom_category=...`) before anything here was written, because the
// harvester's own attribute-matcher has real, documented blind spots (NB+class MS pipe, and the
// whole "SEAMLESS PIPE SCH .. IBR .. MM" family, are unreachable via keyDim('pipe', ...) today —
// see the harvest report). After that check, only 3 rows survived as real, non-duplicate,
// non-ambiguous, non-bundled new catalog entries:
//
//   1. MS PLATES 3.15 MM       — from "BODY SHELL MATERIAL" (a transposed description: the PMB
//      names the *use*, not the material — real MS sheet stock, 1250x2500/1250x1500/1250x1530,
//      all 3.15mm thick). detail_desc preserves that original context per direct instruction:
//      "can we keep meta data on what are we using that MS SHEET for as a meta data?"
//   2. MS CHQEURED PLATES 3.15 MM — a real, already-self-describing "CHEQUERED PLATE" row; the
//      existing family (4/5/6/8mm) has no 3.15mm entry.
//   3. ALUMINIUM FLAT 25 MM X 1.5 MM — no ALUMINIUM FLAT family exists at all today (only
//      COPPER/GI/MS/SS flat families do).
//
// Everything else in the harvest (31 pipe rows, the rest of the plate bucket, round/square/
// channel) was excluded on real evidence, not a guess — see the harvest report / conversation for
// the per-row reasoning (already-exists-under-a-different-notation, bundled multi-value cells,
// machined components rather than raw stock, or genuinely ambiguous/no-clean-size fittings).
//
// Usage:
//   node --env-file=.env.local scripts/generate-pmb-plate-flat.mjs [--apply]
import { createClient } from '@libsql/client';
import { writeFileSync } from 'node:fs';
import { keyDim, gradeMatches } from '../lib/item-attributes.mjs';

const apply = process.argv.includes('--apply');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const CANDIDATES = [
  {
    item_name: 'MS PLATES 3.15 MM',
    group_name: 'MS PLATES',
    bom_category: 'plate',
    default_moc: 'MS',
    fields: { thickness: 3.15 },
    detail_desc: 'Also seen in PMB files as "BODY SHELL MATERIAL" — FD FAN & ID FAN casing sheet '
      + '(real sizes: 1250x2500, 1250x1500, 1250x1530, all 3.15mm thick; length/width are per-cut, '
      + 'not part of this catalog row).',
  },
  {
    item_name: 'MS CHQEURED PLATES 3.15 MM',
    group_name: 'MS CHQEURED PLATES',
    bom_category: 'plate',
    default_moc: 'MS',
    fields: { thickness: 3.15 },
    detail_desc: 'Chimney access-platform chequered plate (real sizes: 1850x1850, 2000x2000, both '
      + '3.15mm thick; length/width are per-cut, not part of this catalog row).',
  },
  {
    item_name: 'ALUMINIUM FLAT 25 MM X 1.5 MM',
    group_name: 'ALUMINIUM FLAT',
    bom_category: 'flat',
    default_moc: 'Aluminium',
    fields: { width: 25, thickness: 1.5, density: 2700 },
    detail_desc: 'Chimney flat/strip component (27 Mtr in the real PMB line).',
  },
];

async function findExistingMatch(row) {
  const key = keyDim(row.bom_category, row.item_name, 'catalog');
  if (!key) return null;
  const rows = (await db.execute({ sql: 'SELECT id, item_name FROM items WHERE bom_category = ?', args: [row.bom_category] })).rows;
  for (const r of rows) {
    if (keyDim(row.bom_category, r.item_name, 'catalog') === key && gradeMatches(row.default_moc, r.item_name) !== false) return r;
  }
  return null;
}

console.log(apply ? '=== Applying: 3 confirmed new Item Master rows ===\n' : '=== DRY RUN: 3 confirmed new Item Master rows (nothing written) ===\n');

const toCreate = [];
for (const row of CANDIDATES) {
  const existing = await findExistingMatch(row);
  if (existing) {
    console.log(`  SKIP "${row.item_name}" — already a real row: ${existing.id} "${existing.item_name}"`);
    continue;
  }
  console.log(`  CREATE "${row.item_name}"  (${row.bom_category}, moc=${row.default_moc}, fields=${JSON.stringify(row.fields)})`);
  console.log(`    detail_desc: ${row.detail_desc}`);
  toCreate.push(row);
}
console.log(`\n${toCreate.length} row(s) would be created.`);

if (apply && toCreate.length) {
  const manifest = [];
  for (const row of toCreate) {
    const { lastInsertRowid } = await db.execute({
      sql: `INSERT INTO items (item_name, group_name, category, bom_category, uom, default_moc, default_category_fields_json, default_requires_manufacturing, detail_desc)
            VALUES (?, ?, 'RAW MATERIALS', ?, 'Kgs', ?, ?, 1, ?)`,
      args: [row.item_name, row.group_name, row.bom_category, row.default_moc, JSON.stringify(row.fields), row.detail_desc],
    });
    const id = Number(lastInsertRowid);
    const itemCode = `IM-${String(id).padStart(6, '0')}`;
    await db.execute({ sql: 'UPDATE items SET item_code = ? WHERE id = ?', args: [itemCode, id] });
    manifest.push({ id, item_code: itemCode, item_name: row.item_name });
  }
  const manifestFile = `items-generated-pmb-${Date.now()}.json`;
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
  await db.execute({
    sql: 'INSERT INTO usb_audit (request_id, machine_id, actor, action, detail) VALUES (NULL, NULL, ?, ?, ?)',
    args: ['script:item-master-standardize', 'item_master_generate_pmb_candidates', JSON.stringify({ created: manifest.length, manifestFile, source: 'STF-IBR-055/060/053/057 PMB harvest' })],
  });
  console.log(`\nCreated ${manifest.length} row(s). Manifest written to ${manifestFile}.`);
} else if (apply) {
  console.log('\nNothing to apply.');
}
