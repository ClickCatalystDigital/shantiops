// Seeds family-memory for the two "flat" descriptions found unresolved in the real PMB verification
// — NOT a matcher gap (keyDim('flat', ...) already finds the correct size key, e.g. f40x5), a real
// grade ambiguity: MOC is blank and two real families (MS FLATE, SS FLAT) both exist at the same
// width x thickness. "MS FLAT FOR SAFETY RINGS" literally states "MS" in its own description text
// (not the moc field) — real, unambiguous evidence for the plain MS FLATE family. "ALUMINIUM FLAT"
// states its own grade in the description too, pointing at the ALUMINIUM FLAT family created this
// same round (§ scripts/generate-pmb-plate-flat.mjs).
//
// Usage: node --env-file=.env.local scripts/seed-flat-aliases-memory.mjs [--apply]
import { createClient } from '@libsql/client';
import { memoryKeys, DIMENSIONAL } from '../lib/item-attributes.mjs';
import { buildCatalogIndex } from '../lib/item-match.mjs';

const apply = process.argv.includes('--apply');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const ACTOR = 'script:item-master-standardize';

const catalogRows = (await db.execute('SELECT id, item_name, bom_category, uom FROM items')).rows;
const index = buildCatalogIndex(catalogRows.map(r => ({ ...r })));

// moc is blank on both real lines (confirmed in the verification report) — memoryKeys' moc key must
// match exactly what the real line carries, so this seeds moc="" not moc="ms"/"aluminium".
const SEEDS = [
  { desc: 'MS FLAT FOR SAFETY RINGS', moc: '', anchorName: 'MS FLATE 32 X 5 MM' },
  { desc: 'ALUMINIUM FLAT', moc: 'ALUMINIUM', anchorName: 'ALUMINIUM FLAT 25 MM X 1.5 MM' },
];

console.log(apply ? '=== Applying ===\n' : '=== DRY RUN (nothing written) ===\n');
for (const seed of SEEDS) {
  const row = [...index.byId.values()].find(r => r.item_name === seed.anchorName);
  if (!row) { console.log(`  SKIP "${seed.desc}" — anchor "${seed.anchorName}" not found`); continue; }
  const keys = memoryKeys({ material_description: seed.desc, moc: seed.moc, size_spec: '' });
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
    args: [ACTOR, 'item_link_memory_seed', JSON.stringify({ seeds: SEEDS, reason: 'PMB harvest round — flat-family grade disambiguation' })],
  });
  console.log('\nApplied.');
}
