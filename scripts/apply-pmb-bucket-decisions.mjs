// Applies the Bucket 1 (proven existing-item mappings, via exact-memory) + Bucket 2 (12 approved
// new Item Master rows) decisions from the full per-item PMB classification pass. Bucket 3/4 are
// deliberately NOT written anywhere — Bucket 3 items are excluded by definition (no Item Master
// row), Bucket 4 items are left exactly as they are, untouched, pending further review.
//
// Bucket 1 seeds EXACT memory only (never family memory) — each decision below is a specific,
// individually-verified (description, moc, size) match to one specific catalog row, not a general
// "this alias always means this family" rule (that's what the earlier plate/flat family seeds were
// for, already applied). Exact memory is the correct mechanism here: it bypasses keyDim entirely
// (many of these gaps are keyDim/inferCategory text-format gaps, not real ambiguity), and never
// touches the general matcher's code.
//
// The DECISIONS array's `key` values are copy-pasted verbatim from a fresh --json dump of
// scripts/verify-pmb-mapping.mjs (never hand-retyped) — if a key here doesn't match a real item in
// that dump, this script reports it as a MISS rather than silently skipping it.
//
// Usage: node --env-file=.env.local scripts/apply-pmb-bucket-decisions.mjs [--apply]
import { createClient } from '@libsql/client';
import { memoryKeys, DIMENSIONAL } from '../lib/item-attributes.mjs';
import { buildCatalogIndex } from '../lib/item-match.mjs';

const apply = process.argv.includes('--apply');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const ACTOR = 'script:item-master-standardize';

// ---------------------------------------------------------------------------------------------
// Bucket 2 — the 12 approved new Item Master rows.
// ---------------------------------------------------------------------------------------------
const NEW_ITEMS = [
  { item_name: 'ELBOW THREADED, SMLS, SCH-40, 15 MM (1/2")', group_name: 'ELBOW THREADED', bom_category: 'pipe', default_moc: 'SMLS' },
  { item_name: 'ACOSET 25 KGS BAG', group_name: 'ACOSET', bom_category: 'other', default_moc: null },
  { item_name: 'ACOSET 50 KGS BAG', group_name: 'ACOSET', bom_category: 'other', default_moc: null },
  { item_name: 'CERAMIC BLANKET 25MM, DENSITY 64', group_name: 'CERAMIC BLANKET', bom_category: 'other', default_moc: null },
  { item_name: 'HEXNIPPLE FOR Pr.Gauge', group_name: 'HEXNIPPLE', bom_category: 'standard', default_moc: null },
  { item_name: 'IBR REDUCER HEXNIPPLE FOR Pr.Gauge', group_name: 'HEXNIPPLE', bom_category: 'standard', default_moc: 'ASTM SA 105' },
  { item_name: 'REDUCER COUPLING FOR Pr.Gauge', group_name: 'COUPLING', bom_category: 'standard', default_moc: null },
  { item_name: 'KEY WAY', group_name: 'KEY WAY', bom_category: 'other', default_moc: null },
  { item_name: 'M.S FASTENERS WITH WASHERS', group_name: 'FASTENERS', bom_category: 'standard', default_moc: 'MS' },
  { item_name: 'THERMO COUPLING 1/2" F', group_name: 'THERMO COUPLING', bom_category: 'standard', default_moc: 'MS' },
  { item_name: 'REFLEX GLASS', group_name: 'REFLEX GLASS', bom_category: 'standard', default_moc: 'GLASS' },
  { item_name: 'RING SPANER for MH/MD bolts opening (BOILER TOOLS)', group_name: 'BOILER TOOLS', bom_category: 'other', default_moc: null },
];

