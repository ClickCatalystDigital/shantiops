// Public demo: a full "MF 2000 standard" BOM (multi-fuel, 3-pass wet-back shell boiler, 2000 kg/hr, 10.54 kg/cm2),
// 12 subsystems, sizes from the 2000 kg/hr calculation template (shell 2150 ID x 12, 3000 long, furnace 1000, 64 + 44
// tubes 63.5 OD). Writes it into the template and rebuilds SO-6's BOM from it (SO-6 is unreleased and nothing on it is
// bought yet; refuses otherwise). Quantities and makes are typical, not from a real order.
//   TURSO_URL=... TURSO_AUTH_TOKEN=... node scripts/demo/full-boiler-template.mjs [--apply]
import { createClient } from '@libsql/client';
import { categoryDisplaySpec } from '../../lib/section-shapes.js';

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN || undefined, intMode: 'number' });
if (!(await db.execute("SELECT 1 FROM sqlite_master WHERE name = 'demo_meta'")).rows.length) throw new Error('Not a demo database');
const apply = process.argv.includes('--apply');

// [description, MOC, category, fields (dimensional) or size text, qty, make]
const P = (l, w, t) => ({ length: l, width: w, thickness: t });
const PIPE = (size, len, od) => ({ size, length: len, diameter_mm: od });
const SEC = (size, len) => ({ size, length: len });
const S = {
  'Shell & Body': [
    ['BQ PLATE 12 MM SA 516 GR 70', 'SA 516 Gr 70', 'plate', P(6000, 2500, 12), '2 Nos'],
    ['BQ PLATE 16 MM SA 516 GR 70', 'SA 516 Gr 70', 'plate', P(2500, 2500, 16), '2 Nos'],
    ['FURNACE PLATE 12 MM SA 516 GR 70', 'SA 516 Gr 70', 'plate', P(3200, 2500, 12), '1 Nos'],
    ['REVERSAL CHAMBER PLATE 14 MM SA 516 GR 70', 'SA 516 Gr 70', 'plate', P(4400, 1500, 14), '1 Nos'],
    ['WET BACK END PLATE 14 MM SA 516 GR 70', 'SA 516 Gr 70', 'plate', P(1500, 1500, 14), '1 Nos'],
    ['BOILER TUBE 63.5 OD X 3.25 THK SA 210', 'SA 210 Gr A1', 'pipe', PIPE('63.5 OD x 3.25', 2450, 63.5), '64 Nos'],
    ['BOILER TUBE 63.5 OD X 3.25 THK SA 210 (3RD PASS)', 'SA 210 Gr A1', 'pipe', PIPE('63.5 OD x 3.25', 3000, 63.5), '44 Nos'],
    ['STAY TUBE 63.5 OD X 6.35 THK SA 210', 'SA 210 Gr A1', 'pipe', PIPE('63.5 OD x 6.35', 3060, 63.5), '12 Nos'],
    ['BAR STAY ROUND 40 DIA SA 675', 'SA 675 Gr 70', 'round', { diameter: 40, length: 3100 }, '6 Nos'],
    ['GIRDER STAY FLAT 100 X 16', 'IS 2062 E250', 'flat', { width: 100, thickness: 16, length: 1200 }, '4 Nos'],
    ['MANHOLE RING 400 X 300 PAD 16 MM', 'SA 516 Gr 70', 'standard', '400 X 300 ELLIPTICAL', '1 Nos'],
    ['MANHOLE COVER WITH DOG, BOLT & GASKET', 'SA 516 Gr 70', 'standard', '400 X 300', '1 Set'],
    ['MUDHOLE ASSEMBLY 150 X 100', 'SA 516 Gr 70', 'standard', '150 X 100', '2 Set'],
    ['MS ANGLE 50 X 50 X 6 MM', 'IS 2062 E250', 'angle', SEC('ISA 50 x 50 x 6', 6000), '6 Nos'],
    ['SADDLE SUPPORT PLATE 12 MM', 'IS 2062 E250', 'plate', P(2400, 600, 12), '2 Nos'],
    ['LIFTING LUG 25 MM', 'IS 2062 E250', 'standard', '25 THK', '4 Nos'],
  ],
  'Mountings & Fittings': [
    ['SAFETY VALVE 40 NB SPRING LOADED', 'WCB', 'standard', '40 NB, SET 10.54 KG/CM2', '2 Nos', 'IBR approved'],
    ['MAIN STEAM STOP VALVE 80 NB', 'WCB', 'standard', '80 NB CL 150', '1 Nos'],
    ['AUXILIARY STEAM STOP VALVE 25 NB', 'WCB', 'standard', '25 NB', '1 Nos'],
    ['FEED CHECK VALVE 25 NB', 'WCB', 'standard', '25 NB', '1 Nos'],
    ['BLOW DOWN VALVE 25 NB', 'WCB', 'standard', '25 NB', '1 Nos'],
    ['PRESSURE GAUGE 0-21 KG/CM2', 'SS', 'standard', '150 DIAL', '2 Nos'],
    ['SIPHON TUBE WITH COCK', 'CS', 'standard', '1/2"', '2 Nos'],
    ['WATER LEVEL GAUGE', 'WCB', 'standard', 'TUBULAR', '2 Nos'],
    ['LOW WATER LEVEL ALARM (FLOAT TYPE)', 'CS', 'standard', '25 NB', '1 Nos'],
    ['FUSIBLE PLUG', 'GM', 'standard', '3/4" BSP', '1 Nos'],
    ['AIR VENT VALVE 15 NB', 'WCB', 'standard', '15 NB', '1 Nos'],
    ['PRESSURE SWITCH', 'SS', 'standard', '0-16 KG/CM2', '1 Nos'],
    ['NAME PLATE (IBR)', 'SS', 'other', '150 X 100', '1 Nos'],
  ],
  'Feed Line': [
    ['FEED PUMP 3 HP CENTRIFUGAL', 'CI', 'standard', '3 HP, 4 M3/HR @ 14 KG/CM2', '2 Nos'],
    ['MS PIPE 50 NB CLASS B', 'IS 1239', 'pipe', PIPE('50 NB Class B', 6000, 60.3), '3 Nos'],
    ['MS PIPE 25 NB CLASS C', 'IS 1239', 'pipe', PIPE('25 NB Class C', 6000, 33.7), '2 Nos'],
    ['NRV 25 NB', 'WCB', 'standard', '25 NB', '2 Nos'],
    ['GATE VALVE 50 NB', 'CI', 'standard', '50 NB', '2 Nos'],
    ['Y STRAINER 50 NB', 'CI', 'standard', '50 NB', '2 Nos'],
    ['ELBOW 25 NB SCH 80', 'A 234 WPB', 'standard', '25 NB', '10 Nos'],
    ['GASKET SPIRAL WOUND 80 NB', 'SS/Graphite', 'standard', '80 NB', '6 Nos'],
    ['STUD BOLT M16 X 90', 'B7', 'standard', 'M16 X 90', '32 Nos'],
    ['FEED WATER TANK 3000 LTR', 'IS 2062 E250', 'standard', '3000 LTR', '1 Nos'],
  ],
  'Blow Down Line': [
    ['MS PIPE 25 NB CLASS C (BLOW DOWN)', 'IS 1239', 'pipe', PIPE('25 NB Class C', 6000, 33.7), '2 Nos'],
    ['BLOW DOWN VALVE 25 NB QUICK OPENING', 'WCB', 'standard', '25 NB', '1 Nos'],
    ['BEND 25 NB SCH 80', 'A 234 WPB', 'standard', '25 NB', '4 Nos'],
    ['BLOW DOWN TANK 500 DIA X 900', 'IS 2062 E250', 'standard', '500 DIA X 900 HT', '1 Nos'],
    ['DRAIN VALVE 25 NB', 'CI', 'standard', '25 NB', '1 Nos'],
  ],
  'Fire Door & Grate': [
    ['FIRE DOOR ASSEMBLY 600 X 450', 'CI / MS', 'standard', '600 X 450', '1 Nos'],
    ['FIRE BAR (TRIPLEX) 900 LG', 'CI', 'standard', '900 LG', '48 Nos'],
    ['DEAD PLATE 10 MM', 'IS 2062 E250', 'plate', P(900, 300, 10), '1 Nos'],
    ['BEARER BAR 75 X 10', 'IS 2062 E250', 'flat', { width: 75, thickness: 10, length: 1000 }, '3 Nos'],
    ['ASH DOOR 450 X 300', 'CI', 'standard', '450 X 300', '1 Nos'],
    ['REFRACTORY CASTABLE 1400 DEG', 'Castable', 'other', '1400 DEG C', '500 Kgs'],
  ],
  'Flue Gas Duct': [
    ['MS PLATE 6 MM IS 2062 (DUCT)', 'IS 2062 E250', 'plate', P(2500, 1250, 6), '6 Nos'],
    ['MS ANGLE 50 X 50 X 6 MM (DUCT FLANGES)', 'IS 2062 E250', 'angle', SEC('ISA 50 x 50 x 6', 6000), '6 Nos'],
    ['SMOKE BOX DOOR 900 X 700', 'IS 2062 E250', 'standard', '900 X 700', '1 Nos'],
    ['EXPANSION BELLOW 500 X 500', 'SS 304', 'standard', '500 X 500', '1 Nos'],
    ['DAMPER 500 X 500 WITH LEVER', 'IS 2062 E250', 'standard', '500 X 500', '1 Nos'],
  ],
  'Chimney': [
    ['MS PLATE 6 MM IS 2062 (CHIMNEY)', 'IS 2062 E250', 'plate', P(2500, 1250, 6), '10 Nos'],
    ['MS PLATE 5 MM IS 2062 (CHIMNEY TOP)', 'IS 2062 E250', 'plate', P(2500, 1250, 5), '6 Nos'],
    ['CHIMNEY BASE PLATE 16 MM', 'IS 2062 E250', 'plate', P(1000, 1000, 16), '1 Nos'],
    ['FOUNDATION BOLT M24 X 600', 'IS 2062 E250', 'standard', 'M24 X 600', '8 Nos'],
    ['LADDER WITH CAGE', 'IS 2062 E250', 'standard', '30 M', '1 Set'],
    ['LIGHTNING ARRESTOR', 'Copper', 'standard', '25 X 3 STRIP', '1 Set'],
  ],
  'ID Fan': [
    ['ID FAN 7.5 HP, 4000 M3/HR @ 150 MMWC', 'MS', 'standard', '7.5 HP', '1 Nos'],
    ['MOTOR 7.5 HP 1440 RPM TEFC', 'CI', 'standard', '7.5 HP, 415 V', '1 Nos'],
    ['V BELT B 52', 'Rubber', 'standard', 'B 52', '3 Nos'],
    ['PULLEY CI 8" X 3G X TYPE B', 'CI', 'standard', '8" X 3 GROOVE', '2 Nos'],
    ['FAN BASE FRAME MS CHANNEL 100 X 50', 'IS 2062 E250', 'channel', SEC('ISMC 100 x 50', 6000), '2 Nos'],
    ['BEARING PEDESTAL 50 MM', 'CI', 'standard', '50 MM', '2 Nos'],
  ],
  'FD Fan': [
    ['FD FAN 5 HP, 2800 M3/HR @ 125 MMWC', 'MS', 'standard', '5 HP', '1 Nos'],
    ['MOTOR 5 HP 2880 RPM TEFC', 'CI', 'standard', '5 HP, 415 V', '1 Nos'],
    ['AIR DUCT MS PLATE 3 MM', 'IS 2062 E250', 'plate', P(2500, 1250, 3), '2 Nos'],
    ['AIR DAMPER 300 X 300', 'IS 2062 E250', 'standard', '300 X 300', '1 Nos'],
  ],
  'Electrical Panel': [
    ['CONTROL PANEL WITH STAR DELTA STARTERS', 'CRCA', 'other', '1200 X 800 X 400', '1 Nos'],
    ['MCCB 63 A', '-', 'other', '63 A, 4 POLE', '1 Nos'],
    ['CONTACTOR 25 A', '-', 'other', '25 A', '6 Nos'],
    ['OVERLOAD RELAY', '-', 'other', '9-14 A', '4 Nos'],
    ['LEVEL CONTROLLER (PROBE TYPE)', '-', 'other', '3 PROBE', '1 Nos'],
    ['ARMOURED CABLE 4 CORE 4 SQ MM', 'Copper', 'other', '4C X 4 SQMM', '60 Mtr'],
  ],
  'Insulation & Cladding': [
    ['MINERAL WOOL MATTRESS 75 MM', 'Rockwool', 'other', '75 THK, 96 KG/M3', '28 Sqm'],
    ['ALUMINIUM CLADDING SHEET 22 SWG', 'Aluminium', 'other', '22 SWG', '30 Sqm'],
    ['GI WIRE MESH', 'GI', 'other', '25 X 25', '28 Sqm'],
    ['SELF TAPPING SCREW', 'SS', 'other', '8 X 25', '500 Nos'],
  ],
};

