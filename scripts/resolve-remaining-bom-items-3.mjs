// Full-rigor manual resolution pass, round 3: the "round_bar" bucket. Two real catalog gaps found
// by checking the FULL catalog (not just the top-4 fuzzy list, which only ever offered the wrong
// plain-MS-ROD family): a dedicated "MS EN-8 ROD" family exists (753-763) but skips 100mm — a real
// alloy-steel shaft, not generic mild steel, so it must not be substituted with plain MS ROD 100mm;
// and there is no SS ROD family at all. Both new items use the same round-bar weight formula
// (π/4 × d² × density / 1e6 kg/m) the existing family already follows — EN-8's own density matches
// plain carbon steel (7850 kg/m³): 0.7854 × 0.1² × 7850 = 61.65 kg/m, which is not a coincidence —
// it exactly matches the plain MS ROD 100mm entry's own stated weight, confirming the formula.
// Three bundled "two diameters in one cell" SHAFT/SQUARE-ROD rows are decomposed by hand into their
// real constituent pieces (this notation — "ø100 x 115 Lg/ 63dia 900 lg" — isn't the "TH x W x L -
// qty unit" shape splitLabeledSizeList() parses, so it's split explicitly here, not reused).
import { createClient } from '@libsql/client';

const apply = process.argv.includes('--apply');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const ACTOR = 'script:item-master-standardize';

const NEW_ITEMS = [
  { item_name: 'MS EN-8 ROD 100 MM (1 MTR 61.65 KGS)', group_name: 'MS EN-8 ROD', bom_category: 'round', default_moc: 'EN-8', fields: { diameter: 100, density: 7850 } },
  { item_name: 'SS ROD 16 MM (1 MTR 1.61 KGS)', group_name: 'SS ROD', bom_category: 'round', default_moc: 'SS', fields: { diameter: 16, density: 8000 } },
];

const LINKS = [
  ['SHAFT|EN-8|ø100 x 115 Lg', 'MS EN-8 ROD 100 MM (1 MTR 61.65 KGS)'],
  ['SHAFT|MS|DIA 20 x 1650Lg.', 2065],
  ['STAINLESS ROD|SS|16 MM X 2050 Lg', 'SS ROD 16 MM (1 MTR 1.61 KGS)'],
];

// [key, [{size, qty, itemId}]] — decompose one bundled row into its real pieces
const DECOMPOSE = [
  ['MS SQUARE ROD (MH & MUD HOLE)||65X65-400Lg 50X50-240Lg', [
    { size: '65X65-400Lg', qty: '2 Nos', itemId: 2467 },
    { size: '50X50-240Lg', qty: '3 Nos', itemId: 2466 },
  ]],
  ['SHAFT|EN-8|ø100 x 115 Lg/ 63dia 900 lg', [
    { size: 'ø100 x 115 Lg', qty: '1 No', itemId: 'MS EN-8 ROD 100 MM (1 MTR 61.65 KGS)' },
    { size: '63dia 900 lg', qty: '1 No', itemId: 757 },
  ]],
  ['SHAFT|EN-8|ø63 x 900 Lg ø100 x 115 Lg', [
    { size: 'ø63 x 900 Lg', qty: '1 No', itemId: 757 },
    { size: 'ø100 x 115 Lg', qty: '1 No', itemId: 'MS EN-8 ROD 100 MM (1 MTR 61.65 KGS)' },
  ]],
  ['SHAFT|EN-8|ø70 x 1000 Lg ø120 x 120 Lg', [
    { size: 'ø70 x 1000 Lg', qty: '1 No', itemId: 758 },
    { size: 'ø120 x 120 Lg', qty: '1 No', itemId: 762 },
  ]],
];

console.log(apply ? '=== APPLYING (round 3: round_bar) ===\n' : '=== DRY RUN (round 3: round_bar, nothing written) ===\n');

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
function resolveId(x) { return typeof x === 'string' ? newItemIds[x] : x; }

const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();

let linked = 0;
async function findRows(key) {
  const [desc, moc, size] = key.split('|');
  // real PMB cells carry irregular internal whitespace padding (varies row to row even for the
  // identical real spec) — match on the normalized text, never raw byte-equality, for these.
  const candidates = (await db.execute({
    sql: `SELECT id, project_id, size_spec, moc FROM bom_items WHERE source='bom' AND item_id IS NULL
          AND material_description = ? AND project_id IN (248,249,250,281,282,283)`,
    args: [desc],
  })).rows;
  return candidates.filter(r => norm(r.moc) === norm(moc) && norm(r.size_spec) === norm(size));
}

for (const [key, itemIdOrName] of LINKS) {
  const itemId = resolveId(itemIdOrName);
  const rows = await findRows(key);
  if (!rows.length) { console.log(`  [MISS] no live row for "${key}"`); continue; }
  for (const r of rows) {
    console.log(`  #${r.id} (project ${r.project_id}) -> item_id ${itemId}`);
    linked++;
    if (apply) await db.execute({ sql: 'UPDATE bom_items SET item_id = ? WHERE id = ?', args: [itemId, r.id] });
  }
}

let decomposed = 0, deleted = 0;
for (const [key, pieces] of DECOMPOSE) {
  const rows = await findRows(key);
  if (!rows.length) { console.log(`  [MISS] no live row for decompose "${key}"`); continue; }
  const [desc, moc] = key.split('|');
  for (const row0 of rows) {
    const row = (await db.execute({ sql: 'SELECT * FROM bom_items WHERE id = ?', args: [row0.id] })).rows[0];
    console.log(`  decompose #${row.id} (project ${row.project_id}) into ${pieces.length} piece(s):`);
    for (const p of pieces) {
      const itemId = resolveId(p.itemId);
      console.log(`      insert: "${desc}" ${p.size} qty="${p.qty}" -> item_id ${itemId}`);
      decomposed++;
      if (apply) {
        await db.execute({
          sql: `INSERT INTO bom_items (project_id, section, group_label, assembly_id, material_description, category, moc,
                size_spec, make, qty_text, purchase_status, source, import_id, item_id, pending_review)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          args: [row.project_id, row.section, row.group_label, row.assembly_id, row.material_description, 'round',
                 row.moc, p.size, row.make, p.qty, row.purchase_status, row.source, row.import_id, itemId, row.pending_review],
        });
      }
    }
    console.log(`  delete original bundle row #${row.id}`);
    deleted++;
    if (apply) await db.execute({ sql: 'DELETE FROM bom_items WHERE id = ?', args: [row.id] });
  }
}

console.log(`\n${linked} row(s) ${apply ? 'linked' : 'would be linked'}. ${decomposed} decomposed piece(s), ${deleted} bundle row(s) removed.`);

if (apply) {
  await db.execute({
    sql: 'INSERT INTO usb_audit (request_id, machine_id, actor, action, detail) VALUES (NULL, NULL, ?, ?, ?)',
    args: [ACTOR, 'bom_item_manual_audit_resolved', JSON.stringify({ bucket: 'round_bar', linked, decomposed, deleted, newItems: Object.keys(newItemIds) })],
  });
  console.log('Applied and audited.');
}