// ---------------------------------------------------------------------------------------------
// Bucket 1 — key (verbatim from the JSON dump) -> the confirmed target catalog item's real name.
// ---------------------------------------------------------------------------------------------
const DECISIONS = [
  // --- Pipe: NB+class / NB+schedule, ASME B36.10-confirmed ---
  ["MS  PIPE|MS|40 NB, 'B' CLASS", 'MS PIPE B CLASS 1 1/2"'],
  ["MS PIPE|MS|25 NB, 'B' CLASS", 'MS PIPE B CLASS 1"'],
  ["MS PIPE|MS|20 NB, 'B' CLASS", 'MS PIPE B CLASS 3/4"'],
  ["MS PIPE|MS|40 NB, 'B' CLASS", 'MS PIPE B CLASS 1 1/2"'],
  ['MS PIPES|MS \'B\' CLASS|6"', 'MS PIPE B CLASS 6"'],
  ["RALING PIPE-40NB|MS|40 NB ' B' CLASS", 'MS PIPE B CLASS 1 1/2"'],
  ["TOP RALING PIPE-25NB|MS|25 NB ' B' CLASS", 'MS PIPE B CLASS 1"'],
  ["SAMPLING PORT|MS|50 NB 'B' CLASS", 'MS PIPE B CLASS 2"'],
  ['PIPE|C.S-SMLS|Φ88.9 X 5.49 THK (SCH-40)   - 7500 LG', 'SEAMLESS PIPE SCH 40 IBR 80 MM (3")'],
  ['PIPE|C.S-SMLS|Φ88.9 X 5.49 THK (SCH-40)   - 4000 LG', 'SEAMLESS PIPE SCH 40 IBR 80 MM (3")'],
  ['PIPE|C.S-SMLS|Φ48.3 X 3.68 THK (SCH-40)', 'SEAMLESS PIPE SCH 40 IBR 40 MM (1 1/2")'],
  ['PIPE|C.S, SMLS|SA 106 GR.B, SCH-40 - 50 MM X 170LG', 'SEAMLESS PIPE SCH 40 IBR 50 MM (2")'],
  ['PIPE|CS|150 NB, X SCH-40 X 400 LG.', 'SEAMLESS PIPE SCH 40 IBR 150 MM (6")'],
  ['PIPE|CS|100 NB, X SCH-40 X 300 LG.', 'SEAMLESS PIPE SCH 40 IBR 100 MM (4")'],
  ['PIPE|CS|50 NB, X SCH-40 X 200 LG.', 'SEAMLESS PIPE SCH 40 IBR 50 MM (2")'],
  ['PIPE|CS|40 NB, X SCH-40 X 200 LG.', 'SEAMLESS PIPE SCH 40 IBR 40 MM (1 1/2")'],
  ['PIPE|CS|25 NB, X SCH-40 X 200 LG.', 'SEAMLESS PIPE SCH 40 IBR 25 MM (1")'],
  ['SEAMLESS PIPE|C.S, SMLS|SA 106 GR.B , SCH-40 - 80 MM X 2500LG', 'SEAMLESS PIPE SCH 40 IBR 80 MM (3")'],
  ['SEAMLESS PIPE|C.S, SMLS|SA 106 GR.B, SCH-40 - 125 MM X 1150LG', 'SEAMLESS PIPE SCH 40 IBR 125 MM (5")'],
  ['SEAMLESS PIPE|C.S, SMLS|SA 106 GR.B, SCH-40 - 100 MM X 1150LG', 'SEAMLESS PIPE SCH 40 IBR 100 MM (4")'],
  ['TUBES|BS 6323, PT-V-ERW-1|OD 60.3 X 2.34THK X 1950 LG.', 'APH TUBE BS6323 PART V 60.30 OD X 2.34 TH X 6.1 MTR'],
  ['TUBES|BS 6323, PT-V-ERW-1|OD 60.3 X 2.34THK  X 1950 LG.', 'APH TUBE BS6323 PART V 60.30 OD X 2.34 TH X 6.1 MTR'],
  // SA106GrB stub/header lines whose wall thickness matches the stated schedule exactly (ASME B36.10)
  ['DOWN COMER STUB|SA 106 GR.B|Φ114.3 X 6.02 THK (SCH-40)   - 155LG', 'SEAMLESS PIPE SCH 40 IBR 100 MM (4")'],
  ['DOWN COMER STUB|SA 106 GR.B|Φ88.9 X 5.49 THK (SCH-40)   - 105G', 'SEAMLESS PIPE SCH 40 IBR 80 MM (3")'],
  ['FRUANCE ROOF HEADER|SA 106 GR.B|Φ168.3 X 7.11 THK (SCH-40)   - 3627LG', 'SEAMLESS PIPE SCH 40 IBR 150 MM (6")'],
  ['REAR WALL BOTTOM HEADER|SA 106 GR.B|Φ114.3 X 6.02 THK (SCH-40)   - 1204LG', 'SEAMLESS PIPE SCH 40 IBR 100 MM (4")'],
  ['RISER HEADER|SA 106 GR.B|Φ114.3 X 6.02 THK (SCH-40)   - 2077LG', 'SEAMLESS PIPE SCH 40 IBR 100 MM (4")'],
  ['RISER STUB|SA 106 GR.B|Φ114.3 X 6.02 THK (SCH-40)   - 130G', 'SEAMLESS PIPE SCH 40 IBR 100 MM (4")'],
  ['SIDE WALL BOTTOM HEADER|SA 106 GR.B|Φ168.3 X 7.11 THK (SCH-40)   - 5000LG', 'SEAMLESS PIPE SCH 40 IBR 150 MM (6")'],
  ['SIDE WALL END HEADER|SA 106 GR.B|Φ114.3 X 6.02 THK (SCH-40)   - 3030LG', 'SEAMLESS PIPE SCH 40 IBR 100 MM (4")'],

  // --- Instrument fittings, exact class+size match ---
  ['IBR COUPLING FOR PR.GAUGE|ASTM SA 105|1/2" -3000 LBS', 'COUPLING (SOCKET WELD) IBR-CLASS#3000 15 MM (1/2")'],
  ['IBR COUPLING FOR PR.GAUGE|ASTM SA 105|3/8" - 3000 LBS', 'COUPLING (SOCKET WELD) IBR-CLASS#3000-8 MM (3/8")'],

  // --- Metallic gaskets, NB explicit in the PMB's own text ---
  ['METALIC GASKETS||OD228 X ID116 X 3MM THK (100 MM)', 'ASBESTOS CUT GASKET-METALIC 100 MM / 4"'],
  ['METALIC GASKETS||OD 203 X ID91 X 3MM THK (80 MM)', 'ASBESTOS CUT GASKET-METALIC 80 MM / 3"'],
  ['METALIC GASKETS||OD 92 X ID 62 X 3MM THK. (50 MM)', 'ASBESTOS CUT GASKET-METALIC 50 MM / 2"'],
  ['METALLIC GASKET FOR NOZZLE||OD 305 X ID 171 X 3MM THK. (150 NB)', 'ASBESTOS CUT GASKET-METALIC 150 MM / 6"'],
  ['METALLIC GASKET FOR NOZZLE||OD 165 X ID 62 X 3MM THK. (50 NB)', 'ASBESTOS CUT GASKET-METALIC 50 MM / 2"'],
  ['METALLIC GASKET FOR NOZZLE||OD121 X ID 35 X 3MM THK. (25 NB)', 'ASBESTOS CUT GASKET METALIC 25 MM / 1"'],
  ['METALLIC GASKET FOR NOZZLE|METALIC|OD 127 X ID91 X 3MM THK. (80 NB) MSSV', 'ASBESTOS CUT GASKET-METALIC 80 MM / 3"'],
  ['METALLIC GASKET FOR NOZZLE|METALIC|OD 51 X ID 37 X 3MM THK. (25 NB) S.V', 'ASBESTOS CUT GASKET METALIC 25 MM / 1"'],
  ['METALLIC GASKET FOR NOZZLE|METALIC|OD 73 X ID 50 X 3MM THK. (40 NB) WLGH, BDV ,FCV', 'ASBESTOS CUT GASKET-METALIC 40 MM / 1 1/2"'],
  ['METALLIC GASKET FOR NOZZLE|METALIC|OD 51 X ID 37 X 3MM THK. (25NB) WLC', 'ASBESTOS CUT GASKET METALIC 25 MM / 1"'],
  ['METALLIC GASKET FOR NOZZLE|METALIC|OD 43 X ID 30 X 3MM THK. (20NB) WLG', 'ASBESTOS CUT GASKET METALIC 20 MM / 3/4"'],
  ['METALLIC GASKET FOR NOZZLE|METALIC|OD 73 X ID 50 X 3MM THK. (40NB)', 'ASBESTOS CUT GASKET-METALIC 40 MM / 1 1/2"'],
  ['METALLIC GASKET FOR NOZZLE|METALLIC|OD 73 X ID 51 X 3MM THK. (40 NB)', 'ASBESTOS CUT GASKET-METALIC 40 MM / 1 1/2"'],
  ['METALLIC GASKET FOR NOZZLE|METALLIC|OD 51 X ID 37 X 3MM THK. (25NB)', 'ASBESTOS CUT GASKET METALIC 25 MM / 1"'],
  ['METALLIC GASKET FOR NOZZLE|METALLIC|OD 73 X ID 50 X 3MM THK.    (40NB)', 'ASBESTOS CUT GASKET-METALIC 40 MM / 1 1/2"'],

  // --- Plate-family: blocked only by a keyDim/inferCategory text-format gap, target confirmed by thickness ---
  ['BRACKET|MS|200 X 35 X 6T', 'MS PLATES 6 MM'],
  ['BRACKET||200 X 35 X 6T', 'MS PLATES 6 MM'],
  ['CHIMNEY SUPPORT GUSSETS|MS|240 X 450 X 12 THK', 'MS PLATES 12 MM'],
  ['CHIMNEY SUPPORT GUSSETS|MS|250 X 265 X 16 THK', 'MS PLATES 16 MM'],
  ['EARTHING STRIP|GI|25 W X 3T', 'GI SRTIP 25 X 3 MM'],
  ['LIFITING HOOKS|MS|275 X 250 X 16T', 'MS PLATES 16 MM'],
  ['LIFITING HOOKS||275 X 250 X 16T', 'MS PLATES 16 MM'],
  ['LIFTING HOOKS PAD|MS|200 X 80 X 10T', 'MS PLATES 10 MM'],
  ['LIFTING HOOKS PAD||200 X 80 X 10T', 'MS PLATES 10 MM'],
  ['MS SADDLE|MS|1250 X 4000 X 10 THK', 'MS PLATES 10 MM'],
  ['MS SADDLE|MS|600 X 2500 X 12 THK', 'MS PLATES 12 MM'],
  ['SIDE STRIP|MS|370 X 60 X 5T', 'MS PLATES 5 MM'],
  ['SIDE STRIP||370 X 60 X 5T', 'MS PLATES 5 MM'],
  ['TOP STRIP|MS|225 X 60 X 5T', 'MS PLATES 5 MM'],
  ['TOP STRIP||225 X 60 X 5T', 'MS PLATES 5 MM'],
  ['COVER|MS|500X600X6T', 'MS PLATES 6 MM'],
  ['COVER||500X600X6T', 'MS PLATES 6 MM'],
  ['FIXING PLATE||405 X 70 X 5T', 'MS PLATES 5 MM'],
  ['FIXING PLATE|MS|405 X 70 X 5T', 'MS PLATES 5 MM'],
  ['SHEET||1250 X 500 X 4 THK', 'MS PLATES 4 MM'],
  ['SHEET||500 X 210 X 5T', 'MS PLATES 5 MM'],
  ['SHEET||400 X 210 X 5T', 'MS PLATES 5 MM'],
  ['SHEET|MS|500 X 210 X 5T', 'MS PLATES 5 MM'],
  ['SHEET|MS|400 X 210 X 5T', 'MS PLATES 5 MM'],
  ['TOP PLATE|MS|200X200X10THK', 'MS PLATES 10 MM'],
  ['FIN PLATE|IS 2062|65 X 762 X 5 THK', 'MS PLATES 5 MM'],
  ['FIN|IS 2062|FLAT 40 X 5 THK', 'MS FLATE 40 X 5 MM // 6 MM'],
  ['COLD AIR DUCT||1250 X 2500 X 3.15 THK- (300 SQ)', 'MS PLATES 3.15 MM'],
  ['HOT AIR DUCT||1250 X 2500 X 3.15 THK- (300 SQ)', 'MS PLATES 3.15 MM'],
  ['MS DUCT|MS - IS2062|450SQ X 3.15TH', 'MS PLATES 3.15 MM'],
  ['FLANGES MATERIAL|MS|1250X2500X6 MM THICK', 'MS PLATES 6 MM'],
  ['CHEQUERED PLATE|MS|1850X1850X3.15`', 'MS CHQEURED PLATES 3.15 MM'],
  ['CHEQUERED PLATE|MS|2000X2000X3.15`', 'MS CHQEURED PLATES 3.15 MM'],
  ['ALUMINIUM FLAT|ALUMINIUM|25 W X 1.5T', 'ALUMINIUM FLAT 25 MM X 1.5 MM'],

  // --- Square rod, existing sizes, blocked by keyDim's "SQ" prefix requirement ---
  ['MS SQUARE ROD (MH & MUD HOLE)||65X65-400LG', 'MS SQUARE ROD 65 MM (1 MTR 40 KGS)'],
  ['MS SQUARE ROD (MH & MUD HOLE)||50X50-240LG', 'MS SQUARE ROD 50 MM (1 MTR 19.75 KGS)'],

  // --- Round rod, existing size ---
  ['LADDER STEP||Ø16', 'MS ROD 16 MM (1 MTR 1.60 KGS)'],
  ['REFRACTORY ANCHOR RODS|MS|6MM DIA - 6000 LG', 'MS ROD 6 MM (1 MTR 0.22 KGS)'],

  // --- Real, unambiguous single-candidate name matches ---
  ['CABLE TIES 100 MM||', 'CABLE TRAY 100 MM'],
  ['CABLE TIES 150 MM||', 'CABLE TRAY 150 MM'],
  ['MCB CHANNEL WITH HOLE||', 'CHANNEL MCB'],
  ['PVC CHANNEL 25X45||', 'CHANNEL PVC 25/45'],
  ['11 PIN PLA RELAY 240 VAC WITH BASE||', 'RELAY WITH BASE 11 PIN'],
  ['MDC CONES WITH SUITABLE VANES|CI|9 " X 450 HT.', 'CI CONES SIZE:OD 290 MM X HEIGHT 897 MM WITH VANES'],
  ['MOBREY SWITCH||', 'MOBRAY SWITCH'],
  ['SS FLOT (IN MOBREY CONTROLLER)|SS|-', 'MOBRAY SS FLOAT'],
  ['SLEEVE (CHECK NUT)|-|H312', 'SLEEVES H-312'],
  ['SLEEVE (CHECK NUT)|-|H315', 'SLEEVES H-315'],
  ["V' BELT|-|B-116 \"", 'V BELTS B GROOVE 116 INCH'],
  ["V' BELT|-|B-96 \"", 'V BELTS B GROOVE 96 INCH'],
  ['VOLTSELECTOR SWITCH 6 AMPS||', 'VOLT SELECTOR SWITCH 3PH 6 AMPS'],
  ['VOLT METER 96/96 0-500 VOLTS||', 'VOLT METER 0 TO 500V SIZE 96/96'],
  ['CLIP ON TERMINAL KHAKI 6 SQ MM||', 'TERMINAL CLIPS 6 SQMM'],
  ['CLIP ON TERMINAL KHAKI 10 SQ MM||', 'TERMINAL CLIPS 10 SQMM'],
  ['INSULATED LUGS 1.5 SQ MM PIN TYPE||', 'LUGS PIN TYPE 1.5 SQMM'],
  ['INSULATED LUGS 2.5 SQ MM PIN TYPE||', 'LUGS PIN TYPE 2.5 SQMM'],
  ['INSULATED LUGS 4 SQ MM PIN TYPE||', 'LUGS PIN TYPE 4 SQMM'],
  ['INSULATION TAPE RED, BLUE, YELLOW, BACK||', 'INSULATION TAPE'],
  ['LED LAMPS 240 VAC 22.5 MM BLUE||', 'INDICATING LIGHTS ND1622D/2 230V BLU'],
  ['LED LAMPS 240 VAC 22.5 MM GREEN||', 'INDICATING LIGHTS ND1622D/2 230V GREEN'],
  ['LED LAMPS 240 VAC 22.5 MM RED||', 'INDICATING LIGHTS ND1622D/2 230V RED'],
  ['LED LAMPS 240 VAC 22.5 MM YELLOW||', 'INDICATING LIGHTS ND1622D/2 230V YEL LOW'],
  ['PUSH BUTTON 22.5MM GREEN||', 'PUSH BUTTON PB(Flush)GRN-NP2-BA31'],
  ['PULLEY|C.I|B4 - 9" 48 BORE', 'PULLEY CI 9" X 4G X TYPE B'],
  ['PULLEY|C.I|B3 - 8" BORE 42 M.M', 'PULLEY CI 8" X 3G X TYPE B'],
  ['RAV WITH MOTOR||6" , 1 HP', 'RAV 150 MM (6") WITH GEARED MOTOR'],
  ['LIGHTING ARRESTOR||STD (COPPER)', 'LIGHTENING ARRESTOR COPPER ROD WITH SPICKS'],
  ['LIGHTING ARRESTOR|MS|STD (COPPER)', 'LIGHTENING ARRESTOR COPPER ROD WITH SPICKS'],
  ['TRIPLEX FIRE BAR|CI|96 W X 50 HT. X 630LG', 'GRATE BARS, CI, TRIPLEX 630 MM T3'],
  ['TRIPLEX FIRE BAR|CI|55 HX 630L X 110W', 'GRATE BARS, CI, TRIPLEX 630 MM T3'],
  ['BEARINGS|SS|22215K', 'BEARINGS SPIRAL ROLLER 22215-K'],
  ['BEARINGS|SS|22212K', 'BEARINGS SPIRAL ROLLER 22212-K'],
  ['ALUMINIUM|GI|26 GAUGE', 'ALUMINIUM SHEET 26 GAUGE'],
  ['ALUMINIUM|AL|26 GAUGE', 'ALUMINIUM SHEET 26 GAUGE'],

  // --- Steam trap / pressure gauge / water-level gauge / disc-check valve / fusible plug / safety
  //     valve, material + connection + size all cross-checked ---
  ['THERMODYNAMIC TYPE STEAM TRAP - S/E|S.S|15 MM, SCREWED BSPT', 'STEAM TRAP THERMO DYNAMIC-TD-3 SS, IBR 15 MM'],
  ['PRESSURE GAUGE (STEAM)|SS|D-8\'\', 1/2" BSP   0-21KG/CM2(G)', 'PRESSURE GAUGE-SS-DIAL:8" ; 0 T0 21 Kgs ; 1/2" BSP'],
  ['PRESSURE GAUGE (STEAM)|SS|D-10\'\', 1/2" BSP   0-21KG/CM2(G)', 'PRESSURE GAUGE-SS-DIAL:10" ; 0 T0 21 Kgs ; 1/2" BSP'],
  ['PRESSURE GAUGE (STEAM)||D-10\'\', 1/2" BSPT   0-21KG/CM2(G)', 'PRESSURE GAUGE DIAL:10" ; 0 T0 21 Kgs ; 1/2" BSP'],
  ['PRESSURE GAUGE (STEAM)||D-10\'\', 1/2" BSP   0-21KG/CM2(G)', 'PRESSURE GAUGE DIAL:10" ; 0 T0 21 Kgs ; 1/2" BSP'],
  ['DISK CHECK VALVE (NON SLAM CHECK)|SS 304|40 MM, ANSI B 16.5 , 300#', 'DISK CHECK VALVE, SS 304, 40 MM, ANSI B16.5, 300#'],
  ['FUSIBLE PLUG SINEGLE PEC DESIGN|BRONZE|1"  (BSPT THREAD )', 'FUSIBLE PLUG, BRONZE, S/P, IBR 25 MM'],
  ['SAFETY VALVE|CS|25 X 50 MM, IBR T-H', 'SAFETY V/E, CS, F/E, IBR 25 NB X 50 NB T/H'],
  ['SAFETY VALVE - F/E  (STEAM RELIEVING CAPACITY - 3000 KG/HR AT 3.0 KG/CM2)|C.S|50X80 MM IBR T-H', 'SAFETY V/E, CS, F/E, IBR 50 NB X 80 NB T/H'],
  ['SAFETY VALVE - F/E (STEAM RELIEVING CAPACITY - 3000 KG/HR AT 3.0 KG/CM2)|C.S|50  X 80 MM IBR T-H', 'SAFETY V/E, CS, F/E, IBR 50 NB X 80 NB T/H'],
  ["GLOBE  VALVE - F/E|CS|40MM, BS-10 TABLE-H", 'GLOBE VALVE, CAST STEEL, F/E, IBR 40 NB-T/H ; ND-40'],
  ["GLOBE VALVE -S/E|FORGED|15NB, #800", 'GLOBE VALVE, FORGED, S/E, IBR 15 NB'],
  ['GLOBE VALVE (AIR VENT) - F/E|CI|25 MM, BS-10 TABLE-H', 'GLOBE VALVE, CI, F/E, IBR 25 NB T/H'],
  ["GLOBE VALVE C.B.D|CS|25MM,  BS-10 TABLE-'H'", 'GLOBE VALVE, CAST STEEL, F/E, IBR 25 NB-T/H ; ND-40'],
  ['GLOBE VALVE( MSSV ) - F/E|CS|80 MM, BS-10 TABLE-H', 'GLOBE VALVE, CAST STEEL, F/E, IBR 80 NB-T/H ; ND-40'],

  // --- Refractory bag items, existing family+size ---
  ['CASTABLE  SUPER||INSULATE CASTABLE @ 1300°C 50 KGS/BAG', 'FIRE CRATE CASTABLE SUPER 50 KGS BAG'],
  ['WHITE HEAT - K||@ 1300°C\n50 KGS/BAG', 'CASTABLE WHITE HEAT K 50 KGS BAG'],
  ['INSULYTE-7||@ 1300°C\n50 KGS/BAG', 'CASTABLE INSULITE 50 KGS BAG'],
  ['INSULITE CASTABLE REFRACTORY IN SMOKE BOXES||INSULATE CASTABLE @ 1300°C\n25 KGS/BAG', 'CASTABLE INSULITE 25 KGS BAG'],
  ['INSULITE CASTABLE REFRACTORY IN SMOKE BOXES||INSULATE CASTABLE @ 1300°C\n50 KGS/BAG', 'CASTABLE INSULITE 50 KGS BAG'],

  // --- Asbestos rope, spelling variant of an existing family ---
  ['ASBESTOR ROPE|ASBESTOR|DIA 8', 'ASBESTOS METALLIC ROPE 8 MM'],
  ['ASBESTOR ROPE|ASBESTOR|6 MM', 'ASBESTOS METALLIC ROPE 6 MM'],
  ['ASBESTOR ROPE|ASBESTOR|DIA 10', 'ASBESTOS METALLIC ROPE 10 MM'],

  // --- The 2 confirmed reclassifications from the ACOSET/ACCOSET spelling variants -> new items ---
  ['ACCOSET 50||25 KGS', 'ACOSET 25 KGS BAG'],
  ['ACO SET 50||INSULATE CASTABLE @ 1300°C 25 KGS/BAG', 'ACOSET 25 KGS BAG'],
  ['ACOSET 50||INSULATE CASTABLE @ 1300°C\n50 KGS/BAG', 'ACOSET 50 KGS BAG'],

  // --- HEXNIPPLE / REDUCER COUPLING family, all pointing at the new generic items ---
  ['HEXNIPPLE FOR PR.GAUGE||1/2" X 1/2"', 'HEXNIPPLE FOR Pr.Gauge'],
  ['HEXNIPPLE FOR PR.GAUGE||1/2" X 1/2" -#600', 'HEXNIPPLE FOR Pr.Gauge'],
  ['HEXNIPPLE FOR PR.GAUGE/PR.SWITCH||1/2" X 1/2" -#600', 'HEXNIPPLE FOR Pr.Gauge'],
  ['IBR HEXNIPPLE FOR PR.GAUGE|ASTM SA 105|1/2"- 3000 LBS', 'HEXNIPPLE FOR Pr.Gauge'],
  ['IBR HEXNIPPLE FOR PR.GAUGE/PR.SWITCH|ASTM SA 105|1/2" -3000 LBS', 'HEXNIPPLE FOR Pr.Gauge'],
  ['IBR REDUCER HEXNIPPLE FOR PR.GAUGE|ASTM SA 105|1/2" X 3/8"', 'IBR REDUCER HEXNIPPLE FOR Pr.Gauge'],
  ['REDUCER COUPLING FOR PR.GAUGE||1/2" X 3/8"', 'REDUCER COUPLING FOR Pr.Gauge'],
  ['REDUCER COUPLING FOR PR.SWITCH||1/2" X 3/8" - #600', 'REDUCER COUPLING FOR Pr.Gauge'],
  ['IBR REDUCER COUPLING FOR PR.SWITCH|ASTM SA 105|1/2" X 3/8" - 3000 LBS', 'REDUCER COUPLING FOR Pr.Gauge'],

  // --- KEY WAY / M.S FASTENERS / THERMO COUPLING / REFLEX GLASS / RING SPANER -> the new items ---
  ['KEY WAY||16 X10X300', 'KEY WAY'],
  ['KEY WAY ROAD|-|12 X 12 X 300', 'KEY WAY'],
  ['M.S FASTENERS WITH WASHERS|MS|1/2" - 1 1/2"', 'M.S FASTENERS WITH WASHERS'],
  ['THERMO COUPLING|MS|1/2" F', 'THERMO COUPLING 1/2" F'],
  ['REFLEX GLASS|GLASS|-', 'REFLEX GLASS'],
  ['RING SPANER FOR MH/MD BOLTS OPENING (BOILER TOOLS)||-', 'RING SPANER for MH/MD bolts opening (BOILER TOOLS)'],
];

