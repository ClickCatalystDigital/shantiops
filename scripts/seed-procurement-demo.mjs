// Phase 0 of PROCUREMENT-CHANGES.md §7 — wipes the bulky imported PMB BOM data (780 rows, zero
// suppliers/quotes ever logged against it) and reseeds a small, readable demo dataset that shows
// every stage of the sourcing/quote/PO lifecycle at once, across all 4 populated projects
// (SB-1104/SB-1103/SB-1105/STF-IBR-052 — project 2/SB-1018 has no BOM data and is left untouched).
//
// Idempotent: safe to re-run — it always deletes-then-reinserts the same fixed set, never appends.
// Does NOT touch packing_items (they carry their own copies of description/moc/size_spec, no FK to
// bom_items — see lib/db.js's packing_items schema — so Dispatch's existing packing lists are
// unaffected) or milestones/stages/users/projects.
//
// Run: node --env-file=.env.local scripts/seed-procurement-demo.mjs
import { createClient } from '@libsql/client';

const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
  intMode: 'number',
});

const PROJECTS = [3, 4, 5, 6]; // SB-1104, SB-1103, SB-1105, STF-IBR-052

// One item template, reused per project (real PMB spreadsheets do repeat the same materials across
// boiler orders) — deliberately spans every stage of the lifecycle so the demo is self-explanatory.
const ITEM_TEMPLATE = [
  { key: 'plate', desc: 'MS PLATE', moc: 'MS', size: '2000 X 5000 X 8 THK', qty: '2 Nos', section: 'BOILER', status: null },
  { key: 'gauge', desc: 'PRESSURE GAUGE (STEAM)', moc: null, size: '0-10 Kg/cm2', qty: '1 No', section: 'MOUNTINGS', status: null },
  { key: 'angle', desc: 'MS ANGLE', moc: 'MS', size: 'ISA 50 X 50 X 5 - 5000 Lg', qty: '4 Nos', section: 'BOILER', status: null },
  { key: 'valve', desc: 'GLOBE VALVE (MSSV) - F/E', moc: null, size: '50 NB', qty: '1 No', section: 'MOUNTINGS', status: null },
  { key: 'safety', desc: 'SAFETY VALVE (HIGH LIFT TYPE)', moc: null, size: '2" x 3"', qty: '1 No', section: 'MOUNTINGS', status: null },
  { key: 'pump', desc: 'FEED PUMP (CENTRIFUGAL) & MOTOR', moc: null, size: '5 HP', qty: '2 Nos', section: 'MOUNTINGS', status: null }, // stays PENDING; TRANSIT stamped after PO issue below
  { key: 'pipe', desc: 'MS PIPE', moc: 'MS', size: "25 NB 'B' CL - 5000 Lg", qty: '3 Nos', section: 'BOILER', status: 'CLOSED' },
  { key: 'wlg', desc: 'WATER LEVEL GAUGE WITH PROTECTORS', moc: null, size: 'F/E', qty: '1 No', section: 'MOUNTINGS', status: 'RECEIVED' },
  { key: 'sheet', desc: 'MS CHEQUERED SHEET', moc: 'MS', size: '5 X 600 X 2500', qty: '1 No', section: 'BOILER', status: 'CANCELLED' },
];

const SUPPLIERS = [
  { name: 'Kirloskar Bros', gst_no: '27AAACK1234B1Z5', contact_person: 'R. Deshmukh', phone: '9876543210' },
  { name: 'Bansal Steel Traders', gst_no: '36AABCB5678C1Z2', contact_person: 'V. Bansal', phone: '9123456780' },
  { name: 'Precision Valves & Instruments Pvt Ltd', gst_no: '29AACPI4321D1Z8', contact_person: 'S. Iyer', phone: '9988776655' },
];

async function run(sql, args = []) {
  return db.execute({ sql, args });
}

console.log('--- Phase 0: wiping old BOM/procurement data for projects', PROJECTS.join(', '), '---');

// Dependent rows first (no FK enforcement in this DB, so order matters logically, not for errors).
await run('DELETE FROM supplier_quotes');
await run('DELETE FROM po_items');
await run('DELETE FROM purchase_orders');
await run('DELETE FROM suppliers');
for (const pid of PROJECTS) {
  await run('DELETE FROM bom_items WHERE project_id = ?', [pid]);
  await run('DELETE FROM bom_imports WHERE project_id = ?', [pid]);
}
console.log('  wiped.');

console.log('--- seeding suppliers ---');
const supplierId = {};
for (const s of SUPPLIERS) {
  const { lastInsertRowid } = await run(
    'INSERT INTO suppliers (name, gst_no, contact_person, phone) VALUES (?, ?, ?, ?)',
    [s.name, s.gst_no, s.contact_person, s.phone]
  );
  supplierId[s.name] = Number(lastInsertRowid);
  console.log(`  ${s.name} -> id ${supplierId[s.name]}`);
}
const KIRLOSKAR = supplierId['Kirloskar Bros'];
const BANSAL = supplierId['Bansal Steel Traders'];
const PRECISION = supplierId['Precision Valves & Instruments Pvt Ltd'];

