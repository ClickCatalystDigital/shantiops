// Item Master standardization pass, Phase 1 — corrections/backfills to EXISTING `items` rows only.
// Nothing is generated here (see scripts/generate-item-master-sizes.mjs for that). Same connection
// pattern as scripts/import-item-master.mjs (raw @libsql/client — lib/db.js can't load under plain
// node, see that script's own precedent). Every phase is dry-run by default; nothing is written
// until --apply. Every group-level rule lists every row it would touch, not just a count — a
// "confident" group_name has already been shown (PROTECTOR PLATES -> a mis-filed RUBBER CONES row)
// to sometimes hide contamination even at small scale.
//
// Take a backup first (and prove the restore path works) — see scripts/restore-items-backup.mjs.
//
// Usage:
//   node --env-file=.env.local scripts/fix-item-master-categories.mjs --only=cat|uom|pipe-naming [--apply]
import { createClient } from '@libsql/client';
import { normalizeUnit } from '../lib/qty-units.mjs';

const args = process.argv.slice(2);
const only = args.find(a => a.startsWith('--only='))?.slice('--only='.length);
const apply = args.includes('--apply');
if (!['cat', 'uom', 'pipe-naming'].includes(only)) {
  console.error('Usage: node --env-file=.env.local scripts/fix-item-master-categories.mjs --only=cat|uom|pipe-naming [--apply]');
  process.exit(1);
}

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

async function auditWrite(action, detail) {
  await db.execute({
    sql: 'INSERT INTO usb_audit (request_id, machine_id, actor, action, detail) VALUES (NULL, NULL, ?, ?, ?)',
    args: ['script:item-master-standardize', action, JSON.stringify(detail)],
  });
}

// ---------------------------------------------------------------------------------------------
// --only=cat
// ---------------------------------------------------------------------------------------------

// Confirmed real miscategorizations (found by reading the actual rows, not trusting group_name/
// item_name keyword matches alone) — glass/electrical items with no steel-bar/pressure-pipe
// identity, currently misfiled by inferCategory()'s naive keyword regex. Left NULL, not guessed
// into 'other'/'standard' — a human picks deliberately.
const MISCATEGORIZE_TO_NULL = [
  { ids: [2397, 2398, 2399, 2400], from: 'round', why: 'ROUND TOUGHENED GLASS — a glass gauge component, not steel round-bar stock' },
  { ids: [1118, 1119, 1120, 1121, 1122, 1123, 1124, 1125, 1126, 1127, 1128, 1129, 1131], from: 'pipe', why: 'GLASS TUBES — gauge-glass tubes for water-level indicators, not structural/pressure pipe' },
  { ids: [729], from: 'pipe', why: 'FLEXIBLE PIPE 3/4" (group_name=ELECTRICAL) — an electrical conduit item, matched the pipe regex by accident' },
];

// Typo-driven misses (word-boundary regexes that a client spelling defeats) and a correction to
// the original brief (MS B.BAR is round bright-bar stock — explicit "DIA" — not flat).
const TYPO_MISS_BACKFILL = [
  { group_name: 'MS FLATE', bom_category: 'flat', why: '"FLATE" defeats the \\bFLAT\\b word-boundary regex' },
  { group_name: 'MS B.BAR', bom_category: 'round', why: '"MS BRIGHT BAR {d} DIA" — round bright-bar stock, not flat (corrected from the original brief)' },
];

