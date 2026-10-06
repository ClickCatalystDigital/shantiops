// scripts/create-inventory-sheet-items.mjs — the 27 in-stock items of the client's inventory workbook that had no Item Master
// match (docs/inventory-sheet-match.csv, status "none"). Each was checked by hand against the live Item Master:
//   link   it IS in the Item Master under another spelling (typo, missing MS prefix, extra CLASS150 detail) — no new row
//   create genuinely missing — a new Item Master row named the way the Item Master names its neighbours (same category/group)
// Writes docs/inventory-sheet-decisions.json ({"<sheet code>|<sheet description>": "IM-xxxxxx"}), which
// scripts/match-inventory-sheet.mjs applies as its first tier.
//
//   node --env-file=.env.local scripts/create-inventory-sheet-items.mjs            dry run
//   node --env-file=.env.local scripts/create-inventory-sheet-items.mjs --apply
//   node --env-file=.env.local scripts/create-inventory-sheet-items.mjs --rollback  (deletes the rows it created, if unused)
import { createClient } from '@libsql/client';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const DECISIONS_FILE = 'docs/inventory-sheet-decisions.json';
const MANIFEST = 'scripts/data/inventory-sheet-items-manifest.json';
const ACTOR = 'script:inventory-sheet-2026-10-06';
const apply = process.argv.includes('--apply'), rollback = process.argv.includes('--rollback');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const C = (category, group_name, bom_category, uom, mfg = 0) => ({ category, group_name, bom_category, uom, mfg });
const RAW = (group, bc) => C('RAW MATERIALS', group, bc, 'Nos', 1);
const ITEMS = [
  // --- already in the Item Master under another spelling ---
  ['MSP - 202', 'MS PLATES - 1.5 MM', { link: 'IM-002029' }],                    // MS PLATES 1.5/1.6 MM
  ['MSP - 208', 'MS PLSTES- 8MM', { link: 'IM-002036' }],                        // MS PLATES 8 MM (sheet typo)
  ['MSF- 312', 'MS FLAT - 25 X 5 MM', { link: 'IM-001944' }],                     // MS FLATE 25 X 4/5 MM
  ['BN - 933', 'NUTS - 1/2"', { link: 'IM-000886' }],                             // MS NUTS 1/2"
  ['BN - 934', 'NUTS - 5/8"', { link: 'IM-000887' }],                             // MS NUTS 5/8"
  ['BN - 954', 'WASHERS - 5/8"', { link: 'IM-000959' }],                          // MS WASHERS 5/8"
  ['YS / 3503', 'Y STAINER , CI , F/E , IBR - 40 MM', { link: 'IM-001438' }],     // Y STRAINER, CI, F/E, IBR 40 MM
  ['BV 3551', 'BALL VALVE, CI , F/E , NONIBR- 25 MM', { link: 'IM-001494' }],     // ... CLASS150,3/P, NONIBR-25 MM
  ['BV 3552', 'BALL VALVE, CI , F/E , NONIBR- 40 MM', { link: 'IM-001495' }],
  ['GV / 3013', 'GLOBE VALVE, CI, F/E , IBR -  40 NB', { link: 'IM-001775' }],    // GLOBE VALVE, CI, F/E, IBR 40 NB T/H
  ['CON / 2082', 'NOZZEL GEL', { link: 'IM-000354' }],                            // MIG COOLING GEL / PASTE
  ['CON / 2252', 'PENETRANT - 420 ML', { link: 'IM-002110' }],                    // PENETRANTS
  // --- genuinely missing: new rows ---
  ['BQ - 111', 'B Q PLATE - 28 MM', { create: 'BQ PLATE 28 MM', ...RAW('BQ PLATE', 'plate'), moc: 'BQ', fields: { thickness: 28 } }],
  ['BN - 898', 'BOLTS - 3/4 X 4/6"', { create: 'BOLTS 3/4" X 4/6"', ...C('HARDWARE', 'FASTENERS', 'other', 'Nos') }],
  ['CON / 2028', 'MS FILLER WIRE 2.5MM 70S', { create: 'MS FILLER WIRE 2.5 MM 70S', ...C('CONSUMABLES', 'WELDING ELECTRODE', 'other', 'Kgs') }],
  ['CON / 2059', '(CO-2) REGULATORS', { create: 'CO-2 REGULATORS', ...C('MACH MAINT', 'TOOLS', 'other', 'Nos') }],
  ['CON / 2087', 'ARGON GAS', { create: 'ARGON GAS', ...C('CONSUMABLES', 'GAS', 'other', 'Nos') }],
  ['CON / 2089', 'MIG LINER 36 KD', { create: 'MIG LINER 36 KD', ...C('CONSUMABLES', 'CUTTING NOZZLES', 'other', 'Nos') }],
  ['CON / 2207', 'THINNER - NC', { create: 'THINNER NC', ...C('CONSUMABLES', 'PAINTS', 'other', 'Ltr') }],
  ['CON / 2208', 'THINNER - PU', { create: 'THINNER PU', ...C('CONSUMABLES', 'PAINTS', 'other', 'Ltr') }],
  ['CON / 2236', 'PAINT - BROWN', { create: 'PAINT BROWN', ...C('CONSUMABLES', 'PAINTS', 'other', 'Ltr') }],
  ['GV / 3022', 'GLOBE VALVE, CI S/W , IBR -  15 NB', { create: 'GLOBE VALVE, CI, S/W, IBR 15 NB', ...C('BOI', 'MOUNTING', 'standard', 'Nos') }],
  ['PF-NON-IBR 4778', 'REDUCER HEX NIPPLE   CS   NON-IBR - 15 X 6', { create: 'REDUCER HEX NIPPLE CS NON-IBR 15 X 6 MM', ...C('', 'HEX NIPPLE', 'standard', 'Nos') }],
  ['TOOLS / 5043-1', 'ARBOUR 19.5 MM FOR BROACH CUTTER', { create: 'ARBOUR 19.5 MM FOR BROACH CUTTER', ...C('MACH MAINT', 'TOOLS', 'other', 'Nos') }],
  ['BOI-21044', 'EATHING STRIP GI 25W X 3T', { create: 'EARTHING STRIP GI 25 MM X 3 MM', ...C('', 'ELECTRICAL', 'other', 'Nos'), moc: 'GI' }],
  ['BOI-21094', 'BURNER SEQUENCE CONTROLLER-307-CGED', { create: 'BURNER SEQUENCE CONTROLLER 307-CGED', ...C('', 'ELECTRICAL', 'standard', 'Nos') }],
  ['BOI-21101', 'ETNY EG 65-50-200 PUMP SET', { create: 'ETNY EG 65-50-200 PUMP SET', ...C('BOI', 'PUMP', 'standard', 'Nos') }],
  // --- round 2 (2026-10-06): the 89 in-stock items that only had candidates, each looked up by hand ---
  ['BQ-101', 'B Q PLATE - 8 MM', { link: 'IM-000190' }],
  ['SEAMLESS PIPE - 581', 'SEAMLESS PIPE SCH 80 IBR 15 MM', { link: 'IM-002432' }],
  ['SEAMLESS PIPE - 582', 'SEAMLESS PIPE SCH 80 IBR 20 MM', { link: 'IM-002433' }],
  ['SEAMLESS PIPE - 585', 'SEAMLESS PIPE SCH 80 IBR 40 MM', { link: 'IM-002436' }],
  ['SEAMLESS PIPE - 586', 'SEAMLESS PIPE SCH 80 IBR 50 MM', { link: 'IM-002437' }],
  ['SEAMLESS PIPE - 588', 'SEAMLESS PIPE SCH 80 IBR 80 MM', { link: 'IM-002439' }],
  ['SEAMLESS PIPE - 589', 'SEAMLESS PIPE SCH 80 IBR 100 MM', { link: 'IM-002440' }],
  ['SEAMLESS PIPE - 592', 'SEAMLESS PIPE SCH 80 IBR 200 MM', { link: 'IM-002443' }],
  ['MS PIPE - 600', 'MS PIPE C CLASS - 1/2"', { link: 'IM-001960' }],
  ['BN - 918', 'BOLTS - FOUNDATION - 1" X 1250 MM', { link: 'IM-000869' }],
  ['PACK / 1004', 'ASBESTOS ROPE - 6 MM', { link: 'IM-002076' }],
  ['PACK / 1005', 'ASBESTOS ROPE - 8 MM', { link: 'IM-002077' }],
  ['PACK / 1006', 'ASBESTOS ROPE - 10 MM', { link: 'IM-002078' }],
  ['PACK / 1007', 'ASBESTOS ROPE - 12 MM', { link: 'IM-002079' }],
  ['PACK / 1008', 'ASBESTOS ROPE - 16 MM', { link: 'IM-002080' }],
  ['PACK / 1013', 'ASBESTOS GASKET - METALIC - 40 MM / 1 1/2"', { link: 'IM-002085' }],
  ['PACK / 1014', 'ASBESTOS GASKET - METALIC - 50 MM / 2"', { link: 'IM-002086' }],
  ['PACK / 1015', 'ASBESTOS GASKET - METALIC - 65 MM / 2 1/2"', { link: 'IM-002087' }],
  ['PACK / 1017', 'ASBESTOS GASKET - METALIC - 100 MM / 4"', { link: 'IM-002089' }],
  ['PACK / 1029', 'ASBESTOS GASKET - METALIC - 200 MM', { link: 'IM-002092' }],
  ['REF / 1100', 'FIRE BRICKS - STANDARD - IS 8', { link: 'IM-002343' }],
  ['REF / 1101', 'FIRE BRICKS - STANDARD - IS 6', { link: 'IM-002342' }],
  ['REF / 1110', 'FIRE CRATE CASTABLE SUPER - OTHERS - 50 KGS', { link: 'IM-002356' }],
  ['CON / 2024', 'SAW WIRE 3.15 ( EM12K ) - 1 Sproll = 25 Kgs', { link: 'IM-002748' }],
  ['CON / 2030', 'GRINDING WHEEL -7"', { link: 'IM-001156' }],
  ['CON / 2030-A', 'GRINDING WHEEL -5"', { link: 'IM-001155' }],
  ['CON / 2053', 'OXYGEN GAS - 17 KGS', { link: 'IM-001074' }],
  ['CON / 2061', 'HOSE PIPE -OXYGEN (O2) - BLUE', { link: 'IM-002663' }],
  ['CON / 2070', 'WELDING CABLES - COPPER / ALUMINIUM', { link: 'IM-002674' }],
  ['CON / 2222', 'PAINT - SILVER ( ALUMINIUM) -HR', { link: 'IM-002133' }],
  ['GV / 3047', 'GLOBE VALVE, SGI, F/E , IBR - 25 NB', { link: 'IM-001799' }],
  ['GV / 3048', 'GLOBE VALVE, SGI, F/E , IBR - 40 NB', { link: 'IM-001800' }],
  ['GV / 3049', 'GLOBE VALVE, SGI, F/E , IBR - 50 NB', { link: 'IM-001801' }],
  ['GV / 3050', 'GLOBE VALVE, SGI, F/E , IBR - 65 NB', { link: 'IM-001802' }],
  ['GV / 3051', 'GLOBE VALVE, SGI, F/E , IBR - 80 NB', { link: 'IM-001803' }],
  ['GV / 3052', 'GLOBE VALVE, SGI, F/E , IBR - 100 NB', { link: 'IM-001804' }],
  ['GV / 3054', 'GLOBE VALVE, SGI, F/E , IBR - 150 NB', { link: 'IM-001806' }],
  ['GV / 3063', 'GLOBE VALVE, CAST STEEL, F/E , IBR - 40 NB- CLASS -150', { link: 'IM-001813' }],
  ['GV / 3067', 'GLOBE VALVE, CAST STEEL, F/E , IBR - 100 NB- CLASS -150', { link: 'IM-001817' }],
  ['GV / 3086', 'GLOBE VALVE, CAST STEEL, F/E , IBR - 80 NB-  CLASS-300', { link: 'IM-001829' }],
  ['SV / 3170', 'SAFETY VALVES, CI, F/E , IBR  25 X 25NB(10.54)', { link: 'IM-001574' }],
  ['SV / 3215', 'SAFETY VALVES , CS, F/E ,  IBR - 25 NB - T/H- 17 / 19 KGS', { link: 'IM-001585' }],
  ['WLG / 3241', 'WATER LEVEL GAUGE , CAST STEEL , F/E , IBR - 20 MM-400 CC', { link: 'IM-001650' }],
  // kept apart from WLG / 3241 (CAST STEEL): the client keeps two codes, so we don't merge their stock
  ['WLG / 3242', 'WATER LEVEL GAUGE ,  STEEL , F/E , IBR - 20 MM', { create: 'WATER LEVEL GAUGE, STEEL, F/E, IBR 20 MM', ...C('BOI', 'MOUNTING', 'standard', 'Nos') }],
  ['WLG / 3244', 'WATER LEVEL GAUGE , TRANSPARANT  , F/E , IBR - 20 MM', { link: 'IM-001658' }],
  ['BDV / 3262', 'BLOW DOWN VALVE, CS, F/E , IBR  25NB', { link: 'IM-001664' }],
  ['BDV / 3263', 'BLOW DOWN VALVE, CS, F/E , IBR  40NB', { link: 'IM-001666' }],
  ['WLC / 3302', 'LEVEL SWITCH // CONTROLLER , SIDE MOUNTED , NON-IBR , 80 MM', { link: 'IM-001704' }],
  ['PF / 4125', 'BENDS , SEAMLESS , SHORT ( ELBOW) , IBR -SC/40- 50 MM (2")', { link: 'IM-000043' }],
  ['PF / 4127', 'BENDS , SEAMLESS , SHORT ( ELBOW) , IBR -SC/40- 80 MM (3")', { link: 'IM-000045' }],
  ['PF / 4128', 'BENDS , SEAMLESS , SHORT ( ELBOW) , IBR -SC/40- 100 MM (4")', { link: 'IM-000046' }],
  ['PF-NON-IBR / 4523-B', 'COUPLING , NON-IBR-SC-40 - 10 MM (3/8")', { link: 'IM-000308' }],
  ['PF-NON-IBR 4749', 'HEX NIPPLE MS  NON-IBR- 10MM (3/8")', { link: 'IM-001169' }],
  ['PF-NONIBR 4826', 'PRESSURE GAUGE - DIAL : 4" ; 0 T0 21 Kgs ; 1/4" Back Connection', { link: 'IM-002224' }],
  ['PF-NONIBR 4827', 'Thermometer - Dial : 4" x 6" Steam - 0-300 Deg C ; Bottom / Back Connection', { link: 'IM-002621' }],
  ['CI /7053', 'SUPPORT BAR   - 1132 MM - S4', { link: 'IM-002582' }],
  ['CI /7104', 'FIRE DOOR - D5 CI , FRAME SIZE:550 X 550', { link: 'IM-000364' }],
  ['10000', 'BOILER FEED PUMP : 1-17 // 2-11  //  1HP /1.5 HP', { link: 'IM-000174' }],
  ['10009', 'BOILER FEED PUMP : 5-32 // 10-16 // 7.5 HP', { create: 'BOILER FEED PUMP 5-32 // 10-16 // 7.5 HP', ...C('BOUGHT OUT ITEM', 'BOILER FEED PUMP', 'standard', 'Nos') }],
  ['MIS-18267', 'FOUNDATION BOLTS & NUTS 25 MM X 1.2/1.5 - L', { link: 'IM-001262' }],
  ['MIS-18268', 'FOUNDATION BOLTS & NUTS 32 MM X 1.2/1.5 - L', { link: 'IM-001263' }],
  ['ASSET 15005', 'WELDING MACHINE MIG "EW & M " MODEL  TAURUS 355 WITH 3 MTRS TORCH GAS HOSE ; CABLE WITH CLAMP', { link: 'IM-000022' }],
  ['SSP-003', 'COLOUR COATED SHEET -0.50MM BLUE', { create: 'COLOUR COATED SHEET 0.50 MM BLUE', ...RAW('COLOUR COATED SHEET', 'plate'), fields: { thickness: 0.5 } }],
  ['BOILER ERW - 527', 'BOILER ERW TUBES - 50.80 OD x 3.66 TH X 6.1 /6.5 MTRS', { create: 'BOILER ERW TUBES 50.80 OD X 3.66 TH X 6.1/6.5 MTR', ...RAW('ERW TUBES', 'pipe'), uom: 'Mtr' }],
  ['BOILER ERW - 529', 'BOILER ERW TUBES - 63.5 OD x 3.66 x 3.5 /3.7/3.285 MTRS', { create: 'BOILER ERW TUBES 63.5 OD X 3.66 X 3.285/3.5/3.7 MTR', ...RAW('ERW TUBES', 'pipe'), uom: 'Nos' }],
  ['BOILER ERW - 533', 'BOILER ERW TUBES - 63.5 OD x 3.66 x 5.5/5.6/5.8MTRS', { create: 'BOILER ERW TUBES 63.5 OD X 3.66 X 5.5/5.6/5.8 MTR', ...RAW('ERW TUBES', 'pipe'), uom: 'Nos' }],
  ['BOILER ERW - 546', 'BOILER ERW TUBES - 50.80 OD x 3.66 TH X 5.5/5.6 MTRS', { create: 'BOILER ERW TUBES 50.80 OD X 3.66 TH X 5.5/5.6 MTR', ...RAW('ERW TUBES', 'pipe'), uom: 'Mtr' }],
  ['MSP - APH - 662', 'APH TUBE ; BS6323 PART V - 60.3 OD X 2.34 TH X 6 MTRS', { create: 'APH TUBE BS6323 PART V 60.30 OD X 2.34 TH X 6 MTR', ...RAW('APH TUBES', 'pipe'), uom: 'Mtr' }],
  ['REF / 1104', 'SIDE ARCH BRICKS - 230 X 115 X 65 X 50', { create: 'SIDE ARCH BRICKS 230 X 115 X 65 X 50', ...C('BOI', 'REFRACTORY', 'standard', 'Nos') }],
  ['CON / 2012', 'WELDING ELECTRODES 6013   3.15 MM X 350 MM', { create: 'WELDING ELECTRODES 6013 3.15 MM X 350 MM', ...C('CONSUMABLES', 'WELDING ELECTRODE', 'other', 'Box') }],
  ['CON / 2041', 'BUFFING WHEEL - 4" - 2608601669', { create: 'BUFFING WHEEL 4" 2608601669', ...C('CONSUMABLES', 'WHEELS', 'other', 'Nos') }],
  ['CON / 2041-A', 'BUFFING WHEEL - 5" - 2608601670', { create: 'BUFFING WHEEL 5" 2608601670', ...C('CONSUMABLES', 'WHEELS', 'other', 'Nos') }],
  ['PRV / 3356', 'PRESSURE REGULATING VALVE, CS, F/E , IBR - 40 MM', { create: 'PRESSURE REGULATING VALVE, CS, F/E, IBR 40 MM', ...C('BOI', 'MOUNTING', 'standard', 'Nos') }],
  ['PRV / 3357', 'PRESSURE REGULATING VALVE, CS, F/E , IBR - 50 MM', { create: 'PRESSURE REGULATING VALVE, CS, F/E, IBR 50 MM', ...C('BOI', 'MOUNTING', 'standard', 'Nos') }],
  ['GTV/3990', 'GATE VALVE - CS - IBR - #150 50 MM', { create: 'GATE VALVE, CS, IBR, CL150, F/E, 50 MM', ...C('BOI', 'MOUNTING', 'standard', 'Nos') }],
  ['PF / 4284', 'REDUCER,  IBR -SC/40- 40 MM (11/2")', { create: 'REDUCER, IBR-SC/40-40 MM (11/2")', ...C('', 'REDUCER', 'pipe', 'Nos') }],
  ['PF / 4285', 'REDUCER,  IBR -SC/40- 50 MM (2")', { create: 'REDUCER, IBR-SC/40-50 MM (2")', ...C('', 'REDUCER', 'pipe', 'Nos') }],
  ['PF / 4286', 'REDUCER,  IBR -SC/40- 65 MM (21/2")', { create: 'REDUCER, IBR-SC/40-65 MM (21/2")', ...C('', 'REDUCER', 'pipe', 'Nos') }],
  ['PF / 4288', 'REDUCER,  IBR -SC/40- 100 MM (4")', { create: 'REDUCER, IBR-SC/40-100 MM (4")', ...C('', 'REDUCER', 'pipe', 'Nos') }],
  ['PF-NONIBR 4822', 'PRESSURE GAUGE - DIAL :  6" ; UPT0 21 Kgs ; 1/2" BSP', { create: 'PRESSURE GAUGE DIAL:6" ; 0 TO 21 Kgs ; 1/2" BSP', ...C('', 'PRESSURE GAUGE', 'standard', 'Nos') }],
  ['TOOLS / 5010', 'DRILL BIT 10 MM/10.5MM', { create: 'DRILL BIT 10/10.5 MM', ...C('TOOLS', 'DRILL BIT', 'other', 'Nos') }],
  ['TOOLS / 5044-1', 'BROCH CUTTER 44MM', { create: 'BROCH CUTTER 44 X 50 MM', ...C('BOUGHT OUT ITEM', 'BROCH CUTTER', 'standard', 'Nos') }],
  ['TOOLS / 5045', 'BROCH CUTTER 52MM', { create: 'BROCH CUTTER 52 X 50 MM', ...C('BOUGHT OUT ITEM', 'BROCH CUTTER', 'standard', 'Nos') }],
  ['CI /7057', 'SUPPORT BAR   - 660 MM - S8', { create: 'SUPPORT BAR 660 MM S8', ...C('', 'SUPPORT BAR', 'standard', 'Nos') }],
  ['CI /7063', 'SUPPORT BAR - "H" TYPE S-14 - 630 MM', { create: 'SUPPORT BAR "H" TYPE S-14 630 MM', ...C('', 'SUPPORT BAR', 'standard', 'Nos') }],
  ['CI /7066', 'SUPPORT BAR   - 1160 MM - S17', { create: 'SUPPORT BAR 1160 MM S17', ...C('', 'SUPPORT BAR', 'standard', 'Nos') }],
  ['CI /7067', 'SUPPORT BAR   - 955 MM - S18', { create: 'SUPPORT BAR 955 MM S18', ...C('', 'SUPPORT BAR', 'standard', 'Nos') }],
  ['CI /7070', 'AIR NOZZLE ,CI , TF SERIES - 32 MM TOP', { create: 'AIR NOZZLE CI, TF SERIES 32 MM TOP', ...C('BOI', 'AIR NOZZLE', 'standard', 'Nos') }],
];
const keyOf = (code, desc) => `${code}|${desc}`;
const readJson = (f, d) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d);
const audit = (action, detail) => db.execute({
  sql: 'INSERT INTO usb_audit (request_id, machine_id, actor, action, detail) VALUES (NULL, NULL, ?, ?, ?)',
  args: [ACTOR, action, JSON.stringify(detail)],
});

