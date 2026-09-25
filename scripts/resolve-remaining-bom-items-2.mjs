// Full-rigor manual resolution pass, round 2: the "angle_channel_flat" bucket. Every link verified
// against the real catalog (ISMB/ISMC/ISA rows queried directly, not read off the top-4 fuzzy
// list). ISMB100x65/ISMB125x75 map to the catalog's own "100 X 70"/"125 X 70" rows — the catalog's
// stored flange-width digit is a documentation convention, not a second real product; ISMB is
// identified by its single real nominal depth (100/125), same "shape-defining size" principle
// keyDim() already uses everywhere else. Two genuinely missing standard flat-bar sizes (40x3mm,
// 32x3mm — the existing family only stocks 5/6mm) are created as new catalog rows: a real standard
// commercial MS flat-bar size, not a guess.
import { createClient } from '@libsql/client';

const apply = process.argv.includes('--apply');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const ACTOR = 'script:item-master-standardize';

const NEW_ITEMS = [
  { item_name: 'MS FLATE 40 X 3 MM', group_name: 'MS FLATE', bom_category: 'flat', default_moc: 'MS', fields: { width: 40, thickness: 3 } },
  { item_name: 'MS FLATE 32 X 3 MM', group_name: 'MS FLATE', bom_category: 'flat', default_moc: 'MS', fields: { width: 32, thickness: 3 } },
];

const LINKS = [
  ['ANGLE|IS 2062|ISA 50X50X5', 1919],
  ['ANGLE|IS 2062|ISA 40X40X5', 2802],
  ['MS ANGLE|MS- IS 2062|ISA 50X50X5T X 2000Lg', 1919],
  ['MS ANGLE|MS- IS 2062|ISA 50X50X5T X 6000Lg', 1919],
  ['MS CHANNEL|MS- IS 2062|ISMC100X50X5T X 3000Lg', 1928],
  ['MS CHANNEL|MS- IS 2062|ISMC100X50X5T X 6000Lg', 1928],
  ['MS FLAT FOR SAFETY RINGS|IS 2062|40 X 5T FLAT', 1946],
  ['SUPPORT ANGLE|IS 2062|ISA 40X40X5', 2802],
  ['FLANGE-FLAT|MS - IS2062|ISF50X5THK', 1947],
  ["C' CHANNEL|MS|ISMC 75", 1927],
  ['I BEAM|MS|ISMB100 x 65', 1951],
  ['I BEAM|MS|ISMB125 x 75', 1952],
  ['MS I BEAM SUPPORT COLUMN|MS|ISMC125 x 65', 1929],
  ['MS STRUCTURE SUPPORT I BEAM|MS|ISMB125 x 75 x 3000Lg', 1952],
];
// resolved via the two new items created above (looked up by name at run time)
const NEW_ITEM_LINKS = [
  ['MS FLAT|MS|40 X 3 T', 'MS FLATE 40 X 3 MM'],
  ['MS FLAT|MS|32 X 3 T', 'MS FLATE 32 X 3 MM'],
];

console.log(apply ? '=== APPLYING (round 2: angle_channel_flat) ===\n' : '=== DRY RUN (round 2: angle_channel_flat, nothing written) ===\n');

console.log('--- new items ---');
const newItemIds = {};
for (const item of NEW_ITEMS) {
  const existing = (await db.execute({ sql: 'SELECT id FROM items WHERE item_name = ?', args: [item.item_name] })).rows;
  if (existing.length) { console.log(`  SKIP "${item.item_name}" — already exists (id ${existing[0].id})`); newItemIds[item.item_name] = existing[0].id; continue; }
  console.log(`  CREATE "${item.item_name}" (${item.bom_category})`);
  if (apply) {
    const { lastInsertRowid } = await db.execute({
      sql: `INSERT INTO items (item_name, group_name, category, bom_category, uom, default_moc, default_category_fields_json)
            VALUES (?, ?, 'RAW MATERIALS', ?, 'Kgs', ?, ?)`,
      args: [item.item_name, item.group_name, item.bom_category, item.default_moc, JSON.stringify(item.fields)],
    });
    const id = Number(lastInsertRowid);
    newItemIds[item.item_name] = id;
    await db.execute({ sql: 'UPDATE items SET item_code = ? WHERE id = ?', args: [`IM-${String(id).padStart(6, '0')}`, id] });
  }
}

let linked = 0;
async function linkAll(key, itemId) {
  const [desc, moc, size] = key.split('|');
  const rows = (await db.execute({
    sql: `SELECT id, project_id FROM bom_items WHERE source='bom' AND item_id IS NULL
          AND material_description = ? AND COALESCE(moc,'') = ? AND COALESCE(size_spec,'') = ?`,
    args: [desc, moc, size],
  })).rows;
  if (!rows.length) { console.log(`  [MISS] no live row for "${desc}" | moc="${moc}" | size="${size}"`); return; }
  for (const r of rows) {
    console.log(`  #${r.id} (project ${r.project_id}) "${desc}" -> item_id ${itemId}`);
    linked++;
    if (apply) await db.execute({ sql: 'UPDATE bom_items SET item_id = ? WHERE id = ?', args: [itemId, r.id] });
  }
}

for (const [key, itemId] of LINKS) await linkAll(key, itemId);
for (const [key, name] of NEW_ITEM_LINKS) {
  const id = newItemIds[name] || (await db.execute({ sql: 'SELECT id FROM items WHERE item_name = ?', args: [name] })).rows[0]?.id;
  if (!id) { console.log(`  [MISS] new item "${name}" not resolved`); continue; }
  await linkAll(key, id);
}

console.log(`\n${linked} row(s) ${apply ? 'linked' : 'would be linked'}.`);

if (apply) {
  await db.execute({
    sql: 'INSERT INTO usb_audit (request_id, machine_id, actor, action, detail) VALUES (NULL, NULL, ?, ?, ?)',
    args: [ACTOR, 'bom_item_manual_audit_resolved', JSON.stringify({ bucket: 'angle_channel_flat', linked, newItems: Object.keys(newItemIds) })],
  });
  console.log('Applied and audited.');
}