// Reliable group-level backfills — real evidence per group, checked against every row in the
// group (not a sample) before being added here. group_name strings are the exact live values
// (two were corrected from an abbreviated first draft: VARIABLE SPEED DRIVE, not "...DRV";
// FUEL INJECTION GEAR PUMP, not "FUEL INJ GEAR PUMP" — a WHERE clause on the wrong string would
// have silently matched zero rows rather than erroring).
const GROUP_BACKFILL = [
  { group_name: 'ECCNTRIC REDUCER', bom_category: 'pipe', why: 'concentric/eccentric reducer, IBR pipe fitting (group mixes both real fitting types under one client-typo\'d group_name; both are pipe fittings)' },
  { group_name: 'REDUCER', bom_category: 'pipe', why: 'non-IBR reducer, same pipe-fitting family' },
  { group_name: 'EXPANSION BEND', bom_category: 'pipe', why: 'IBR pipe fitting' },
  { group_name: 'STEAM TRAP', bom_category: 'standard', why: 'bought IBR-rated fitting' },
  { group_name: 'VENTURI', bom_category: 'standard', why: 'bought CI fitting' },
  { group_name: 'DUMMY FLANGES', bom_category: 'standard', why: 'same group_name as the 91 rows already correctly standard — a completeness gap, not a new call' },
  { group_name: 'PUMP', bom_category: 'standard', why: 'bought rotating equipment' },
  { group_name: 'THERMIC FLUID PUMP', bom_category: 'standard', why: 'bought rotating equipment (+ its own mechanical seal, still a bought part)' },
  { group_name: 'FUEL INJECTION GEAR PUMP', bom_category: 'standard', why: 'bought rotating equipment' },
  { group_name: 'VARIABLE SPEED DRIVE', bom_category: 'standard', why: 'bought drive/electrical equipment' },
  { group_name: 'MOTOR', bom_category: 'standard', why: 'whole bought rotating equipment (judgment call — see plan)' },
  { group_name: 'INDICATING LIGHTS', bom_category: 'other', why: 'panel/electrical hardware' },
  { group_name: 'REEMER', bom_category: 'other', why: 'workshop cutting tool (client spelling kept), incl. its carbide tips consumable' },
  { group_name: 'Thermometer', bom_category: 'standard', why: 'bought instrument' },
  { group_name: 'STEAM LOW METERS', bom_category: 'standard', why: 'real item name is "Steam Flow Meters" — bought instrument' },
  { group_name: 'TOOLS', bom_category: 'other', why: 'live-sampled: tape/drill-sleeve/bandsaw-blade/lathe-chuck — workshop consumables/tools' },
  { group_name: 'FIRE BARS', bom_category: 'other', why: 'matches the existing FIRE_BAR(S) regex rule already in lib/section-shapes.js — a residual gap' },
  { group_name: 'RUBBER CONES', bom_category: 'other', why: 'elastomer gauge-glass seal, consumable (the one mis-filed row under group_name=PROTECTOR PLATES is handled separately, below)' },
  { group_name: 'GRATE BARS', bom_category: 'other', why: 'cast-iron furnace grate bar, same class as FIRE BARS (cast/fabricated furnace fitting, not raw dimensional stock)' },
];

