// Reseeds a small, readable procurement demo dataset that shows every stage of the sourcing/quote/PO
// lifecycle at once, across all 4 populated projects (SB-1104/SB-1103/SB-1105/STF-IBR-052 — project
// 2/SB-1018 has no BOM data and is left untouched). Originally Phase 0 of PROCUREMENT-CHANGES.md §7.
//
// **Preserves the real supplier master (4.5-DATA-INVENTORY.md).** As of the STERP vendor import the
// `suppliers` table is 445 rows of real client data, so this script NO LONGER wipes/reseeds it — it
// picks real suppliers by category keyword (steel/valve/pump) to act as the demo's vendors, deduped,
// with a fallback to any supplier. On a truly empty DB (no import yet) it inserts 3 demo suppliers so
// the script still runs standalone; it never deletes existing supplier rows.
//
// Idempotent for its own data: it deletes-then-reinserts the same fixed quote/PO/request/task set
// (its rows are tagged created_by='seed-script' where a column exists). Does NOT touch packing_items
// (own copies, no FK), milestones/stages/users/projects, or the real supplier master.
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
  { key: 'plate', desc: 'MS PLATE', moc: 'MS', size: '2000 X 5000 X 8 THK', qty: '2 Nos', section: 'BOILER', status: 'Enquiry' },
  { key: 'gauge', desc: 'PRESSURE GAUGE (STEAM)', moc: null, size: '0-10 Kg/cm2', qty: '1 No', section: 'MOUNTINGS', status: 'Enquiry' },
  { key: 'angle', desc: 'MS ANGLE', moc: 'MS', size: 'ISA 50 X 50 X 5 - 5000 Lg', qty: '4 Nos', section: 'BOILER', status: 'Comparison' },
  { key: 'valve', desc: 'GLOBE VALVE (MSSV) - F/E', moc: null, size: '50 NB', qty: '1 No', section: 'MOUNTINGS', status: 'Comparison' },
  { key: 'safety', desc: 'SAFETY VALVE (HIGH LIFT TYPE)', moc: null, size: '2" x 3"', qty: '1 No', section: 'MOUNTINGS', status: 'Comparison' },
  { key: 'pump', desc: 'FEED PUMP (CENTRIFUGAL) & MOTOR', moc: null, size: '5 HP', qty: '2 Nos', section: 'MOUNTINGS', status: 'Comparison' }, // -> Ordered/Transit stamped after PO issue below
  { key: 'pipe', desc: 'MS PIPE', moc: 'MS', size: "25 NB 'B' CL - 5000 Lg", qty: '3 Nos', section: 'BOILER', status: 'Received' },
  { key: 'wlg', desc: 'WATER LEVEL GAUGE WITH PROTECTORS', moc: null, size: 'F/E', qty: '1 No', section: 'MOUNTINGS', status: 'Received' },
  { key: 'sheet', desc: 'MS CHEQUERED SHEET', moc: 'MS', size: '5 X 600 X 2500', qty: '1 No', section: 'BOILER', status: 'Cancelled' },
];

// Only used when the suppliers table is empty (fresh DB, no vendor import) — never inserted over a
// real master.
const FALLBACK_DEMO_SUPPLIERS = [
  { name: 'Bansal Steel Traders', gst_no: '36AABCB5678C1Z2', contact_person: 'V. Bansal', phone: '9123456780' },
  { name: 'Atam Valves Ltd', gst_no: '29AACPI4321D1Z8', contact_person: 'S. Iyer', phone: '9988776655' },
  { name: 'Andhra Pumps & Motors', gst_no: '27AAACK1234B1Z5', contact_person: 'R. Deshmukh', phone: '9876543210' },
];

async function run(sql, args = []) {
  return db.execute({ sql, args });
}

// Pick a real supplier whose name matches a category keyword (steel/valve/pump), skipping ones already
// chosen so the demo spreads across several vendors. Falls back to any unused supplier if a category
// has no match — so the script is robust to whatever the real master actually contains.
async function pickSupplier(keyword, used) {
  const byKw = await run('SELECT id, name FROM suppliers WHERE UPPER(name) LIKE ? ORDER BY id', [`%${keyword}%`]);
  for (const r of byKw.rows) if (!used.has(r.id)) { used.add(r.id); return { id: r.id, name: r.name }; }
  const any = await run('SELECT id, name FROM suppliers ORDER BY id');
  for (const r of any.rows) if (!used.has(r.id)) { used.add(r.id); return { id: r.id, name: r.name }; }
  throw new Error('No suppliers in the DB — import the vendor master first (4.5-DATA-INVENTORY.md).');
}

