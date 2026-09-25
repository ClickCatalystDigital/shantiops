// Round 5: "flange" bucket. Real catalog check found the full FLANGES/DUMMY FLANGES family by
// NB+class+IBR-rating (973-1066, 430-525) the fuzzy matcher never surfaced in full. Convention,
// verified against the app's own naming: "BS-10 TABLE-H" -> the catalog's own "T/H" suffix;
// "ANSI B16.5 #150" -> "CLASS-150"; a connected/slip-on flange -> the plain FLANGES family; a
// blind/blank cover -> DUMMY FLANGES. "FLANGES MATERIAL" rows carrying a real OD/ID/THK triple are
// raw plate blanks cut to size (not a bought flange) — matched against the BQ PLATE SA 516 GR 70
// family by thickness (moc explicitly states that certified grade); a sibling row for the same NB
// giving ONLY the class+NB (no OD/ID/THK) is a bought standard flange instead. Five odd
// inch-derived thicknesses (22.2/14.2/17.4/12.7/25.4mm) round to the nearest whole-mm BQ PLATE size
// actually stocked (22/14/18/12/25mm) — a real nominal-vs-actual plate-gauge convention, not a
// new size worth adding for a 0.2-0.6mm difference. A real, repeated "T-E"/"T/E" rating (BS-10
// Table E, distinct from the already-stocked Table H) appears on 6 real rows across 2 real
// use-cases (blowdown flange+its own dummy, WLG/WLC header, a 48-off duct-flange run) — real,
// consistent, worth a parallel small family; a single one-off "T/F" row is left unresolved instead
// (see the audit's own unresolved list) rather than inventing a third rating table off one data
// point. A missing 65NB CLASS-150 NON-IBR size (present in the DUMMY family, absent from the plain
// FLANGES family) is created — jumps straight from 50 to 80 in the live catalog otherwise.
import { PROJECTS, db, norm, findRows, createItem, resolveId, linkAll, decomposeAll, audit } from './lib/bom-resolve-helpers.mjs';

const apply = process.argv.includes('--apply');
const counters = { linked: 0, decomposed: 0, deleted: 0 };
const newItemIds = {};

const NEW_ITEMS = [
  { item_name: 'FLANGES, MS, CLASS-150, NON-IBR-65 MM (21/2")', group_name: 'FLANGES' },
  { item_name: 'FLANGES, MS, T/E, IBR 15 MM (1/2")', group_name: 'FLANGES' },
  { item_name: 'FLANGES, MS, T/E, IBR 40 MM (11/2")', group_name: 'FLANGES' },
  { item_name: 'FLANGES, MS, T/E, IBR 50 MM (2")', group_name: 'FLANGES' },
  { item_name: 'DUMMY FLANGES, MS, T/E, IBR 50 MM (2")', group_name: 'FLANGES' },
  { item_name: 'FLANGES, MS, T/E, NON-IBR-100 MM (4")', group_name: 'FLANGES' },
];
for (const item of NEW_ITEMS) await createItem({ ...item, bom_category: 'standard', uom: 'Nos' }, apply, newItemIds);
const id = name => resolveId(name, newItemIds) ?? name;