// Items where the group itself is genuinely mixed (ELECTRICAL, MISSLANIOUS, PROTECTOR PLATES,
// SS PLATES) or a real evidenced dimensional shape sits inside an electrical-labelled group (a
// copper/GI strip genuinely has real width x thickness stock dimensions regardless of its use
// context) — categorized per item on real evidence in the item_name itself, per your own
// instruction. Anything without confident evidence (NXC, WELD MECH, and the whole SUPPORT BAR
// group, which mixes H/L/T-type profiles with bare, ambiguous dimensions) is left NULL, reported.
const ITEM_BACKFILL = [
  // ELECTRICAL — dimensional strips (real evidence: explicit W x T)
  { id: 722, bom_category: 'flat', why: 'COPPER STRIP 25 MM X 3 MM — real flat-bar dimensions' },
  { id: 723, bom_category: 'flat', why: 'COPPER STRIP 50 MM X 4 MM — real flat-bar dimensions' },
  { id: 720, bom_category: 'flat', why: 'GI SRTIP 25 X 3 MM — real flat-bar dimensions' },
  { id: 721, bom_category: 'flat', why: 'GI SRTIP 50 X 4 MM — real flat-bar dimensions' },
  // ELECTRICAL — panel/electrical hardware
  { id: 733, bom_category: 'other', why: 'BULB HOLDER' },
  { id: 706, bom_category: 'other', why: 'BUNCHING TIE — cable tie' },
  { id: 725, bom_category: 'other', why: 'CERAMIC INSULATORS' },
  { id: 705, bom_category: 'other', why: 'COOLING FAN — bought component' },
  { id: 712, bom_category: 'other', why: 'FERRUL T TYPE — wire ferrule' },
  { id: 708, bom_category: 'other', why: 'FERRUL T Type — wire ferrule' },
  { id: 713, bom_category: 'other', why: 'FERRUL T Type — wire ferrule' },
  { id: 711, bom_category: 'other', why: 'FERRUL T Type — wire ferrule' },
  { id: 709, bom_category: 'other', why: 'FERRUL T Type — wire ferrule' },
  { id: 710, bom_category: 'other', why: 'FERRUL T Type — wire ferrule' },
  { id: 704, bom_category: 'other', why: 'FILTER 4" — bought component' },
  { id: 749, bom_category: 'other', why: 'FUSES — electrical fuse' },
  { id: 751, bom_category: 'other', why: 'ISOLATOR 4-20 MA — panel hardware' },
  { id: 707, bom_category: 'standard', why: 'TEMPERATURE INDICATOR CUM CONTROL — bought instrument, same class as Thermometer' },
  { id: 697, bom_category: 'other', why: 'TIMMER (Timer) — panel hardware' },
  { id: 750, bom_category: 'other', why: 'TRANSDUCER — panel signal-conditioning hardware' },
  // singleton groups, individually confident
  { id: 752, bom_category: 'other', why: 'EMERG. BUTTON — panel hardware' },
  { id: 1178, bom_category: 'standard', why: 'HYDRAULIC TEST PUMP — whole bought pump/test equipment' },
  { id: 1183, bom_category: 'other', why: 'DC ISOLATOR — panel hardware' },
  { id: 1184, bom_category: 'other', why: 'ISOLATOR:NH4-125 — panel hardware' },
  { id: 1204, bom_category: 'standard', why: 'MANOMETER U TYPE — bought pressure-measurement instrument' },
  { id: 2268, bom_category: 'other', why: 'RUBBER CONES, BLACK 1/2" (mis-filed under group_name=PROTECTOR PLATES) — same class as the real RUBBER CONES rows' },
  { id: 2279, bom_category: 'standard', why: 'PULLY TAPPER LOCK — bought taper-lock bushing, mechanical power-transmission component' },
  { id: 2298, bom_category: 'standard', why: 'PUMP MECHANICAL SEAL — bought spare part, same class as the Thermic Fluid Pump seal' },
  { id: 2299, bom_category: 'other', why: 'PUSH BUTTON — panel hardware' },
  { id: 2300, bom_category: 'other', why: 'PUSH BUTTON — panel hardware' },
  { id: 2301, bom_category: 'other', why: 'TWIN PUSH BUTTON — panel hardware' },
  { id: 2486, bom_category: 'plate', why: 'SS 202PLATE 5 MM — obviously a plate; "202PLATE" (no space) defeats the PLATE(S)? regex' },
  { id: 2482, bom_category: 'plate', why: 'SS 202PLATES 1.5 MM — same naming gap' },
  // MISSLANIOUS — categorized per item on real evidence; the group itself stays a known mixed
  // dumping-ground with no group-level rule
  { id: 1317, bom_category: 'standard', why: 'AUTO BLOW DOWN SYSTEM — bought IBR valve/assembly' },
  { id: 1318, bom_category: 'standard', why: 'AUTO BLOW DOWN SYSTEM — bought IBR valve/assembly' },
  { id: 1278, bom_category: 'other', why: 'BOILER BRUSH — consumable cleaning tool' },
  { id: 1279, bom_category: 'other', why: 'BOILER BRUSH — consumable cleaning tool' },
  { id: 1280, bom_category: 'other', why: 'BOILER BRUSH — consumable cleaning tool' },
  { id: 1281, bom_category: 'other', why: 'BOILER BRUSH — consumable cleaning tool' },
  { id: 1282, bom_category: 'other', why: 'BOILER CHEMICAL ANTI SCALENT — consumable chemical' },
  { id: 1284, bom_category: 'other', why: 'BOILER CHEMICAL DE-SCALING COMPOUND — consumable chemical' },
  { id: 1285, bom_category: 'other', why: 'BOILER CHEMICAL OXYGEN SCAVENGER — consumable chemical' },
  { id: 1283, bom_category: 'other', why: 'BOILER CHEMICAL PH BOOSTER — consumable chemical' },
  { id: 1304, bom_category: 'standard', why: 'BURNERS ECOFLAME — whole bought burner unit, major boiler equipment' },
  { id: 1301, bom_category: 'other', why: 'CARBAN (Carbon) BRUSHES — consumable, same class as TOOLS\' own carbon brushes row' },
  { id: 1236, bom_category: 'other', why: 'CLAMPS — hardware' },
  { id: 1237, bom_category: 'other', why: 'CLAMPS — hardware' },
  { id: 1234, bom_category: 'other', why: 'CLAMPS — hardware' },
  { id: 1235, bom_category: 'other', why: 'CLAMPS — hardware' },
  { id: 1298, bom_category: 'other', why: 'CNC MOUNTING SLEEVE — cutting-torch consumable' },
  { id: 1295, bom_category: 'other', why: 'CNC NOZZLE — cutting-torch consumable' },
  { id: 1297, bom_category: 'other', why: 'CNC SHIELD — cutting-torch consumable' },
  { id: 1296, bom_category: 'other', why: 'CNC SWRIL (Swirl) — cutting-torch consumable' },
  { id: 1294, bom_category: 'other', why: 'CNC-ELECTRODE — cutting-torch consumable' },
  { id: 1315, bom_category: 'other', why: 'E.S.S ... ZERO SPEED SWT — electrical safety switch/sensor, panel-class' },
  { id: 1308, bom_category: 'other', why: 'ELECTRODE OILFLAME — burner consumable electrode' },
  { id: 1250, bom_category: 'other', why: 'FIBER GLASS BAGS — consumable filter bag (fabric, not raw stock, despite the stated dims)' },
  { id: 1251, bom_category: 'other', why: 'FIBER GLASS BAGS — consumable filter bag' },
  { id: 1303, bom_category: 'other', why: 'FILTER BAGS — consumable' },
  { id: 1252, bom_category: 'standard', why: 'FRP SOFTENER VESSELS — bought pressure vessel equipment' },
  { id: 1253, bom_category: 'standard', why: 'FRP SOFTENER VESSELS — bought pressure vessel equipment' },
  { id: 1254, bom_category: 'standard', why: 'FRP SOFTENER VESSELS — bought pressure vessel equipment' },
  { id: 1249, bom_category: 'other', why: 'GI CAGES FOR BAG HOUSE — bought fabricated dust-collection accessory' },
  { id: 1225, bom_category: 'other', why: 'LABEL IN / OUT / ARROW — consumable' },
  { id: 1219, bom_category: 'other', why: 'LABELS — consumable' },
  { id: 1221, bom_category: 'other', why: 'LABELS ARROW — consumable' },
  { id: 1220, bom_category: 'other', why: 'LABELS DANGER — consumable' },
  { id: 1222, bom_category: 'other', why: 'LABELS OPEN / CLOSE — consumable' },
  { id: 1242, bom_category: 'other', why: 'LRB MATTRESS — insulation/refractory-class consumable' },
  { id: 1244, bom_category: 'other', why: 'LRB MATTRESS — insulation/refractory-class consumable' },
  { id: 1243, bom_category: 'other', why: 'LRB MATTRESS — insulation/refractory-class consumable' },
  { id: 1312, bom_category: 'standard', why: 'MANOMETER OILFLAM — bought pressure-measurement instrument' },
  { id: 1299, bom_category: 'other', why: 'MIG NOZZLE — welding consumable' },
  { id: 1300, bom_category: 'other', why: 'MIG TIPS — welding consumable' },
  { id: 1261, bom_category: 'other', why: 'OIL FILER (Filter) DUPLEX — consumable filter' },
  { id: 1260, bom_category: 'other', why: 'OIL FILER DUPLEX — consumable filter' },
  { id: 1259, bom_category: 'other', why: 'OIL FILER DUPLEX — consumable filter' },
  { id: 1267, bom_category: 'standard', why: 'OIL IMMERSSION HEATERS — bought heating equipment' },
  { id: 1268, bom_category: 'standard', why: 'OIL IMMERSSION HEATERS — bought heating equipment' },
  { id: 1311, bom_category: 'other', why: 'PHOTO CELL — burner flame-sensor, panel/electrical hardware' },
  { id: 1227, bom_category: 'round', why: 'PTFE / TEFLON ROF (Rod), 42 MM DIA — real diameter, genuine rod shape' },
  { id: 1226, bom_category: 'round', why: 'PTFE / TEFLON ROD, 50 MM DIA — real diameter, genuine rod shape' },
  { id: 1255, bom_category: 'other', why: 'RESINS SOFTENER — consumable/chemical resin' },
  { id: 1273, bom_category: 'standard', why: 'RETURN ROLLER — bought mechanical component' },
  { id: 1274, bom_category: 'other', why: 'ROLLER CLAMPS — clamp/fastener hardware' },
  { id: 1258, bom_category: 'standard', why: 'SOFTENER FITTINGS CPVC FITTINGS — bought pipe fittings' },
  { id: 1275, bom_category: 'standard', why: 'SPROCKET — bought mechanical power-transmission component' },
  { id: 1270, bom_category: 'standard', why: 'SS FLOAT — bought float, same class as Steam Trap ball floats' },
  { id: 1306, bom_category: 'other', why: 'STEAM PROBE SENSOR — electrical sensor, panel-class' },
  { id: 1223, bom_category: 'other', why: 'STICKERS SB 3M — consumable' },
  { id: 1302, bom_category: 'standard', why: 'THERMIC FLUID HEATER — whole bought heater unit, major equipment' },
  { id: 1271, bom_category: 'standard', why: 'THERMO COUPLE — measurement instrument, same class as Thermometer' },
  { id: 1305, bom_category: 'other', why: 'TRANSFORMATION KIT — electrical accessory' },
  { id: 1309, bom_category: 'other', why: 'TRANSFORMER — electrical component' },
  { id: 1240, bom_category: 'other', why: 'TURN BUCKLES — rigging hardware' },
  { id: 1241, bom_category: 'other', why: 'TURN BUCKLES — rigging hardware' },
  { id: 1238, bom_category: 'other', why: 'TURN BUCKLES — rigging hardware' },
  { id: 1239, bom_category: 'other', why: 'TURN BUCKLES — rigging hardware' },
  { id: 1229, bom_category: 'other', why: 'WOODEN CRATE PACKINGS — consumable packing material' },
];

