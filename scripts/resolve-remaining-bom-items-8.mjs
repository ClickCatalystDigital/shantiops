// Round 8: "pipe_fitting" bucket. Full catalog check found the real, complete SEAMLESS PIPE (2408-
// 2446), BENDS/ELBOW (38-173), REDUCER (526-696, 2309-2332) and MS PIPE B CLASS (1980-1997)
// families. Real NB-to-OD table (standard SCH40/80): Φ33.4=25NB(1"), Φ48.3=40NB(1½"),
// Φ88.9=80NB(3"), Φ114.3=100NB(4") — used to resolve every "Φ.. x ..THK" row to its real NB size.
// "IBR ELBOWS" (SA 106 Gr.B material) map to the catalog's IBR-named "BENDS, SEAMLESS, SHORT(90)
// IBR..." family — same physical fitting the NON-IBR family separately calls "ELBOW", just named
// differently by pressure grade in this catalog. An "EXPANDER" is the same physical part as an
// ECCENTRIC REDUCER viewed the other way, matched by its stated two diameters. "MS 'B' CLASS" pipe
// fittings (bends/elbows) are a genuinely different product line from the stocked SCH-40/80 SMLS
// bend family — no B-class-specific bend/elbow exists in the catalog, so these are left unresolved
// rather than silently substituted with the wrong schedule. No SS-specific seamless pipe or SS bend
// family exists at all — every "SS PIPE"/SS bend row is left unresolved for the same reason.
import { PROJECTS, db, norm, findRows, createItem, resolveId, linkAll, decomposeAll, audit } from './lib/bom-resolve-helpers.mjs';

const apply = process.argv.includes('--apply');
const counters = { linked: 0, decomposed: 0, deleted: 0 };

const LINKS = [
  ['LONG BENDS - 90°|C.S ASTM A 234 WPB|SA 106 Gr.B, SCH-40 - 80 MM', 74],
  ['EXPANDER|C.S. 70 / 30|SA 234 WPB , SCH-40 - 50 x 125 MM', 544],
  ['DISTANCE PIPE FOR AIR VENT|MS\'B\' CLASS|15NB X 1000 Lg', 1980],
  ['RALING PIPE-40NB|MS-IS 1239|40 NB \' B\' CLASS', 1983],
  ['STRAIGHT SHELL-1 (PIPE)|MS|OD 600 X 10000 x 6 THK', 2035],
  ['STRAIGHT SHELL-1 (PIPE)|MS|OD 600 X 10000 x 5 THK', 2034],
  ['TOP RALING PIPE-25NB|MS-IS 1239|25 NB \' B\' CLASS', 1982],
  ['AIR DISTRIBUTOR PIPE|MS|40 MMx \'B\' CLASS', 1983],
  ['BENDS - 90DEG|C.S-SMLS|Φ48.3 x (SCH-40)', 42],
  ['ELBOW - 45 DEG|C.S-SMLS|Φ114.3 x 6.02 THK (SCH-40)', 60],
  ['ELBOW - 90 DEG|C.S-SMLS|Φ114.3 x 6.02 THK (SCH-40)', 46],
  ['ELBOW - 90 DEG|C.S-SMLS|Φ88.9 x 5.49 THK (SCH-40)', 45],
  ['HEADER PIPE|MS \'B\' CLASS|100 NB x MS \'B\' CLASS', 1986],
  ['PIPE|C.S-SMLS|Φ114.3 x 6.02 THK (SCH-40) - 8500 Lg', 2416],
  ['PIPE|C.S-SMLS|Φ88.9 x 5.49 THK (SCH-40) - 9000 Lg', 2415],
  ['PIPE|C.S-SMLS|Φ33.4 x 3.21 THK (SCH-40)', 2410],
  ['PIPE ( AIR VENT)|MS|25 MM , MS \'B\' CL', 1982],
  ['PIPE (BLOW DOWN)|MS|50 MM , MS \'B\' CL', 1984],
  ['PIPE (DRAIN LINE WLG,WLC ETC.,)|MS|15 MM , MS \'B\' CL', 1980],
  ['BEND|MS|3.15 THK- (400 SQ)', 2844],
  ['BEND - HAB3|MS|547 x 547x3.15 THK- (400 SQ)', 2844],
  ['BEND - HAB6|MS|547 x 547x3.15 THK- (400 SQ)', 2844],
  ['BEND-HAB1|MS|547 x 547x3.15 THK- (400 SQ)', 2844],
  ['FGB12 - 45 DEG BEND|MS|3.15 THK- (500 SQ.)', 2844],
  ['MS PIPES|MS \'B\' CLASS|5"', 1987],
  ['FUEL FEEDER PIPE|MS|5" x \'B\' CLASS', 1987],
  ['IBR ELBOWS|CS|100 MM , SA 106 Gr.B-SCH-40', 46],
  ['IBR ELBOWS|CS|80 MM , SA 106 Gr.B-SCH-40', 45],
  ['IBR ELBOWS|CS|65 MM , SA 106 Gr.B-SCH-40', 44],
  ['PIPE|C.S-SMLS|Φ48.3 x 5.54 THK (SCH-40)', 2412],
  ['PIPE||25 NB X \'B\' CL X 1000 Lg', 1982],
  ['PIPE|C.S|100 MM , SA 106 Gr.B-SCH-40', 2416],
  ['PIPE|C.S|80 MM , SA 106 Gr.B-SCH-40', 2415],
  ['PIPE|C.S|65 MM , SA 106 Gr.B-SCH-40', 2414],
  ['PIPE|MS \'B\' CL|4"', 1986],
  ['PIPE|C.S|200NB, SA 106 Gr.B SCH-40 SMLS', 2419],
  ['PIPE|C.S|100 NB, SA 106 Gr.B SCH-40 SMLS', 2416],
  ['PIPE|C.S|80 NB, SA 106 Gr.B SCH-40 SMLS', 2415],
  ['PIPE|C.S|65 NB, SA 106 Gr.B SCH-40 SMLS', 2414],
  ['PIPE|C.S|40 NB, SA 106 Gr.B SCH-40 SMLS', 2412],
  ['PIPE|C.S|25 NB, SA 106 Gr.B SCH-40 SMLS', 2410],
];

console.log(apply ? '=== APPLYING (round 8: pipe_fitting) ===\n' : '=== DRY RUN (round 8: pipe_fitting, nothing written) ===\n');
for (const [key, itemId] of LINKS) await linkAll(key, itemId, apply, counters);
console.log(`\n${counters.linked} linked.`);
if (apply) await audit('pipe_fitting', counters);