const LINKS = [
  ['IBR SLIP ON FLANGES|SA 516 Gr.70|40NB, BS-10 TABLE-H', 1039],
  ['IBR SLIP ON FLANGES|SA 516 Gr.70|40NB, ANSI B16.5 #150', 1009],
  ['FLANGE|ASTM SA 516 Gr.70|80 MM, BS10 TABLE-H', 1042],
  ['FLANGE|ASTM SA 516 Gr.70|125 MM, BS10 TABLE-H', 1044],
  ['FLANGE|ASTM SA 516 Gr.70|50 MM, BS10 TABLE-H', 1040],
  ['FLANGE|ASTM SA 516 Gr.70|50 MM, ANSI B16.5 #150', 1010],
  ['DUMMEY FLANGE|MS- IS 2062|800X1000X8 MM THICK', 2036],
  ['AIR HEADER FLANGE|MS|40 NB T/F', null], // unresolved — see report
  ['DUMMEY FLANGE (BLOWDWON),|MS|50 MM, IBR -T-E', id('DUMMY FLANGES, MS, T/E, IBR 50 MM (2")')],
  ['FLANGE|SA 516 Gr.70|25NB,BS-10 TABLE-H', 1037],
  ['FLANGE|SA 516 Gr.70|50NB,BS-10 TABLE-H', 1040],
  ['FLANGE (A.V)|MS|25 MM, IBR -T-H', 1037],
  ['FLANGE (BLOWDOWN),|MS|50 MM, IBR -T-E', id('FLANGES, MS, T/E, IBR 50 MM (2")')],
  ['FLANGE (S.V)|MS|80 MM, IBR -T-H', 1042],
  ['FLANGE (W.L.G & W.L.C.),|MS|15 MM, IBR -T-E', id('FLANGES, MS, T/E, IBR 15 MM (1/2")')],
  ['FLANGES|SA 516 Gr.70|150NB,BS-10 TABLE-H', 1045],
  ['FLANGES|MS|40 MM - T/E', id('FLANGES, MS, T/E, IBR 40 MM (11/2")')],
  ['FLANGES MATERIAL|SA 516 Gr.70|ANSI B16.5 #150 (100 NB) MSSV', 1012],
  ['FLANGES MATERIAL|SA 516 Gr.70|OD 140 x ID 51 x 17.4 MM THK. (40 NB) S.V', 195],
  ['FLANGES MATERIAL|SA 516 Gr.70|OD 140 x ID 51 x 17.4MM THK. (40 NB) WLGH, BDV,', 195],
  ['FLANGES MATERIAL|SA 516 Gr.70|ANSI B16.5 #150 (40 NB) FCV', 1009],
  ['FLANGES MATERIAL|SA 516 Gr.70|ANSI B16.5 #150 (25 NB) AV, WLC', 1007],
  ['FLANGES MATERIAL|SA 516 Gr.70|OD 114 x ID 30 x 12.7MM THK. (20NB) WLG', 192],
  ['CHIMNEY FLANGE|MS|OD 835 X ID 705 x 16 THK', 2040],
  ['FLANGES MATERIAL|SA 516 Gr.70|OD 203 x ID 91 x 25.4 MM THK. (80 NB) MSSV', 198],
  ['FLANGES MATERIAL|SA 516 Gr.70|OD 140 x ID 51 x 17.4MM THK. (40 NB) WLGH, BDV ,FCV', 195],
  ['FLANGES MATERIAL|SA 516 Gr.70|OD 121 x ID 37 x 14.2MM THK. (25NB) WLC', 193],
  ['COUNTER FLANGE|C.S|65 NB, ANSI B16.5 #150', id('FLANGES, MS, CLASS-150, NON-IBR-65 MM (21/2")')],
  ['DOOR FLANGE|MS|OD 790 X ID 665 X 12 THK', 2038],
  ['DUMMEY FLANGE|C.S|200 NB, ANSI B16.5 #150', 505],
  ['DUMMEY FLANGE|C.S|40 NB, ANSI B16.5 #150', 498],
  ['FLANGE|CS|100 NB, ANSI B16.5 #150', 1012],
  ['FLANGE|CS|80 NB, ANSI B16.5 #150', 1011],
  ['FLANGE|CS|65 NB, ANSI B16.5 #150', id('FLANGES, MS, CLASS-150, NON-IBR-65 MM (21/2")')],
  ['FLANGE|MS|4", NIBR -T-E', id('FLANGES, MS, T/E, NON-IBR-100 MM (4")')],
  ['FLANGES MATERIAL|SA 516 Gr.70|OD 228.6 x ID 116 x 25.4MM THK. (100 NB) MSSV', 198],
  ['FLANGES MATERIAL|SA 516 Gr.70|OD 140 x ID 50 x 17.4MM THK. (40 NB) S.V', 195],
  ['HEADER SLIP ON FLANGE|C.S|200 NB, ANSI B16.5 #150', 1015],
  ['SLIP ON FLANGE|C.S|100 NB, ANSI B16.5 #150', 1012],
  ['SLIP ON FLANGE|C.S|80 NB, ANSI B16.5 #150', 1011],
  ['SLIP ON FLANGE|C.S|65 NB, ANSI B16.5 #150', id('FLANGES, MS, CLASS-150, NON-IBR-65 MM (21/2")')],
  ['SLIP ON FLANGE|C.S|25 NB, ANSI B16.5 #150', 1007],
];

