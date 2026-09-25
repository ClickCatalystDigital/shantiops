// Full-rigor manual resolution pass, round 1: the "plate_duct" functional bucket from
// scripts/audit-unresolved-bom-rows.mjs. Every LINK below was hand-verified against the real
// catalog (thickness/OD/NB read directly off the PMB line, moc checked against the target's own
// material) — never a blind acceptance of the auto-matcher's fuzzy suggestion. DECOMPOSE entries
// split one bundled "PLATE SIZE :" cell into its real constituent pieces via the same
// splitLabeledSizeList() the parser itself uses, then insert one bom_items row per piece and
// remove the original bundle row (never blocked — item_id was NULL, nothing downstream ever
// referenced it). Dry-run by default; --apply to write; one usb_audit row per run.
import { createClient } from '@libsql/client';
import { splitLabeledSizeList } from '../lib/multi-value.mjs';

const apply = process.argv.includes('--apply');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const ACTOR = 'script:item-master-standardize';

// key: `${material_description}|${moc}|${size_spec}` (raw, exact — matched against the live row)
const LINKS = [
  ['BODY SHELL MATERIAL|MS- IS 2062|1250X2500X3.15 MM THICK', 2844],
  ['BODY SHELL MATERIAL|MS- IS 2062|850X850X5 MM THICK', 2034],
  ['BODY SHELL MATERIAL|MS- IS 2062|425X350X8 MM THICK', 2036],
  ['BODY SHELL MATERIAL|MS- IS 2062|1250X2500X 4 MM THICK', 2033],
  ['BODY SHELL MATERIAL|MS- IS 2062|1250X1530X 3.15 MM THICK', 2844],
  ['BODY SHELL MATERIAL|MS- IS 2062|1000X1000X5 MM THICK', 2034],
  ['BODY SHELL MATERIAL|MS- IS 2062|720X380X8 MM THICK', 2036],
  ['BODY SHELL MATERIAL|MS- IS 2062|1500X6300X5 MM THICK', 2034],
  ['BODY SHELL MATERIAL||1250X2500X4 MM THICK', 2033], // moc null
  ['CHIMNEY CONE-1 (PLATE)|MS|OD 600 / OD 900 X 10000 x 8 THK', 2036],
  ['FIXING PLATE|IS 2062|250 x 200 x 10 THK', 2037],
  ['FIXING PLATE|IS 2062|100 x 80 x 10 THK', 2037],
  ['PAD PLATE|IS 2062|200 x 80 x 6 THK', 2035],
  ['PLATE|MS- IS 2062|1250X 1250X 8 MM THICK', 2036],
  ['PLATE|MS- IS 2062|1250X 2500X 5 MM THICK', 2034],
  ['PLATE|MS- IS 2062|1000X 1000X 10 MM THICK', 2037],
  ['SHEET|MS- IS 2062|1250X 2500X4 MM THICK', 2033],
  ['TOE SHOE PLATE FLAT|IS 2062|100 x 5 THK', 2034],
  ['3 WAY DAMPER TO BH INLET|MS|1250 X 2500 X 4 THK- (500 SQ.)', 2033],
  ['APH TO MDC|MS|1250 X 2500 X 4 THK- (500 SQ.)', 2033],
  ['BAG FILTER TO ID FAN|MS|1250 X 2500 X 4 THK- (500 SQ.)', 2033],
  ['BOILER TO APH|MS|1250 X 1250 X 4 THK- (500 SQ.)', 2033],
  ['BOILER TO APH||1250 X 2500 X 3.15 THK', 2844],
  ['COLD AIR DUCT||1250 X 2500 X 3.15 THK- (400 SQ)', 2844],
  ['DUCT|MS|400 SQ X 3.15 THK', 2844],
  ['HOT AIR DUCT||1250 X 2500 X 3.15 THK- (400 SQ)', 2844],
  ['MDC TO 3-WAY DAMPER|MS|1250 X 2500 X 4 THK- (500 SQ.)', 2033],
  ['DUCT|MS|1945 Lg. x 3.15 THK- (400 SQ)', 2844],
  ['DUCT-HA2|MS|718 Lg. x 3.15 THK- (400 SQ)', 2844],
  ['DUCT-HA4|MS|1160 Lg. x 3.15 THK- (400 SQ)', 2844],
  ['DUCT-HA5|MS|1100 Lg. x 3.15 THK- (400 SQ)', 2844],
  ['DUCT-HA7|MS|870 Lg. x 3.15 THK- (400 SQ)', 2844],
  ['FG- EXTRA|MS|1000Lg.x 3.15 THK- (500 SQ.)', 2844],
  ['FG-10|MS|565Lg.x 3.15 THK- (Dia 350 )', 2844],
  ['FG-13|MS|2150Lg.x 3.15 THK- (500 SQ.)', 2844],
  ['FG-14|MS|1630Lg.x 3.15 THK- (500 SQ.)', 2844],
  ['FG-4|MS|1100Lg.x 3.15 THK- (450 SQ.)', 2844],
  ['FG-5|MS|204Lg.x 3.15 THK- (450 SQ.)', 2844],
  ['FG-6|MS|752Lg.x 3.15 THK- (500 SQ.)', 2844],
  ['FG-8|MS|1500Lg.x 3.15 THK- (500 SQ.)', 2844],
  ['FG-9|MS|1123Lg.x 3.15 THK- (500 SQ.)', 2844],
  ['PLATE|CS|10 X 500', 2037],
  ['BODY SHELL|MS- IS 2062|4 MM THICK', 2033],
  ['3 WAY DAMPER SV 1.5 SQ MM 3 CORE||', 216], // CABLE 1.5 SQMM X 3CORE
  ['BY PASS DUCT TO ID FAN|MS|1250 X 2500 X 4 THK- (500 SQ.)', 2033],
  ['CHEQUIRED PLATE|MS|4 x900 x 1200', 1937], // explicit "chequired" -> MS CHQEURED PLATES 4 MM
  ['COVER FLANGE|SA 516 Gr.70|150NB,BS-10 TABLE-H', 440],  // DUMMY FLANGES, MS, T/H, IBR 150 MM
  ['COVER FLANGE|SA 516 Gr.70|25NB,BS-10 TABLE-H', 432],   // ... IBR 25 MM
  ['COVER FLANGE|SA 516 Gr.70|50NB,BS-10 TABLE-H', 435],   // ... IBR 50 MM
  ['DUCT|MS|500 SQ X 4T', 2033],
  ['DUCT - L TYPE|MS|500 SQ X 4T', 2033],
  ['MS LIFTING HOOKS|MS|300 x 800 x 10 THK', 2037],
  ['REDUCER DUCT|MS|400x500 /  500 SQ X 500Lgx 4T', 2033],
  ['REDUCER DUCT|MS|400x500 /  500 SQ X 1020Lgx 4T', 2033],
  ['CHIMNEY CONE-1|MS|OD 700 / OD 1400 X 10000 x8 THK', 2036],
  ['COVER FLANGE|MS|OD 790 X 12 THK', 2038],
  // gauge_fitting bucket, resolved with plate_duct since it needed the same real catalog search:
  ['INLET & OUTLET TEMP. CABLE -PT100 3 CORE||', 216], // only 3-core cable the catalog stocks
];

