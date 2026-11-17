// Public demo: link every AB-1006 BOM line to an Item Master row, for the video's Engineering chapter.
// Lines the catalogue covers point at that item (chosen by hand: the matcher only suggests). Shop-made parts
// (manhole ring, fire door, dampers, panel…) and the few bought-out items the catalogue lacks are added to the
// Item Master first, the way a real factory keeps them. Links go through the catalog-suggestions route, so the
// app's own link memory and unit fill apply. Idempotent: an existing item name is reused, linked lines are skipped.
//   DB_URL=… DB_TOKEN=… BASE=<app on that DB> ADMIN_PASSWORD=… node scripts/demo/link-ab1006-items.mjs [--apply]
import { createClient } from '@libsql/client';

const apply = process.argv.includes('--apply');
const { DB_URL, DB_TOKEN, BASE, ADMIN_PASSWORD } = process.env;
const db = createClient({ url: DB_URL, authToken: DB_TOKEN || undefined, intMode: 'number' });
if (!(await db.execute("SELECT 1 FROM sqlite_master WHERE name = 'demo_meta'")).rows.length) throw new Error('Not a demo database');

const MAKE = 'make';                         // shop-made part: added as a Manufactured item named like the line
const BUY = name => ({ buy: name });         // bought-out item the catalogue lacks: added as a Purchase item
const MAP = {
  'FURNACE PLATE 12 MM SA 516 GR 70': 'BQ PLATE 12 MM SA 516 GR 70',
  'REVERSAL CHAMBER PLATE 14 MM SA 516 GR 70': 'BQ PLATE 14 MM SA 516 GR 70, NORMALIZED, FORM IV TC',
  'WET BACK END PLATE 14 MM SA 516 GR 70': 'BQ PLATE 14 MM SA 516 GR 70, NORMALIZED, FORM IV TC',
  'BAR STAY ROUND 40 DIA SA 675': BUY('ROUND DIA 40 MM SA 675'),
  'GIRDER STAY FLAT 100 X 16': BUY('MS FLAT 100 MM X 16 MM'),
  'MANHOLE RING 400 X 300 PAD 16 MM': MAKE,
  'MANHOLE COVER WITH DOG, BOLT & GASKET': MAKE,
  'MUDHOLE ASSEMBLY 150 X 100': MAKE,
  'SADDLE SUPPORT PLATE 12 MM': 'MS PLATES 12 MM',
  'LIFTING LUG 25 MM': MAKE,
  'AUXILIARY STEAM STOP VALVE 25 NB': BUY('AUXILIARY STEAM STOP VALVE, CS, F/E, IBR 25 MM'),
  'SIPHON TUBE WITH COCK': BUY('SIPHON TUBE WITH COCK, IBR 15 MM'),
  'LOW WATER LEVEL ALARM (FLOAT TYPE)': BUY('LOW WATER LEVEL ALARM, FLOAT TYPE, IBR'),
  'FUSIBLE PLUG': 'FUSIBLE PLUG, BRONZE, S/P, IBR 15 MM',
  'AIR VENT VALVE 15 NB': BUY('AIR VENT VALVE, FORGED, S/E, IBR 15 MM'),
  'PRESSURE SWITCH': 'PRESSURE SWITCH UT-5',
  'NAME PLATE (IBR)': MAKE,
  'MS PIPE 25 NB CLASS C': 'MS PIPE C CLASS 1"',
  'NRV 25 NB': 'NRV, HORIZONTAL, CS, F/E, IBR 25 MM',
  'GATE VALVE 50 NB': 'GATE VALVE, CS, IBR, CL150, F/E, 50 MM',
  'Y STRAINER 50 NB': 'Y STRAINER, C.S, F/E, CL150, IBR 50 MM',
  'ELBOW 25 NB SCH 80': BUY('ELBOW, SEAMLESS, IBR-SC/80-25 MM (1")'),
  'FEED WATER TANK 3000 LTR': MAKE,
  'MS PIPE 25 NB CLASS C (BLOW DOWN)': 'MS PIPE C CLASS 1"',
  'BLOW DOWN VALVE 25 NB QUICK OPENING': 'BLOW DOWN VALVE 25 NB',
  'BEND 25 NB SCH 80': 'BENDS, SEAMLESS, LONG, IBR-SC/80-25 MM (1")',
  'BLOW DOWN TANK 500 DIA X 900': MAKE,
  'DRAIN VALVE 25 NB': BUY('DRAIN VALVE, FORGED, S/E, IBR 25 MM'),
  'FIRE DOOR ASSEMBLY 600 X 450': MAKE,
  'FIRE BAR (TRIPLEX) 900 LG': BUY('GRATE BARS, CI, TRIPLEX 900 MM'),
  'DEAD PLATE 10 MM': 'MS PLATES 10 MM',
  'BEARER BAR 75 X 10': 'MS FLAT 75 MM X 10 MM',
  'ASH DOOR 450 X 300': MAKE,
  'REFRACTORY CASTABLE 1400 DEG': BUY('REFRACTORY CASTABLE 1400 DEG C'),
  'MS PLATE 6 MM IS 2062 (DUCT)': 'MS PLATES 6 MM',
  'SMOKE BOX DOOR 900 X 700': MAKE,
  'EXPANSION BELLOW 500 X 500': BUY('EXPANSION BELLOW, MS, 500 X 500 MM'),
  'DAMPER 500 X 500 WITH LEVER': MAKE,
  'MS PLATE 6 MM IS 2062 (CHIMNEY)': 'MS PLATES 6 MM',
  'MS PLATE 5 MM IS 2062 (CHIMNEY TOP)': 'MS PLATES 5 MM',
  'CHIMNEY BASE PLATE 16 MM': 'MS PLATES 16 MM',
  'FOUNDATION BOLT M24 X 600': BUY('FOUNDATION BOLT, MS, M24 X 600 LG'),
  'LADDER WITH CAGE': MAKE,
  'LIGHTNING ARRESTOR': 'LIGHTENING ARRESTOR COPPER ROD WITH SPICKS',
  'ID FAN 7.5 HP, 4000 M3/HR @ 150 MMWC': 'ID FAN W/O MOTOR WC HP:7.5 HP / 1440 RPM',
  'MOTOR 7.5 HP 1440 RPM TEFC': 'MOTOR 1440 RPM / 4 POLE, FRAME 132S 7.5 HP',
  'V BELT B 52': BUY('V BELTS B GROOVE 52 INCH'),
  'PULLEY CI 8" X 3G X TYPE B': 'PULLEY CI 8" X 3G X TYPE B',
  'FAN BASE FRAME MS CHANNEL 100 X 50': 'MS CHANNEL 100 X 50 MM',
  'BEARING PEDESTAL 50 MM': BUY('PLUMMER BLOCK BEARING UCP 210, 50 MM'),
  'FD FAN 5 HP, 2800 M3/HR @ 125 MMWC': BUY('FD FAN W/O MOTOR WC HP:5 HP / 2880 RPM'),
  'MOTOR 5 HP 2880 RPM TEFC': 'MOTOR 2880 RPM / 2 POLE, FRAME 100L 5 HP',
  'AIR DUCT MS PLATE 3 MM': 'MS PLATES 3 MM',
  'AIR DAMPER 300 X 300': MAKE,
  'CONTROL PANEL WITH STAR DELTA STARTERS': MAKE,
  'MCCB 63 A': BUY('MCCB 63 AMPS 4 POLE'),
  'CONTACTOR 25 A': 'CONTACTOR AMPS > 25',
  'OVERLOAD RELAY': 'RELAY OLR:NXR-25:12 TO 18',
  'LEVEL CONTROLLER (PROBE TYPE)': BUY('LEVEL CONTROLLER, PROBE TYPE, 3 PROBE'),
  'ARMOURED CABLE 4 CORE 4 SQ MM': 'CABLE 4 SQ MM X 4 CORE',
  'MINERAL WOOL MATTRESS 75 MM': 'LRB MATTRESS 100 DENSITY X 75 MM THICK',
  'ALUMINIUM CLADDING SHEET 22 SWG': 'ALUMINIUM SHEET 22 GAUGE',
  'GI WIRE MESH': BUY('GI WIRE MESH 25 MM X 25 MM'),
  'SELF TAPPING SCREW': 'SELF SCREWS GI M8 X 25 LG',
};