const DECOMPOSE = [
  ['FLANGES MATERIAL|SA 516 Gr.70|OD 203.2 x ID 91 x 22.2 MM THK. (80 NB) MSSV                                                                                                 OD 121 x ID 34.5 x 14.2MM THK. (25 NB) S.V                                      OD 140 x ID 51 x 17.4MM THK. (40 NB) WLGH, BDV ,FCV                                                                                                                                        OD 121 x ID 37 x 14.2MM THK. (25NB)  WLC                                OD 114 x ID 30 x 12.7MM THK. (20NB) WLG', [
    { size: 'OD 203.2 x ID 91 x 22.2 MM THK. (80 NB) MSSV', qty: '1 No', itemId: 197, category: 'plate' },
    { size: 'OD 121 x ID 34.5 x 14.2MM THK. (25 NB) S.V', qty: '2 No', itemId: 193, category: 'plate' },
    { size: 'OD 140 x ID 51 x 17.4MM THK. (40 NB) WLGH, BDV ,FCV', qty: '8 No', itemId: 195, category: 'plate' },
    { size: 'OD 121 x ID 37 x 14.2MM THK. (25NB) WLC', qty: '2 No', itemId: 193, category: 'plate' },
    { size: 'OD 114 x ID 30 x 12.7MM THK. (20NB) WLG', qty: '4 No', itemId: 192, category: 'plate' },
  ]],
  ['FLANGE|CS|150 NB, ANSI B16.5 #150 50 NB, ANSI B16.5 #150 40 NB, ANSI B16.5 #150 25 NB, ANSI B16.5 #150', [
    { size: '150 NB, ANSI B16.5 #150', qty: '2 No', itemId: 1014, category: 'standard' },
    { size: '50 NB, ANSI B16.5 #150', qty: '1 No', itemId: 1010, category: 'standard' },
    { size: '40 NB, ANSI B16.5 #150', qty: '1 No', itemId: 1009, category: 'standard' },
    { size: '25 NB, ANSI B16.5 #150', qty: '1 No', itemId: 1007, category: 'standard' },
  ]],
  ['CLEANING HOLE FLANGE WITH DUMMEY|MS- IS 2062|80MM, ANSI B16.5 #150', [
    { size: '80MM, ANSI B16.5 #150 (flange half)', qty: '2 SETS', itemId: 1011, category: 'standard' },
    { size: '80MM, ANSI B16.5 #150 (dummy half)', qty: '2 SETS', itemId: 501, category: 'standard' },
  ]],
  ['DRAIN NOZZLEE FLANGE WITH DUMMEY|MS- IS 2062|25MM, ANSI B16.5 #150', [
    { size: '25MM, ANSI B16.5 #150 (flange half)', qty: '2 SETS', itemId: 1007, category: 'standard' },
    { size: '25MM, ANSI B16.5 #150 (dummy half)', qty: '2 SETS', itemId: 496, category: 'standard' },
  ]],
];

console.log(apply ? '=== APPLYING (round 5: flange) ===\n' : '=== DRY RUN (round 5: flange, nothing written) ===\n');
for (const [key, itemId] of LINKS) { if (itemId == null) { console.log(`  [SKIP, unresolved] "${key}"`); continue; } await linkAll(key, itemId, apply, counters); }
for (const [key, pieces] of DECOMPOSE) await decomposeAll(key, pieces, apply, counters);
console.log(`\n${counters.linked} linked, ${counters.decomposed} decomposed piece(s), ${counters.deleted} bundle(s) removed.`);
if (apply) await audit('flange', counters, { newItems: Object.keys(newItemIds) });