// ---------------------------------------------------------------------------------------------

console.log(apply ? '=== APPLYING ===\n' : '=== DRY RUN (nothing written) ===\n');

// --- Phase 1: create the 12 approved new items (idempotent — skip if an exact name match already exists) ---
console.log(`--- Bucket 2: ${NEW_ITEMS.length} new item(s) ---`);
const newlyCreated = [];
for (const item of NEW_ITEMS) {
  const existing = (await db.execute({ sql: 'SELECT id FROM items WHERE item_name = ?', args: [item.item_name] })).rows;
  if (existing.length) { console.log(`  SKIP "${item.item_name}" — already exists (id ${existing[0].id})`); continue; }
  console.log(`  CREATE "${item.item_name}" (${item.bom_category}, moc=${item.default_moc ?? 'none'})`);
  if (apply) {
    const { lastInsertRowid } = await db.execute({
      sql: `INSERT INTO items (item_name, group_name, category, bom_category, uom, default_moc, default_requires_manufacturing)
            VALUES (?, ?, 'RAW MATERIALS', ?, 'Nos', ?, 1)`,
      args: [item.item_name, item.group_name, item.bom_category, item.default_moc],
    });
    const id = Number(lastInsertRowid);
    await db.execute({ sql: 'UPDATE items SET item_code = ? WHERE id = ?', args: [`IM-${String(id).padStart(6, '0')}`, id] });
    newlyCreated.push({ id, item_name: item.item_name });
  }
}