const names = (await db.execute('SELECT id, item_name FROM items')).rows;
const byName = new Map(names.map(r => [r.item_name.toUpperCase(), r.id]));
const DIMS = ['plate', 'flat', 'round', 'square', 'angle', 'beam', 'channel', 'pipe'];
const tree = [{ name: 'Boiler', node_type: 'System', qty: 1, items: [], children: Object.entries(S).map(([name, rows]) => ({
  name, node_type: 'Subsystem', qty: 1, children: [],
  items: rows.map(([d, moc, cat, f, qty, make]) => {
    const dim = DIMS.includes(cat);
    return {
      material_description: d, moc, size_spec: dim ? categoryDisplaySpec(cat, f) : f, qty_text: qty, make: make || null, remarks: null,
      category: cat, category_fields_json: dim ? JSON.stringify(f) : null, named_parts_json: null,
      item_id: byName.get(d.replace(/\s*\(.*\)$/, '')) || null,
      requires_heat_no: dim ? 1 : 0, requires_mtc: dim || /VALVE|PLUG/.test(d) ? 1 : 0, requires_supplier_batch: 0,
      requires_serial_no: /VALVE|PUMP|FAN|MOTOR|GAUGE/.test(d) ? 1 : 0,
      requires_manufacturing: dim || /PLATE|ASSEMBLY|TANK|DOOR|FRAME/.test(d) ? 1 : 0,
    };
  }),
})) }];
const nodeCount = 1 + Object.keys(S).length, itemCount = Object.values(S).reduce((n, r) => n + r.length, 0);
console.log(`${nodeCount} nodes, ${itemCount} lines, ${tree[0].children.flatMap(c => c.items).filter(i => i.item_id).length} linked to the Item Master`);

