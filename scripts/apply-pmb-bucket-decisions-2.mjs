// Round 2: the remaining 232 distinct unresolved items, fully classified. Applies Bucket 1 (proven
// existing-item mappings, exact-memory) + Bucket 2 (1 new item: a real, well-precedented missing
// size in the already-established BS 3059 PT.1 boiler-tube family, referenced 7 times). Bucket 3
// (bundled/engineered/config-shaped — decomposes into >1 item, or is a bespoke fabricated assembly)
// gets NO code action — there's no single Item Master row to point it at; it's documented only.
// Bucket 4 (genuinely ambiguous / real catalog gaps) is untouched, per instruction.
//
// Same discipline as round 1: `key` values copy-pasted verbatim from the --json dump, never
// hand-retyped; dry-run by default; --apply to write; one usb_audit row per run.
import { createClient } from '@libsql/client';
import { memoryKeys } from '../lib/item-attributes.mjs';
import { readFileSync } from 'node:fs';

const apply = process.argv.includes('--apply');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const ACTOR = 'script:item-master-standardize';

// --- Bucket 2: 1 new item ---
const NEW_ITEMS = [
  { item_name: 'STAY TUBE 50.8 OD X 3.66 THK (BS 3059 PT.1, ERW 320)', group_name: 'STAY TUBE', bom_category: 'pipe', default_moc: null },
];

// --- Bucket 1: key (verbatim) -> confirmed target catalog item name ---
const DECISIONS = [
  // pipe
  ['90 DEG ELBOW THREADED FOR TRAPING|SMLS|15 MM, SCH-40', 'ELBOW THREADED, SMLS, SCH-40, 15 MM (1/2")'],
  ['DRAIN PIPE|SA 106 GR.B|Φ33.4 X 3.38 THK (SCH-40)   - 346LG', 'SEAMLESS PIPE SCH 40 IBR 25 MM (1")'],
  ['EXPANDER|SA 234 WPB|65NB / 100NB  THK (SCH-40)   - 102LG', 'ECCENTRIC REDUCER, IBR-SC/40-65 MM X 100 MM (21/2")'],
  ['STRAIGHT (PIPE) 2|MS|OD 550 X 10000 X 6 THK', 'MS PLATES 6 MM'],
  ['STRAIGHT (PIPE)-1|MS|OD 550 X 10000 X 8 THK', 'MS PLATES 8 MM'],
  ['STRAIGHT SHELL-1 (PIPE)|MS|OD 550 X 10000 X 6 THK', 'MS PLATES 6 MM'],
  ['STRAIGHT SHELL-1 (PIPE)|MS|OD 550 X 10000 X 5 THK', 'MS PLATES 5 MM'],
  ["TOP RALING PIPE-25NB|MS|40 NB ' B' CLASS", 'MS PIPE B CLASS 1 1/2"'],

  // channel / plate / round (dimensional gaps, target confirmed by keyword)
  ['MS STRUCTURE WORK|MS|ISA50X50 X5THK', 'MS ANGLE 50 X 50 X 5 MM'],
  ['CHIMNEY CONE-1 (PLATE)|MS|OD 550 / OD 825 X 10000 X 8 THK', 'MS PLATES 8 MM'],

  // (none)
  ['CHIMNEY|MILD STEEL|STRAIGHT PIECE: 6T MM X 5000 = 3 NOS', 'MS PLATES 6 MM'],
  ['GUY ROPE||DIA 10', 'WIRE ROPE 10 MM'],
  ['GUY ROPE||DIA 8', 'WIRE ROPE 8 MM'],
  ['STRAIGHT SHELL-1|MS|OD 600 X 5000 X 6 THK', 'MS PLATES 6 MM'],
  ['STRAIGHT SHELL-2|MS|OD 600 X 5000 X 6 THK', 'MS PLATES 6 MM'],
  ['STRAIGHT SHELL-3|MS|OD 600 X 5000 X 6 THK', 'MS PLATES 6 MM'],

  // other
  ['CERAMIC BLANKET||25T X 600X7300LG -DENSITY 64  @ 1200°C', 'CERAMIC BLANKET 25MM, DENSITY 64'],

  // standard: gasket / nipple / bend / flat / foundation bolt / valve / plummer / safety valve / WLG
  ['3 MM GASKET FOR WLG|METALIC|20 NB -T-H', 'ASBESTOS CUT GASKET METALIC 20 MM / 3/4"'],
  ['BARRLE NIPPLE THREADED FOR TRAPING|SMLS|15 MM X 6" LG, SCH-40', 'PIPE NIPPLE, IBR-SC-40 15 MM X 150 MM (1/2")'],
  ['BENDS - 90DEG|C.S-SMLS|Φ33.4 X (SCH-40)', 'BENDS, SEAMLESS, SHORT(90)IBR-SC/40 25MM (1")'],
  ['CHIMNEY FLANGE|MS|OD 800 X ID 700 X 12 THK', 'MS PLATES 12 MM'],
  ['CHIMNEY FLANGE|MS|OD 735 X ID 605 X 16 THK', 'MS PLATES 16 MM'],
  ['CHIMNEY FLANGE|MS|OD 800 X ID 700 X 16 THK', 'MS PLATES 16 MM'],
  ['CHIMNEY FOUNDATION (DOUBLE NUT AND BOLT WITH WASHERS)|MS|M32 X 1500 LG', 'FOUNDATION BOLTS & MS NUTS 32 MM X 1.2/1.5 L'],
  ['FLANGE-FLAT|MS|ISF40X5THK', 'MS FLATE 40 X 5 MM // 6 MM'],
  ['FLANGE-FLAT|MS|ISF50X5THK', 'MS FLATE 50 X 5 MM'],
  ['GLOBE  VALVE - F/E|SGI / CI|40MM, BS-10 TABLE-H', 'GLOBE VALVE, SGI, F/E, IBR 40 NB T/H'],
  ['GLOBE VALVE - F/E|SGI / CI|40MM, BS-10 TABLE-H', 'GLOBE VALVE, SGI, F/E, IBR 40 NB T/H'],
  ["GLOBE VALVE (AIR VENT) - F/E|SGI/CI|25 MM, BS-10, TABLE-H", 'GLOBE VALVE, SGI, F/E, IBR 25 NB T/H'],
  ["GLOBE VALVE (AIR VENT) - F/E|SGI / CI|25 MM, BS-10 TABLE-H", 'GLOBE VALVE, SGI, F/E, IBR 25 NB T/H'],
  ['GLOBE VALVE( MSSV ) - F/E|SGI/CI|80 MM, BS-10, TABLE-H', 'GLOBE VALVE, SGI, F/E, IBR 80 NB T/H'],
  ['GLOBE VALVE( MSSV ) - F/E|SGI / CI|80 MM, BS-10 TABLE-H', 'GLOBE VALVE, SGI, F/E, IBR 80 NB T/H'],
  ['PLUMMBER BLOCKS|C.I|SN-515', 'PEDESTRIAL SN-515'],
  ['PLUMMBER BLOCKS|C.I|SN-512', 'PEDESTRIAL SN-512'],
  ['SAFETY VALVE (HIGH LIFT TYPE)|CS|25 X 50 MM, IBR T-H', 'SAFETY V/E, CS, F/E, IBR 25 NB X 50 NB T/H'],
  ["WATER LEVEL GAUGE  WITH PROTECTORS -F/E|CS|20MM,  BS-10 TABLE 'H' (C/C 400)", 'WATER LEVEL GAUGE, CAST STEEL, F/E, IBR 20 MM'],
];