console.log('--- wiping this script\'s own demo procurement data (suppliers preserved) ---');
// Dependent rows first (no FK enforcement in this DB, so order matters logically). NOT suppliers.
await run('DELETE FROM supplier_quotes');
await run('DELETE FROM po_items');
await run('DELETE FROM purchase_orders');
await run("DELETE FROM tasks WHERE created_by = 'seed-script'");
// Group 5 additions (V2-CHANGES.md 5.1–5.4): RFQs, PRs (which materialize bom_items), and the
// direct-cancel flow's void-PO notifications are demo-generated procurement state too. FK order
// matters on Turso (which enforces FKs, unlike the local-sqlite fallback): rfq_items references
// bom_items, so RFQs go BEFORE the bom_items wipe; bom_items.pr_item_id references pr_items, so
// PR tables go AFTER it.
await run('DELETE FROM rfq_items');
await run('DELETE FROM rfq_suppliers');
await run('DELETE FROM rfqs');
await run("DELETE FROM notifications WHERE kind = 'po_void_needed'");
for (const pid of PROJECTS) {
  await run('DELETE FROM bom_items WHERE project_id = ?', [pid]);
  await run('DELETE FROM bom_imports WHERE project_id = ?', [pid]);
  await run('DELETE FROM procurement_requests WHERE project_id = ?', [pid]);
}
await run('DELETE FROM pr_item_projects');
await run('DELETE FROM pr_items');
await run('DELETE FROM purchase_requisitions');
console.log('  wiped (quotes, POs, RFQs, PRs, seed tasks, demo-project BOM/requests).');

// Fresh-DB fallback only — never over a real master.
const supCount = (await run('SELECT COUNT(*) AS n FROM suppliers')).rows[0].n;
if (supCount === 0) {
  console.log('--- suppliers table empty — inserting 3 fallback demo suppliers ---');
  for (const s of FALLBACK_DEMO_SUPPLIERS) {
    await run('INSERT INTO suppliers (name, gst_no, contact_person, phone) VALUES (?, ?, ?, ?)',
      [s.name, s.gst_no, s.contact_person, s.phone]);
  }
}

console.log('--- choosing real suppliers as demo vendors ---');
const used = new Set();
const S_STEEL = await pickSupplier('STEEL', used);   // MS ANGLE (primary)
const S_STEEL2 = await pickSupplier('STEEL', used);  // MS ANGLE (comparison quote)
const S_VALVE = await pickSupplier('VALVE', used);   // GLOBE + SAFETY VALVE
const S_PUMP = await pickSupplier('PUMP', used);     // FEED PUMP (winning)
const S_PUMP2 = await pickSupplier('PUMP', used);    // FEED PUMP (rejected offer)
for (const [role, s] of [['steel', S_STEEL], ['steel-2', S_STEEL2], ['valve', S_VALVE], ['pump', S_PUMP], ['pump-2', S_PUMP2]]) {
  console.log(`  ${role.padEnd(8)} -> [${s.id}] ${s.name}`);
}

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

console.log('--- seeding quotes (from the real suppliers above) ---');
async function logQuote(bomItemId, projectId, supplierId, price, uom, days, terms, source) {
  const deliveryDate = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const { lastInsertRowid } = await run(
    `INSERT INTO supplier_quotes
       (supplier_id, bom_item_id, project_id, unit_price, uom, expected_delivery_days, expected_delivery_date,
        payment_terms, quote_source, quoted_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'seed-script')`,
    [supplierId, bomItemId, projectId, price, uom, days, deliveryDate, terms, source]
  );
  return Number(lastInsertRowid);
}

const safetyQuote = {}, pumpQuote = {};
for (const pid of PROJECTS) {
  await logQuote(itemId[pid].angle, pid, S_STEEL.id, 68.5, 'Kg', 10, 'Advance 40%', 'whatsapp');
  await logQuote(itemId[pid].angle, pid, S_STEEL2.id, 71.2, 'Kg', 15, 'After Delivery', 'email');
  await logQuote(itemId[pid].valve, pid, S_VALVE.id, 4200, 'No', 20, 'LC', 'phone');
  safetyQuote[pid] = await logQuote(itemId[pid].safety, pid, S_VALVE.id, 6800, 'No', 12, 'Advance 50%', 'whatsapp');
  pumpQuote[pid] = await logQuote(itemId[pid].pump, pid, S_PUMP.id, 18500, 'No', 25, 'LC', 'email');
  // A second, unselected quote on the Feed Pump — so the item that ends up with an issued PO also
  // has a real "rejected offer" to show in the cancel-request detail overlay (§ Phase 4 point 6).
  await logQuote(itemId[pid].pump, pid, S_PUMP2.id, 19800, 'No', 30, 'After Delivery', 'phone');
}
console.log('  MS ANGLE: 2 quotes/project (comparing) · GLOBE VALVE: 1 quote/project (comparing)');
console.log('  SAFETY VALVE + FEED PUMP: 1 quote/project each, selected below · FEED PUMP also has 1 rejected quote');

console.log('--- selecting suppliers (safety valve + feed pump) ---');
for (const pid of PROJECTS) {
  await run('UPDATE bom_items SET selected_quote_id = ? WHERE id = ?', [safetyQuote[pid], itemId[pid].safety]);
  await run('UPDATE bom_items SET selected_quote_id = ? WHERE id = ?', [pumpQuote[pid], itemId[pid].pump]);
  // D2 tri-state, matching what selectQuoteForItem (lib/procurement.js) writes for a real
  // selection: winner = 1, every sibling quote on the same item = 0.
  await run('UPDATE supplier_quotes SET is_selected = 1 WHERE id IN (?, ?)', [safetyQuote[pid], pumpQuote[pid]]);
  await run('UPDATE supplier_quotes SET is_selected = 0 WHERE bom_item_id = ? AND id != ?', [itemId[pid].pump, pumpQuote[pid]]);
}

