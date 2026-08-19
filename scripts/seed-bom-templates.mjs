// scripts/seed-bom-templates.mjs — 5 demo BOM templates, every line sourced from real Item Master
// (`items`) rows found by targeted query (group_name LIKE), never invented. category mirrors
// PrWorkspace.jsx's guessCategory() exactly (PLATE->plate, ANGLE->angle, else uncategorized) —
// pipes/valves/gauges stay uncategorized, same as a real catalog pick would guess today.
// category_fields_json is left null: the master gives thickness/size in the name but rarely a full
// length x width, and inventing one would violate "don't fabricate data" — item_id/category/moc
// alone still make these useful, real, remnant-match-ready once real dims are added on a project.
// qty_text is the only field with no Item Master source (a template's per-item standard quantity
// is inherently new data, not read from the catalog).
//   node --env-file=.env.local scripts/seed-bom-templates.mjs
import { createClient } from '@libsql/client';

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
async function run(sql, args = []) { return db.execute({ sql, args }); }
async function one(sql, args = []) { return (await run(sql, args)).rows[0] || null; }

function guessCategory(groupName) {
  const g = (groupName || '').toUpperCase();
  if (g.includes('PLATE')) return 'plate';
  if (g.includes('ANGLE')) return 'angle';
  return null;
}
function guessMoc(item) {
  const n = item.item_name.toUpperCase();
  if (item.group_name === 'BQ PLATE') return 'SA 516 GR 70';
  if (n.startsWith('SS ')) return 'SS 304';
  if (n.startsWith('MS ')) return 'MS';
  return null;
}

const TEMPLATES = [
  { name: '3 TPH Solid Fuel Fired Boiler', series: '3 TPH', items: [
    ['MS PLATES 4 MM', '500 Kgs'], ['BQ PLATE 10MM SA 516 GR 70, NORMALIZED, FORM IV TC', '2 Nos'],
    ['MS ANGLE 50 X 50 X 5 MM', '200 Kgs'], ['MS PIPE C CLASS 1"', '50 Kgs'],
    ['SAFETY VALVES, CS, F/E, IBR 25 NB X 50 NB', '1 No'], ['PRESSURE GAUGE DIAL:4" ; 0 TO 42 Kgs ; 1/4" BSP', '1 No'],
  ] },
  { name: '5 TPH AFBC Boiler', series: '5 TPH', items: [
    ['MS PLATES 3 MM', '800 Kgs'], ['BQ PLATE 12 MM SA 516 GR 70, NORMALIZED, FORM IV TC', '3 Nos'],
    ['MS ANGLE 65 X 65 X 6 MM', '350 Kgs'], ['SS 304 ANGLE 25 X 25 X 3TH', '40 Nos'],
    ['SOLONOID VALVES BAG HOUSE 25 MM', '6 Nos'], ['PRESSURE GAUGE DIAL:6" ; 0 TO 42 Kgs ; 3/8" BSP', '2 Nos'],
  ] },
  { name: '2 TPH Oil Fired Boiler', series: '2 TPH', items: [
    ['MS PLATES 2 MM', '300 Kgs'], ['MS ANGLE 40 X 40 X 4 MM', '150 Kgs'],
    ['MS PIPE C CLASS 3/4"', '30 Kgs'], ['SAFETY VALVES, CS, F/E, IBR 50 NB X 80 NB', '1 No'],
    ['PRESSURE GAUGE DIAL:2"/21/2" ; 0 T0 42 Kgs ; 1/4"', '1 No'],
  ] },
  { name: '6 TPH Husk Fired Boiler', series: '6 TPH', items: [
    ['BQ PLATE 14 MM SA 516 GR 70, NORMALIZED, FORM IV TC', '4 Nos'], ['MS ANGLE 75 X 75 X 6 MM', '400 Kgs'],
    ['SS 304 ANGLE 40 X 40 X 4 TH', '20 Nos'], ['MS PIPE C CLASS 1 1/2"', '60 Kgs'],
    ['SAFETY VALVES, CS, F/E, IBR 80 NB X 100 NB', '2 Nos'], ['SOLONOID VALVES 2W-160-15-220 V 15 MM', '4 Nos'],
  ] },
  { name: '4 TPH Solid Fuel Fired Boiler', series: '4 TPH', items: [
    ['MS PLATES 2.5 MM', '600 Kgs'], ['BQ PLATE 16 MM SA 516 GR 70, NORMALIZED, FORM IV TC', '3 Nos'],
    ['MS ANGLE 25 X 25 X 3 MM', '100 Kgs'], ['MS PIPE C CLASS 11/4"(32mm)', '45 Kgs'],
    ['PRESSURE GAUGE DIAL:8" ; 0 T0 42 Kgs ; 1/2" BSP', '1 No'],
  ] },
];

async function main() {
  for (const t of TEMPLATES) {
    const existing = await one('SELECT id FROM bom_templates WHERE name = ?', [t.name]);
    if (existing) { await run('DELETE FROM bom_template_items WHERE template_id = ?', [existing.id]); await run('DELETE FROM bom_templates WHERE id = ?', [existing.id]); }

    const tpl = await run('INSERT INTO bom_templates (name, series, description, created_by) VALUES (?, ?, ?, ?)',
      [t.name, t.series, `Demo template — ${t.items.length} items from the Item Master`, 'seed-script']);
    const templateId = Number(tpl.lastInsertRowid);

    let n = 0, missing = 0;
    for (const [itemName, qtyText] of t.items) {
      const item = await one('SELECT id, item_name, group_name, uom FROM items WHERE item_name = ?', [itemName]);
      if (!item) { missing++; console.warn(`  ! not found in Item Master: ${itemName}`); continue; }
      const category = guessCategory(item.group_name);
      await run(
        `INSERT INTO bom_template_items (template_id, material_description, moc, qty_text, sort_order, item_id, category)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [templateId, item.item_name, guessMoc(item), qtyText, n++, item.id, category]
      );
    }
    console.log(`${t.name}: ${n} item(s) linked${missing ? `, ${missing} not found` : ''}`);
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