// [material_description, moc] -> only the "PLATE SIZE :" ids that carry this exact bundle
const DECOMPOSE_IDS = [5093, 5377, 7680];

// thickness (mm, as a plain number key) -> MS PLATES item id, for the decompose pieces
const MS_PLATE_BY_T = { 8: 2036, 10: 2037, 12: 2038, 16: 2040, 18: 2041 };

console.log(apply ? '=== APPLYING (round 1: plate_duct) ===\n' : '=== DRY RUN (round 1: plate_duct, nothing written) ===\n');

let linked = 0;
for (const [key, itemId] of LINKS) {
  const [desc, moc, size] = key.split('|');
  const rows = (await db.execute({
    sql: `SELECT id, project_id FROM bom_items WHERE source='bom' AND item_id IS NULL
          AND material_description = ? AND COALESCE(moc,'') = ? AND COALESCE(size_spec,'') = ?`,
    args: [desc, moc, size],
  })).rows;
  if (!rows.length) { console.log(`  [MISS] no live row for "${desc}" | moc="${moc}" | size="${size}"`); continue; }
  for (const r of rows) {
    console.log(`  #${r.id} (project ${r.project_id}) "${desc}" -> item_id ${itemId}`);
    linked++;
    if (apply) await db.execute({ sql: 'UPDATE bom_items SET item_id = ? WHERE id = ?', args: [itemId, r.id] });
  }
}

let decomposed = 0, deleted = 0;
for (const id of DECOMPOSE_IDS) {
  const row = (await db.execute({ sql: 'SELECT * FROM bom_items WHERE id = ? AND item_id IS NULL', args: [id] })).rows[0];
  if (!row) { console.log(`  [MISS] decompose id ${id} not found or already linked`); continue; }
  const pieces = splitLabeledSizeList({ material_description: row.material_description, size_spec: row.size_spec });
  if (!pieces) { console.log(`  [MISS] id ${id} no longer splits`); continue; }
  console.log(`  decompose #${id} (project ${row.project_id}) into ${pieces.length} piece(s):`);
  for (const p of pieces) {
    const t = parseFloat(p.size_spec.match(/^(\d+(?:\.\d+)?)/)[1]);
    const itemId = MS_PLATE_BY_T[t];
    if (!itemId) { console.log(`      [MISS] no MS PLATES row for t=${t}`); continue; }
    console.log(`      insert: "${p.material_description}" ${p.size_spec} qty="${p.qty_text}" -> item_id ${itemId}`);
    decomposed++;
    if (apply) {
      await db.execute({
        sql: `INSERT INTO bom_items (project_id, section, group_label, assembly_id, material_description, category, moc,
              size_spec, make, qty_text, purchase_status, source, import_id, item_id, pending_review)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [row.project_id, row.section, row.group_label, row.assembly_id, p.material_description, 'plate',
               row.moc, p.size_spec, row.make, p.qty_text, row.purchase_status, row.source, row.import_id, itemId, row.pending_review],
      });
    }
  }
  console.log(`  delete original bundle row #${id}`);
  deleted++;
  if (apply) await db.execute({ sql: 'DELETE FROM bom_items WHERE id = ?', args: [id] });
}

console.log(`\n${linked} row(s) ${apply ? 'linked' : 'would be linked'}. ${decomposed} decomposed piece(s) ${apply ? 'inserted' : 'would be inserted'} from ${deleted} bundle row(s) ${apply ? 'removed' : 'would be removed'}.`);

if (apply) {
  await db.execute({
    sql: 'INSERT INTO usb_audit (request_id, machine_id, actor, action, detail) VALUES (NULL, NULL, ?, ?, ?)',
    args: [ACTOR, 'bom_item_manual_audit_resolved', JSON.stringify({ bucket: 'plate_duct', linked, decomposed, deleted })],
  });
  console.log('Applied and audited.');
}