const so = (await db.execute("SELECT id FROM projects WHERE project_no = 'SO-6'")).rows[0];
const busy = (await db.execute(`SELECT
  (SELECT COUNT(*) FROM po_items WHERE bom_item_id IN (SELECT id FROM bom_items WHERE project_id = ?)) +
  (SELECT COUNT(*) FROM supplier_quotes WHERE bom_item_id IN (SELECT id FROM bom_items WHERE project_id = ?)) +
  (SELECT COUNT(*) FROM bom_item_receipts WHERE bom_item_id IN (SELECT id FROM bom_items WHERE project_id = ?)) AS n,
  (SELECT bom_release_revision FROM projects WHERE id = ?) AS rev`, [so.id, so.id, so.id, so.id])).rows[0];
if (busy.n || busy.rev) throw new Error('SO-6 is released or has purchasing on it; not replacing its BOM');
if (!apply) process.exit(0);

const tpl = (await db.execute("SELECT id FROM bom_structure_templates WHERE name = 'MF 2000 standard' AND archived_at IS NULL")).rows[0];
const stmts = [
  { sql: 'UPDATE bom_structure_templates SET tree_json = ?, node_count = ?, item_count = ?, version = version + 1, description = ? WHERE id = ?',
    args: [JSON.stringify(tree), nodeCount, itemCount, 'Multi-fuel 3-pass wet-back shell boiler, 2000 kg/hr, 10.54 kg/cm2: shell & body, mountings, feed and blow-down lines, fire door & grate, flue duct, chimney, ID and FD fans, electrical panel, insulation.', tpl.id] },
  { sql: 'DELETE FROM bom_assembly_drawings WHERE assembly_id IN (SELECT id FROM bom_assemblies WHERE project_id = ?)', args: [so.id] },
  { sql: 'DELETE FROM bom_items WHERE project_id = ?', args: [so.id] },
  { sql: 'DELETE FROM bom_assemblies WHERE project_id = ?', args: [so.id] },
];
await db.batch(stmts, 'write');
const ver = (await db.execute('SELECT version FROM bom_structure_templates WHERE id = ?', [tpl.id])).rows[0].version;
const root = await db.execute(`INSERT INTO bom_assemblies (project_id, parent_id, name, qty, sort_order, node_type, structure_template_id, structure_template_version, created_by)
  VALUES (?, NULL, 'Boiler', 1, 0, 'System', ?, ?, 'design_head')`, [so.id, tpl.id, ver]);
const rootId = Number(root.lastInsertRowid);
let n = 0, sort = 0;
for (const sub of tree[0].children) {
  const a = await db.execute(`INSERT INTO bom_assemblies (project_id, parent_id, name, qty, sort_order, node_type, created_by) VALUES (?, ?, ?, 1, ?, 'Subsystem', 'design_head')`,
    [so.id, rootId, sub.name, sort++]);
  const aid = Number(a.lastInsertRowid);
  await db.batch(sub.items.map(it => ({
    sql: `INSERT INTO bom_items (project_id, assembly_id, sort_order, material_description, moc, size_spec, qty_text, make, remarks, category,
          category_fields_json, item_id, requires_heat_no, requires_mtc, requires_supplier_batch, requires_serial_no, requires_manufacturing,
          purchase_status, pending_review, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 0, ?, ?, 'Enquiry', 0, 'bom')`,
    args: [so.id, aid, n++, it.material_description, it.moc, it.size_spec, it.qty_text, it.make, it.category, it.category_fields_json, it.item_id,
      it.requires_heat_no, it.requires_mtc, it.requires_serial_no, it.requires_manufacturing],
  })), 'write');
}
console.log(`SO-6 rebuilt: ${nodeCount} nodes, ${n} lines; template version ${ver}`);
