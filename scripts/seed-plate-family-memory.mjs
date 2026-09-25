// Seeds one deliberate family-memory confirmation for alias="plate", moc="ms" — replicates
// lib/item-link.js's recordItemLink() exactly (that file can't be imported under plain node: it
// pulls in lib/db.js, which only resolves under Next's bundler), using the same pure functions
// (memoryKeys, buildCatalogIndex) so the write is byte-identical to what a human's real "link this"
// click in the UI would produce.
//
// Why this is needed, not just the stem-unification rename (scripts/fix-ms-plate-stem-split.mjs):
// renaming stops FUTURE oscillation between the two MS PLATE/PLATES stems, but the two existing
// family-memory rows for alias="plate"+moc="ms" (item_id 2034 and 2033) each carry historical
// rejection counts from that oscillation and stay below the 0.6 trust threshold regardless of the
// rename. One fresh, deliberate confirmation — anchored to a real "MS PLATES" member, evidence-based
// (this is exactly the family the client's own PLATE SIZE: bundled rows, and every plain "PLATE"
// description elsewhere in these PMBs, belong to; CHEQUERED PLATE/BQ PLATE/SS PLATES all have their
// own distinct description-derived alias and are unaffected) — reaches trust immediately (a first
// insert has 0 rejections: confidence = (1+1)/(1+0+2) = 0.667 >= 0.6).
//
// Usage: node --env-file=.env.local scripts/seed-plate-family-memory.mjs [--apply]
import { createClient } from '@libsql/client';
import { memoryKeys, DIMENSIONAL } from '../lib/item-attributes.mjs';
import { buildCatalogIndex } from '../lib/item-match.mjs';

const apply = process.argv.includes('--apply');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const ACTOR = 'script:item-master-standardize';
const ANCHOR_ITEM_ID = 2037; // "MS PLATES 10 MM" — a real, correct member of the plain MS plate family

const line = { material_description: 'PLATE', moc: 'MS', size_spec: '10 MM THK X 500 X 1200' };
const keys = memoryKeys(line);
const catalogRows = (await db.execute('SELECT id, item_name, bom_category, uom FROM items')).rows;
const index = buildCatalogIndex(catalogRows.map(r => ({ ...r })));
const row = index.byId.get(ANCHOR_ITEM_ID);
if (!row) throw new Error(`item ${ANCHOR_ITEM_ID} not found`);

console.log(apply ? '=== Applying ===\n' : '=== DRY RUN (nothing written) ===\n');
console.log(`Anchor: id ${row.id} "${row.item_name}" (bom_category=${row.bom_category}, stem="${row._stem}")`);
console.log(`Keys: alias="${keys.alias}" moc="${keys.moc}" size="${keys.size}"`);

if (!keys.alias) throw new Error('alias is blank');
if (apply) {
  await db.execute({
    sql: `INSERT INTO item_link_memory (kind, alias_key, moc_key, size_key, item_id, approvals, updated_by)
          VALUES ('exact', ?, ?, ?, ?, 1, ?)
          ON CONFLICT(kind, alias_key, moc_key, size_key, item_id) DO UPDATE SET approvals = approvals + 1, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
    args: [keys.alias, keys.moc, keys.size, row.id, ACTOR],
  });
}
console.log(`exact: alias="${keys.alias}" moc="${keys.moc}" size="${keys.size}" -> item ${row.id}`);

if (DIMENSIONAL.includes(row.bom_category)) {
  const familyIds = [...index.byId.values()].filter(r => r.bom_category === row.bom_category && r._stem === row._stem).map(r => r.id);
  console.log(`family (stem "${row._stem}"): ${familyIds.length} member id(s): ${familyIds.join(', ')}`);
  if (familyIds.length >= 2) {
    if (apply) {
      await db.execute({
        sql: `INSERT INTO item_link_memory (kind, alias_key, moc_key, size_key, item_id, approvals, updated_by)
              VALUES ('family', ?, ?, '', ?, 1, ?)
              ON CONFLICT(kind, alias_key, moc_key, size_key, item_id) DO UPDATE SET approvals = approvals + 1, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
        args: [keys.alias, keys.moc, row.id, ACTOR],
      });
      await db.execute({
        sql: `UPDATE item_link_memory SET rejections = rejections + 1, updated_at = CURRENT_TIMESTAMP
              WHERE kind = 'family' AND alias_key = ? AND moc_key = ? AND item_id NOT IN (${familyIds.map(() => '?').join(',')})`,
        args: [keys.alias, keys.moc, ...familyIds],
      });
    }
    console.log(`family: alias="${keys.alias}" moc="${keys.moc}" -> item ${row.id} (stem "${row._stem}")`);
  }
}

if (apply) {
  await db.execute({
    sql: 'INSERT INTO usb_audit (request_id, machine_id, actor, action, detail) VALUES (NULL, NULL, ?, ?, ?)',
    args: [ACTOR, 'item_link_memory_seed', JSON.stringify({ alias: keys.alias, moc: keys.moc, anchor_item_id: row.id, anchor_name: row.item_name, reason: 'PMB harvest round — unblock alias=plate/moc=ms family confidence after the MS PLATE/PLATES stem rename' })],
  });
  console.log('\nApplied.');
}