// Traceability-flag correction — real, unambiguous evidence: every BQ PLATE row states its own
// Form IV Test Certificate right in the name.
const TRACEABILITY_FIXES = [
  { group_name: 'BQ PLATE', set: { default_requires_mtc: 1, default_requires_heat_no: 1 }, why: '"...NORMALIZED, FORM IV TC" stated in every row\'s own item_name' },
];

// Left NULL, no rule applied — printed in the report for a human to decide. Not exhaustive as a
// data structure (it's just the reporting side), but every id/group named here really was checked
// against real row text before being left out of the rules above.
const LEFT_NULL_GROUPS = ['SUPPORT BAR'];
const LEFT_NULL_SINGLETONS = [
  { id: 2067, why: 'NXC-09M/22 240V 50/60Hz — unclear what this device even is from the name alone' },
  { id: 1314, why: 'WELD MECH — unclear what this refers to' },
];

async function fetchRowsByIds(ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return (await db.execute({ sql: `SELECT id, item_name, bom_category FROM items WHERE id IN (${placeholders})`, args: ids })).rows;
}

async function runCat() {
  console.log(apply ? '=== Applying category corrections ===\n' : '=== DRY RUN: category corrections (nothing written) ===\n');
  const statements = [];
  let touched = 0;

  console.log('--- Miscategorization fixes (-> NULL, for a human to pick deliberately) ---');
  for (const { ids, from, why } of MISCATEGORIZE_TO_NULL) {
    const rows = await fetchRowsByIds(ids);
    console.log(`  ${why}`);
    for (const r of rows) {
      console.log(`    ${r.id}\t${r.item_name}\t[${r.bom_category} -> NULL]`);
      if (r.bom_category === from) {
        statements.push({ sql: 'UPDATE items SET bom_category = NULL WHERE id = ? AND bom_category = ?', args: [r.id, from] });
        touched++;
      }
    }
  }

  console.log('\n--- Typo-driven miss / brief-correction backfills ---');
  for (const { group_name, bom_category, why } of TYPO_MISS_BACKFILL) {
    const rows = (await db.execute({ sql: 'SELECT id, item_name FROM items WHERE group_name = ? AND bom_category IS NULL', args: [group_name] })).rows;
    console.log(`  group_name='${group_name}' -> ${bom_category} (${why})`);
    for (const r of rows) console.log(`    ${r.id}\t${r.item_name}`);
    if (rows.length) {
      statements.push({ sql: 'UPDATE items SET bom_category = ? WHERE group_name = ? AND bom_category IS NULL', args: [bom_category, group_name] });
      touched += rows.length;
    }
  }

  console.log('\n--- Reliable group-level backfills ---');
  for (const { group_name, bom_category, why } of GROUP_BACKFILL) {
    const rows = (await db.execute({ sql: 'SELECT id, item_name FROM items WHERE group_name = ? AND bom_category IS NULL', args: [group_name] })).rows;
    console.log(`  group_name='${group_name}' -> ${bom_category} (${why}) [${rows.length} row(s)]`);
    for (const r of rows) console.log(`    ${r.id}\t${r.item_name}`);
    if (rows.length) {
      statements.push({ sql: 'UPDATE items SET bom_category = ? WHERE group_name = ? AND bom_category IS NULL', args: [bom_category, group_name] });
      touched += rows.length;
    }
  }

  console.log('\n--- Per-item backfills (mixed groups, categorized on real evidence) ---');
  for (const { id, bom_category, why } of ITEM_BACKFILL) {
    const [row] = await fetchRowsByIds([id]);
    if (!row) { console.log(`    ${id}\t(not found — skipped)`); continue; }
    console.log(`    ${id}\t${row.item_name}\t-> ${bom_category}  (${why})`);
    if (row.bom_category === null) {
      statements.push({ sql: 'UPDATE items SET bom_category = ? WHERE id = ? AND bom_category IS NULL', args: [bom_category, id] });
      touched++;
    }
  }

  console.log('\n--- Traceability-flag corrections ---');
  for (const { group_name, set, why } of TRACEABILITY_FIXES) {
    const rows = (await db.execute({ sql: 'SELECT id, item_name FROM items WHERE group_name = ?', args: [group_name] })).rows;
    console.log(`  group_name='${group_name}' -> ${JSON.stringify(set)} (${why}) [${rows.length} row(s)]`);
    for (const r of rows) console.log(`    ${r.id}\t${r.item_name}`);
    if (rows.length) {
      const cols = Object.keys(set);
      statements.push({ sql: `UPDATE items SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE group_name = ?`, args: [...cols.map(c => set[c]), group_name] });
    }
  }

  console.log('\n--- Left NULL, reported (no confident rule) ---');
  for (const g of LEFT_NULL_GROUPS) {
    const rows = (await db.execute({ sql: 'SELECT id, item_name FROM items WHERE group_name = ? AND bom_category IS NULL', args: [g] })).rows;
    console.log(`  group_name='${g}' — genuinely mixed real shapes (H/L/T-type profiles + bare, ambiguous dims) [${rows.length} row(s)]`);
    for (const r of rows) console.log(`    ${r.id}\t${r.item_name}`);
  }
  for (const { id, why } of LEFT_NULL_SINGLETONS) {
    const [row] = await fetchRowsByIds([id]);
    console.log(`  ${id}\t${row?.item_name ?? '(not found)'}\t— ${why}`);
  }

  // Anything else still NULL that none of the rules above touched — a real completeness check,
  // not just trusting the lists above are exhaustive.
  const stillNull = (await db.execute('SELECT COUNT(*) n FROM items WHERE bom_category IS NULL')).rows[0].n;
  console.log(`\n${touched} row(s) would change category this run. ${stillNull} row(s) are currently NULL before this run (includes everything above, applied or left).`);

  if (apply && statements.length) {
    await db.batch(statements, 'write');
    await auditWrite('item_master_fix_categories', { touched, statementCount: statements.length });
    console.log(`\nApplied ${statements.length} statement(s) atomically.`);
  } else if (apply) {
    console.log('\nNothing to apply — every rule is already satisfied (safe to re-run).');
  }
}

