// Seeds family-memory confirmations for the remaining plate-family descriptions found in the real
// PMB verification pass (scripts/verify-pmb-mapping.mjs) — same exact mechanism, same evidence-based
// domain reasoning already applied to "PLATE" (scripts/seed-plate-family-memory.mjs), just extended
// to the other real descriptions that mean the same physical thing:
//   - "BODY SHELL MATERIAL" / "TUBE SHEET MATERIAL" / "SHEET" / "FIXING PLATE" -> plain MS PLATES
//     (all real, transposed-description or generic plate references — same reasoning as §5cc/§5cn's
//     already-established BODY SHELL MATERIAL fix; none of these mean chequered or a certified grade)
//   - "CHEQUERED PLATE" -> its own distinct family (MS CHQEURED PLATES), never conflated with plain
//
// Usage: node --env-file=.env.local scripts/seed-plate-aliases-memory.mjs [--apply]
import { createClient } from '@libsql/client';
import { memoryKeys, DIMENSIONAL } from '../lib/item-attributes.mjs';
import { buildCatalogIndex } from '../lib/item-match.mjs';

const apply = process.argv.includes('--apply');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const ACTOR = 'script:item-master-standardize';

const SEEDS = [
  { desc: 'BODY SHELL MATERIAL', moc: 'MS', anchorId: 2037, note: 'MS PLATES' },   // transposed description, plain plate
  { desc: 'TUBE SHEET MATERIAL', moc: 'MS', anchorId: 2037, note: 'MS PLATES' },   // same
  { desc: 'SHEET', moc: 'MS', anchorId: 2037, note: 'MS PLATES' },                 // generic bare "sheet" = plain MS plate in this domain
  { desc: 'FIXING PLATE', moc: 'MS', anchorId: 2037, note: 'MS PLATES' },          // generic fixing plate, no cert/grade implied
  { desc: 'CHEQUERED PLATE', moc: 'MS', anchorId: 1938, note: 'MS CHQEURED PLATES' }, // distinct, real chequered family
];

const catalogRows = (await db.execute('SELECT id, item_name, bom_category, uom FROM items')).rows;
const index = buildCatalogIndex(catalogRows.map(r => ({ ...r })));

console.log(apply ? '=== Applying ===\n' : '=== DRY RUN (nothing written) ===\n');
for (const seed of SEEDS) {
  const line = { material_description: seed.desc, moc: seed.moc, size_spec: '' };
  const keys = memoryKeys(line);
  const row = index.byId.get(seed.anchorId);
  if (!row) { console.log(`  SKIP "${seed.desc}" — anchor item ${seed.anchorId} not found`); continue; }
  console.log(`"${seed.desc}" (alias="${keys.alias}", moc="${keys.moc}") -> stem "${row._stem}" via anchor ${row.id} "${row.item_name}"`);
  if (!apply) continue;

  if (DIMENSIONAL.includes(row.bom_category)) {
    const familyIds = [...index.byId.values()].filter(r => r.bom_category === row.bom_category && r._stem === row._stem).map(r => r.id);
    await db.execute({
      sql: `INSERT INTO item_link_memory (kind, alias_key, moc_key, size_key, item_id, approvals, updated_by)
            VALUES ('family', ?, ?, '', ?, 1, ?)
            ON CONFLICT(kind, alias_key, moc_key, size_key, item_id) DO UPDATE SET approvals = approvals + 1, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
      args: [keys.alias, keys.moc, row.id, ACTOR],
    });
    if (familyIds.length) {
      await db.execute({
        sql: `UPDATE item_link_memory SET rejections = rejections + 1, updated_at = CURRENT_TIMESTAMP
              WHERE kind = 'family' AND alias_key = ? AND moc_key = ? AND item_id NOT IN (${familyIds.map(() => '?').join(',')})`,
        args: [keys.alias, keys.moc, ...familyIds],
      });
    }
  }
}

if (apply) {
  await db.execute({
    sql: 'INSERT INTO usb_audit (request_id, machine_id, actor, action, detail) VALUES (NULL, NULL, ?, ?, ?)',
    args: [ACTOR, 'item_link_memory_seed', JSON.stringify({ seeds: SEEDS, reason: 'PMB harvest round — remaining plate-family descriptions' })],
  });
  console.log('\nApplied.');
}