console.log('--- seeding bom_items per project ---');
// itemId[projectId][key] so the PO/quote step below can address specific rows by name, not index.
const itemId = {};
for (const pid of PROJECTS) {
  itemId[pid] = {};
  let sortOrder = 0;
  for (const it of ITEM_TEMPLATE) {
    const { lastInsertRowid } = await run(
      `INSERT INTO bom_items (project_id, material_description, moc, size_spec, section, qty_text, purchase_status, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [pid, it.desc, it.moc, it.size, it.section, it.qty, it.status, sortOrder++]
    );
    itemId[pid][it.key] = Number(lastInsertRowid);
  }
  console.log(`  project ${pid}: ${ITEM_TEMPLATE.length} items`);
}

console.log('--- seeding quotes ---');
async function logQuote(bomItemId, projectId, supplierId, price, uom, days, terms, source) {
  const { lastInsertRowid } = await run(
    `INSERT INTO supplier_quotes
       (supplier_id, bom_item_id, project_id, unit_price, uom, expected_delivery_days, payment_terms, quote_source, quoted_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'seed-script')`,
    [supplierId, bomItemId, projectId, price, uom, days, terms, source]
  );
  return Number(lastInsertRowid);
}

const angleKirloskarQuote = {}, angleBansalQuote = {}, valveQuote = {}, safetyQuote = {}, pumpQuote = {};
for (const pid of PROJECTS) {
  angleKirloskarQuote[pid] = await logQuote(itemId[pid].angle, pid, KIRLOSKAR, 68.5, 'Kg', 10, 'Advance 40%', 'whatsapp');
  angleBansalQuote[pid] = await logQuote(itemId[pid].angle, pid, BANSAL, 71.2, 'Kg', 15, 'After Delivery', 'email');
  valveQuote[pid] = await logQuote(itemId[pid].valve, pid, PRECISION, 4200, 'No', 20, 'LC', 'phone');
  safetyQuote[pid] = await logQuote(itemId[pid].safety, pid, PRECISION, 6800, 'No', 12, 'Advance 50%', 'whatsapp');
  pumpQuote[pid] = await logQuote(itemId[pid].pump, pid, KIRLOSKAR, 18500, 'No', 25, 'LC', 'email');
}
console.log('  MS ANGLE: 2 quotes/project (comparing, no winner) · GLOBE VALVE: 1 quote/project (comparing)');
console.log('  SAFETY VALVE + FEED PUMP: 1 quote/project each, selected below (on order)');

console.log('--- selecting suppliers (safety valve + feed pump) ---');
for (const pid of PROJECTS) {
  await run('UPDATE bom_items SET selected_quote_id = ? WHERE id = ?', [safetyQuote[pid], itemId[pid].safety]);
  await run('UPDATE bom_items SET selected_quote_id = ? WHERE id = ?', [pumpQuote[pid], itemId[pid].pump]);
}

console.log('--- creating a draft PO (Safety Valve, Precision Valves, spans all 4 projects) ---');
{
  const seq = (await run("UPDATE counters SET value = value + 1 WHERE name = 'po_no' RETURNING value")).rows[0].value;
  const now = new Date();
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const poNo = `${seq}/SB/${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`;
  const { lastInsertRowid } = await run(
    `INSERT INTO purchase_orders (po_no, supplier_id, quote_source, quote_date, payment_terms, created_by)
     VALUES (?, ?, 'whatsapp', ?, 'Advance 50%', 'seed-script')`,
    [poNo, PRECISION, new Date().toISOString().slice(0, 10)]
  );
  const poId = Number(lastInsertRowid);
  let i = 0;
  for (const pid of PROJECTS) {
    await run(
      `INSERT INTO po_items (po_id, bom_item_id, project_id, description, qty, uom, rate, amount, sort_order)
       VALUES (?, ?, ?, 'SAFETY VALVE (HIGH LIFT TYPE)', 1, 'No', 6800, 6800, ?)`,
      [poId, itemId[pid].safety, pid, i++]
    );
  }
  console.log(`  ${poNo} (draft) — id ${poId}, 4 line items`);
}

console.log('--- creating + issuing a PO (Feed Pump, Kirloskar Bros, spans all 4 projects) ---');
{
  const seq = (await run("UPDATE counters SET value = value + 1 WHERE name = 'po_no' RETURNING value")).rows[0].value;
  const now = new Date();
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const poNo = `${seq}/SB/${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`;
  const { lastInsertRowid } = await run(
    `INSERT INTO purchase_orders (po_no, supplier_id, quote_source, quote_date, payment_terms, status, issued_at, created_by)
     VALUES (?, ?, 'email', ?, 'LC', 'issued', CURRENT_TIMESTAMP, 'seed-script')`,
    [poNo, KIRLOSKAR, new Date().toISOString().slice(0, 10)]
  );
  const poId = Number(lastInsertRowid);
  let i = 0;
  for (const pid of PROJECTS) {
    await run(
      `INSERT INTO po_items (po_id, bom_item_id, project_id, description, qty, uom, rate, amount, sort_order)
       VALUES (?, ?, ?, 'FEED PUMP (CENTRIFUGAL) & MOTOR', 2, 'No', 18500, 37000, ?)`,
      [poId, itemId[pid].pump, pid, i++]
    );
    // Issuing (existing PATCH /api/purchase-orders/[id] behavior): stamp po_ref, and — matching
    // this item's real status — flip it into TRANSIT so ProcurementQueue's stats read correctly too.
    await run('UPDATE bom_items SET po_ref = ?, purchase_status = ? WHERE id = ?', [poNo, 'TRANSIT', itemId[pid].pump]);
  }
  console.log(`  ${poNo} (issued) — id ${poId}, 4 line items, items flipped to TRANSIT`);
}

console.log('\n--- done ---');
console.log('Per project (x4): 2 to_source (Plate, Gauge) · 2 comparing (Angle x2 quotes, Valve x1 quote)');
console.log('  · 2 on_order (Safety Valve -> draft PO, Feed Pump -> issued PO / TRANSIT) · 1 CLOSED (Pipe)');
console.log('  · 1 RECEIVED (Water Level Gauge) · 1 CANCELLED (Chequered Sheet)');