// ---------------------------------------------------------------------------------------------
// --only=uom
// ---------------------------------------------------------------------------------------------
async function runUom() {
  console.log(apply ? '=== Applying UOM normalization ===\n' : '=== DRY RUN: UOM normalization (nothing written) ===\n');
  const distinct = (await db.execute("SELECT uom, COUNT(*) n FROM items WHERE uom IS NOT NULL GROUP BY uom ORDER BY n DESC")).rows;
  const statements = [];
  for (const { uom, n } of distinct) {
    const canon = normalizeUnit(uom);
    if (canon && canon !== uom) {
      console.log(`  '${uom}' (${n} row(s)) -> '${canon}'`);
      statements.push({ sql: 'UPDATE items SET uom = ? WHERE uom = ?', args: [canon, uom] });
    } else if (!canon) {
      const [row] = (await db.execute({ sql: 'SELECT id, item_name, group_name FROM items WHERE uom = ? LIMIT 1', args: [uom] })).rows;
      console.log(`  '${uom}' (${n} row(s)) — not a recognized unit alias, left untouched. e.g. id ${row?.id} "${row?.item_name}" (${row?.group_name})`);
    }
  }
  const nullCount = (await db.execute('SELECT COUNT(*) n FROM items WHERE uom IS NULL')).rows[0].n;
  console.log(`  ${nullCount} row(s) have no uom at all — left NULL, no signal to fill from.`);

  if (apply && statements.length) {
    await db.batch(statements, 'write');
    await auditWrite('item_master_fix_uom', { statementCount: statements.length });
    console.log(`\nApplied ${statements.length} statement(s) atomically.`);
  } else if (apply) {
    console.log('\nNothing to apply.');
  }
}