const [proj] = (await db.execute("SELECT id FROM projects WHERE project_no = 'AB-1006'")).rows;
if (!proj) throw new Error('AB-1006 not found');
const lines = (await db.execute({ sql: "SELECT id, material_description, qty_text, category FROM bom_items WHERE project_id = ? AND item_id IS NULL AND source = 'bom'", args: [proj.id] })).rows;
const unit = q => (String(q || '').match(/[A-Za-z]+$/)?.[0]) || 'Nos';

const findItem = async name => (await db.execute({ sql: 'SELECT id FROM items WHERE UPPER(TRIM(item_name)) = UPPER(?)', args: [name] })).rows[0]?.id;
const links = [], created = [], missing = [];
for (const l of lines) {
  const m = MAP[l.material_description];
  if (!m) { missing.push(`no mapping: ${l.material_description}`); continue; }
  const name = m === MAKE ? l.material_description : (m.buy || m);
  let id = await findItem(name);
  if (!id && typeof m === 'string' && m !== MAKE) { missing.push(`catalogue item not found: ${name}`); continue; }
  if (!id) {
    created.push(`${m === MAKE ? 'make' : 'buy '} | ${name}`);
    if (apply) {
      const r = await db.execute({ sql: `INSERT INTO items (item_name, uom, bom_category, material_process_type, item_type, default_requires_manufacturing, group_name)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, args: [name, unit(l.qty_text), l.category || 'standard', m === MAKE ? 'Manufactured' : 'Procured',
        m === MAKE ? 'Make' : 'Purchase', m === MAKE ? 1 : 0, m === MAKE ? 'FABRICATED PARTS' : null] });
      id = Number(r.lastInsertRowid);
      await db.execute({ sql: "UPDATE items SET item_code = 'IM-' || printf('%06d', id) WHERE id = ?", args: [id] });
    }
  }
  links.push({ bom_item_id: l.id, item_id: id, name });
}
console.log(`${lines.length} unlinked lines; ${links.length} to link; ${created.length} items to add`);
created.forEach(c => console.log('  add', c));
missing.forEach(c => console.log('  !', c));
if (missing.length) process.exit(1);
if (!apply) { console.log('dry run; add --apply'); process.exit(0); }

const login = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: ADMIN_PASSWORD }) });
const cookie = login.headers.get('set-cookie')?.split(';')[0];
if (!login.ok || !cookie) throw new Error('login failed');
for (let i = 0; i < links.length; i += 25) { // the route takes at most 50 per call
  const res = await fetch(`${BASE}/api/projects/${proj.id}/catalog-suggestions`, { method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ links: links.slice(i, i + 25).map(({ bom_item_id, item_id }) => ({ bom_item_id, item_id })) }) });
  console.log('link:', res.status, (await res.text()).slice(0, 200));
}
const [{ n }] = (await db.execute({ sql: "SELECT COUNT(*) n FROM bom_items WHERE project_id = ? AND item_id IS NULL AND source = 'bom'", args: [proj.id] })).rows;
console.log(`AB-1006 lines still unlinked: ${n}`);