console.log(apply ? '=== APPLYING (round 2) ===\n' : '=== DRY RUN (round 2, nothing written) ===\n');

console.log(`--- Bucket 2: ${NEW_ITEMS.length} new item(s) ---`);
for (const item of NEW_ITEMS) {
  const existing = (await db.execute({ sql: 'SELECT id FROM items WHERE item_name = ?', args: [item.item_name] })).rows;
  if (existing.length) { console.log(`  SKIP "${item.item_name}" — already exists (id ${existing[0].id})`); continue; }
  console.log(`  CREATE "${item.item_name}" (${item.bom_category})`);
  if (apply) {
    const { lastInsertRowid } = await db.execute({
      sql: `INSERT INTO items (item_name, group_name, category, bom_category, uom, default_moc, default_requires_manufacturing)
            VALUES (?, ?, 'RAW MATERIALS', ?, 'Mtr', ?, 1)`,
      args: [item.item_name, item.group_name, item.bom_category, item.default_moc],
    });
    const id = Number(lastInsertRowid);
    await db.execute({ sql: 'UPDATE items SET item_code = ? WHERE id = ?', args: [`IM-${String(id).padStart(6, '0')}`, id] });
  }
}

console.log(`\n--- Bucket 1: ${DECISIONS.length} exact-memory seed(s) ---`);
const unresolvedItems = JSON.parse(readFileSync('/tmp/unresolved232.json', 'utf8'));
const byKey = new Map(unresolvedItems.map(it => [it.key, it]));
const catalogRows = (await db.execute('SELECT id, item_name FROM items')).rows;
const byName = new Map(catalogRows.map(r => [r.item_name, r]));

let applied = 0, missingKey = 0, missingTarget = 0;
for (const [key, targetName] of DECISIONS) {
  const record = byKey.get(key);
  if (!record) { console.log(`  MISS (key not found): ${JSON.stringify(key)}`); missingKey++; continue; }
  const target = byName.get(targetName);
  if (!target) { console.log(`  MISS (target not found): "${targetName}" for key ${JSON.stringify(key)}`); missingTarget++; continue; }

  const keys = memoryKeys({ material_description: record.desc, moc: record.moc, size_spec: record.size });
  if (!keys.alias) { console.log(`  SKIP (blank alias): ${JSON.stringify(key)}`); continue; }

  if (apply) {
    await db.execute({
      sql: `INSERT INTO item_link_memory (kind, alias_key, moc_key, size_key, item_id, approvals, updated_by)
            VALUES ('exact', ?, ?, ?, ?, 1, ?)
            ON CONFLICT(kind, alias_key, moc_key, size_key, item_id) DO UPDATE SET approvals = approvals + 1, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
      args: [keys.alias, keys.moc, keys.size, target.id, ACTOR],
    });
  }
  applied++;
}
console.log(`\n${applied} exact-memory seed(s) ${apply ? 'applied' : 'would be applied'}. ${missingKey} key(s) not found, ${missingTarget} target(s) not found.`);

if (apply) {
  await db.execute({
    sql: 'INSERT INTO usb_audit (request_id, machine_id, actor, action, detail) VALUES (NULL, NULL, ?, ?, ?)',
    args: [ACTOR, 'pmb_bucket_decisions_applied_round2', JSON.stringify({ newItems: NEW_ITEMS.length, exactMemorySeeds: applied })],
  });
  console.log('Applied and audited.');
}