// ---------------------------------------------------------------------------------------------
// --only=pipe-naming
// ---------------------------------------------------------------------------------------------
// Mechanical, unambiguous normalizations only — separator casing and unit-word spelling. Never a
// semantic change (nothing that could merge or reinterpret a real spec). Anything not confidently
// a pure formatting fix is left alone and listed.
const PIPE_UNIT_ALIASES = [[/\bMTRS\b/gi, 'MTR'], [/\bMTS\b/gi, 'MTR'], [/\bMETRE(S)?\b/gi, 'MTR']];

function normalizePipeName(name) {
  let s = name;
  for (const [re, canon] of PIPE_UNIT_ALIASES) s = s.replace(re, canon);
  s = s.replace(/\s*x\s*/g, ' X '); // lowercase "x" separator -> uppercase, one space each side
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s;
}

async function runPipeNaming() {
  console.log(apply ? '=== Applying pipe naming normalization ===\n' : '=== DRY RUN: pipe naming normalization (nothing written) ===\n');
  const rows = (await db.execute("SELECT id, item_name FROM items WHERE bom_category = 'pipe' ORDER BY id")).rows;
  const statements = [];
  let unchanged = 0;
  for (const r of rows) {
    const normalized = normalizePipeName(r.item_name);
    if (normalized !== r.item_name) {
      console.log(`  ${r.id}\t"${r.item_name}"\n\t-> "${normalized}"`);
      statements.push({ sql: 'UPDATE items SET item_name = ? WHERE id = ? AND item_name = ?', args: [normalized, r.id, r.item_name] });
    } else {
      unchanged++;
    }
  }
  console.log(`\n${statements.length} of ${rows.length} pipe row(s) would be renamed; ${unchanged} already match the normalized form.`);

  if (apply && statements.length) {
    await db.batch(statements, 'write');
    await auditWrite('item_master_fix_pipe_naming', { statementCount: statements.length });
    console.log(`\nApplied ${statements.length} statement(s) atomically.`);
  } else if (apply) {
    console.log('\nNothing to apply.');
  }
}

if (only === 'cat') await runCat();
else if (only === 'uom') await runUom();
else if (only === 'pipe-naming') await runPipeNaming();