// --- Phase 2: exact-memory seeds for Bucket 1 ---
console.log(`\n--- Bucket 1: ${DECISIONS.length} exact-memory seed(s) ---`);
const unresolvedItems = JSON.parse((await import('node:fs')).readFileSync('/Users/pujan/Developer/shanti-ops/scripts/.tmp-unresolved.json', 'utf8'));
const byKey = new Map(unresolvedItems.map(it => [it.key, it]));
const catalogRows = (await db.execute('SELECT id, item_name, bom_category, uom FROM items')).rows;
const index = buildCatalogIndex(catalogRows.map(r => ({ ...r })));
const byName = new Map(catalogRows.map(r => [r.item_name, r]));

let applied = 0, missingKey = 0, missingTarget = 0;
for (const [key, targetName] of DECISIONS) {
  const record = byKey.get(key);
  if (!record) { console.log(`  MISS (key not found in fresh parse): ${JSON.stringify(key)}`); missingKey++; continue; }
  const target = byName.get(targetName) ?? [...byName.values()].find(r => r.item_name.trim() === targetName.trim());
  if (!target) { console.log(`  MISS (target item not found): "${targetName}" for key ${JSON.stringify(key)}`); missingTarget++; continue; }

  const line = { material_description: record.desc, moc: record.moc, size_spec: record.size };
  const keys = memoryKeys(line);
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
console.log(`\n${applied} exact-memory seed(s) ${apply ? 'applied' : 'would be applied'}. ${missingKey} key(s) not found in fresh parse, ${missingTarget} target item(s) not found.`);

if (apply) {
  await db.execute({
    sql: 'INSERT INTO usb_audit (request_id, machine_id, actor, action, detail) VALUES (NULL, NULL, ?, ?, ?)',
    args: [ACTOR, 'pmb_bucket_decisions_applied', JSON.stringify({
      newItemsCreated: newlyCreated.length, newItemNames: newlyCreated.map(i => i.item_name),
      exactMemorySeeds: applied, source: 'STF-IBR-055/060/053/057 full per-item classification pass',
    })],
  });
  console.log('\nApplied and audited.');
}