function poNumber(seq) {
  const now = new Date();
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${seq}/SB/${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`;
}

console.log(`--- creating a draft PO (Safety Valve, ${S_VALVE.name}, spans all 4 projects) ---`);
{
  const seq = (await run("UPDATE counters SET value = value + 1 WHERE name = 'po_no' RETURNING value")).rows[0].value;
  const poNo = poNumber(seq);
  const { lastInsertRowid } = await run(
    `INSERT INTO purchase_orders (po_no, supplier_id, quote_source, quote_date, payment_terms, created_by)
     VALUES (?, ?, 'whatsapp', ?, 'Advance 50%', 'seed-script')`,
    [poNo, S_VALVE.id, new Date().toISOString().slice(0, 10)]
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

console.log(`--- creating + issuing a PO (Feed Pump, ${S_PUMP.name}, spans all 4 projects) ---`);
{
  const seq = (await run("UPDATE counters SET value = value + 1 WHERE name = 'po_no' RETURNING value")).rows[0].value;
  const poNo = poNumber(seq);
  const { lastInsertRowid } = await run(
    `INSERT INTO purchase_orders (po_no, supplier_id, quote_source, quote_date, payment_terms, status, issued_at, created_by)
     VALUES (?, ?, 'email', ?, 'LC', 'issued', CURRENT_TIMESTAMP, 'seed-script')`,
    [poNo, S_PUMP.id, new Date().toISOString().slice(0, 10)]
  );
  const poId = Number(lastInsertRowid);
  let i = 0;
  for (const pid of PROJECTS) {
    await run(
      `INSERT INTO po_items (po_id, bom_item_id, project_id, description, qty, uom, rate, amount, sort_order)
       VALUES (?, ?, ?, 'FEED PUMP (CENTRIFUGAL) & MOTOR', 2, 'No', 18500, 37000, ?)`,
      [poId, itemId[pid].pump, pid, i++]
    );
    // Issuing (PATCH /api/purchase-orders/[id], Phase 5.1 semantics): stamp po_ref and advance
    // to Ordered — issue means Ordered now, not Transit (D5). Half the projects then get the
    // manual Status-tab override to Transit ("shipment confirmed dispatched"), so the demo still
    // shows every D4 stage without faking how any of them is reached.
    const status = PROJECTS.indexOf(pid) % 2 === 0 ? 'Ordered' : 'Transit';
    await run('UPDATE bom_items SET po_ref = ?, purchase_status = ? WHERE id = ?', [poNo, status, itemId[pid].pump]);
  }
  console.log(`  ${poNo} (issued) — id ${poId}, 4 line items -> Ordered (2 overridden to Transit)`);
}

// Pending new-item requests and cancel-request tasks are no longer seeded — both mechanisms were
// retired by Group 5 Bundles A/B (V2-CHANGES.md): PRs materialize straight to Enquiry with no
// accept step, and Eng/Design cancel items directly from the BOM table. Seeding them would create
// rows nothing in the UI can display or resolve.
const today = new Date().toISOString().slice(0, 10);
async function addTask(title, department, fromDepartment, projectId, bomItemId, assignedTo) {
  await run(
    `INSERT INTO tasks (title, due_date, department, assigned_to, created_by, from_department, project_id, bom_item_id)
     VALUES (?, ?, ?, ?, 'seed-script', ?, ?, ?)`,
    [title, today, department, assignedTo, fromDepartment, projectId, bomItemId]
  );
}

console.log('--- seeding plain cross-department tasks (Outgoing/Incoming Incidents) ---');
await addTask('Confirm hydro test slot before we release the boiler shell PO',
  'QC', 'Procurement', PROJECTS[0], null, 'qc_head');
await addTask('Flag any spec changes on MS ANGLE before we finalize the vendor comparison',
  'Design', 'Procurement', PROJECTS[1], null, 'design_head');
await addTask('Please confirm expected delivery for the pressure gauge before we finalize drawings',
  'Procurement', 'Design', PROJECTS[0], null, 'procurement_head');
await addTask('Stores needs the updated GRN contact for the new valve PO',
  'Procurement', 'Stores', PROJECTS[2], null, 'procurement_head');
console.log('  2 raised by Procurement, 2 raised for Procurement');

console.log('\n--- done ---');
console.log('Per project (x4): 2 Enquiry (Plate, Gauge) · 3 Comparison (Angle x2 quotes, Valve, Safety Valve selected -> draft PO)');
console.log('  · 1 Ordered-or-Transit (Feed Pump, issued PO; Transit on half the projects) · 2 Received (Pipe, Water Level Gauge)');
console.log('  · 1 Cancelled (Chequered Sheet)');
console.log('Both POs span all 4 projects -> the Purchase Orders tab shows "Multiple" (Group 4a).');