if (rollback) {
  const manifest = readJson(MANIFEST, []);
  const removed = [];
  for (const m of manifest) {
    const used = (await db.execute({ sql: 'SELECT (SELECT COUNT(*) FROM bom_items WHERE item_id = ?) + (SELECT COUNT(*) FROM inventory_items WHERE item_id = ?) n', args: [m.id, m.id] })).rows[0].n;
    if (used) { console.log(`  KEEP ${m.item_code} ${m.item_name} — in use`); continue; }
    await db.execute({ sql: 'DELETE FROM items WHERE id = ?', args: [m.id] });
    removed.push(m);
  }
  const decisions = readJson(DECISIONS_FILE, {});
  for (const m of removed) for (const k of Object.keys(decisions)) if (decisions[k] === m.item_code) delete decisions[k];
  writeFileSync(DECISIONS_FILE, JSON.stringify(decisions, null, 1));
  writeFileSync(MANIFEST, JSON.stringify(manifest.filter(m => !removed.includes(m)), null, 1));
  await audit('inventory_sheet_items_rollback', { removed: removed.length });
  console.log(`Removed ${removed.length} row(s).`);
  process.exit(0);
}

const byCode = new Map((await db.execute('SELECT id, item_code, item_name FROM items')).rows.map(r => [r.item_code, r]));
const byName = new Map([...byCode.values()].map(r => [String(r.item_name).trim().toUpperCase(), r]));
const decisions = readJson(DECISIONS_FILE, {});
const manifest = readJson(MANIFEST, []);
console.log(apply ? '=== APPLYING ===' : '=== DRY RUN (nothing written) ===');
let links = 0, creates = 0;
for (const [code, desc, d] of ITEMS) {
  if (d.link) {
    const t = byCode.get(d.link);
    if (!t) throw new Error(`${d.link} not found in Item Master`);
    console.log(`  LINK   ${desc}  ->  ${t.item_code} ${t.item_name}`);
    decisions[keyOf(code, desc)] = t.item_code; links++;
    continue;
  }
  const existing = byName.get(d.create.toUpperCase());
  if (existing) { console.log(`  EXISTS ${desc}  ->  ${existing.item_code} ${existing.item_name}`); decisions[keyOf(code, desc)] = existing.item_code; continue; }
  console.log(`  CREATE ${desc}  ->  "${d.create}"  (${d.category || '-'} / ${d.group_name} / ${d.bom_category}, ${d.uom})`);
  creates++;
  if (!apply) continue;
  const { lastInsertRowid } = await db.execute({
    sql: `INSERT INTO items (item_name, category, group_name, bom_category, uom, default_moc, default_category_fields_json, default_requires_manufacturing, detail_desc)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [d.create, d.category || null, d.group_name, d.bom_category, d.uom, d.moc || null, d.fields ? JSON.stringify(d.fields) : null, d.mfg,
      `Added from the Techno inventory register (code ${code}: "${desc}").`],
  });
  const id = Number(lastInsertRowid), item_code = `IM-${String(id).padStart(6, '0')}`;
  await db.execute({ sql: 'UPDATE items SET item_code = ? WHERE id = ?', args: [item_code, id] });
  manifest.push({ id, item_code, item_name: d.create, sheet: keyOf(code, desc) });
  decisions[keyOf(code, desc)] = item_code;
}
console.log(`\n${links} link(s), ${creates} new row(s).`);
if (apply) {
  writeFileSync(DECISIONS_FILE, JSON.stringify(decisions, null, 1));
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
  await audit('inventory_sheet_items_create', { created: creates, linked: links, manifest: MANIFEST });
  console.log(`Wrote ${DECISIONS_FILE} and ${MANIFEST}.`);
}
