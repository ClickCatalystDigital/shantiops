// Wipes every per-project/demo row (projects, leads, customers, quotations, sale orders, BOM, QC,
// job cards, packing, calc sheets/drawings, tasks, notifications, opportunities) and rebuilds 3
// projects, each frozen at one distinct pipeline stage, so a demo can walk prospect -> mid-build ->
// dispatched without any one project representing two stages at once. Confirmed with the user
// (2026-08-17): all current project data is test/demo data, safe to wipe.
//
// Config/master tables are left untouched: users, employees, operations, workstations, trades,
// stage_templates/stage_template_items, calc_formulas*/calc_tables*/calc_validations/calc_templates
// (global engineering methodology, not project data), suppliers, counters, holidays,
// system_migrations.
//
// Re-runnable: wipes its own output before rebuilding, same "reset to a known state" contract as
// scripts/seed-procurement-demo.mjs, just for the whole pipeline instead of one department.
//
// Run: node --env-file=.env.local scripts/seed-demo-pipeline.mjs
import { createClient } from '@libsql/client';

const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
  intMode: 'number',
});

async function run(sql, args = []) {
  return db.execute({ sql, args });
}

async function nextCounter(name) {
  const r = await run(
    `INSERT INTO counters (name, value) VALUES (?, 1001)
     ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value`,
    [name]
  );
  return r.rows[0].value;
}

function poNumber(seq) {
  const now = new Date();
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${seq}/SB/${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`;
}
function quotationNumber(seq) {
  const now = new Date();
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `QTN-${seq}/SB/${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`;
}
function isoDaysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }
function isoDaysFromNow(n) { return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10); }

// A compact copy of lib/milestones.js's MILESTONE_TEMPLATE — this script runs standalone (plain
// `node`, no Next.js module loader), so it can't import the app's own ES module files directly;
// same reason scripts/seed-procurement-demo.mjs inlines its own item template instead of importing
// bom-fields.mjs. Keep in sync by hand if the real template changes.
const MILESTONES = [
  ['design', 'Design', 'Design'], ['design_approval', 'Submit Design Approval', 'Design'],
  ['release_bom', 'Release BOM / PR', 'Design'], ['release_drawings', 'Release All Drawings', 'Design'],
  ['order_tubes', 'Order BQ / Tubes', 'Procurement'], ['procure_tubes', 'Procure Tubes', 'Procurement'],
  ['order_ms', 'Order MS as per PR', 'Procurement'], ['order_valves', 'Order Pumps / Valves / SV / Motors', 'Procurement'],
  ['order_panel', 'Order WLG / Casting / Panel', 'Procurement'],
  ['marking_cutting', 'Marking, Cutting, Rolling Shell', 'Production'], ['drilling', 'Drilling', 'Production'],
  ['shell_welding', 'Shell Welding', 'Production'], ['site_marking', 'Site Marking', 'Production'],
  ['welding_fura', 'Welding (FURA-B / RC / AR)', 'Production'], ['box_up', 'Box Up', 'Production'],
  ['box_up_welding', 'Box Up Welding (OS / IS / G)', 'Production'],
  ['tube_stay_welding', 'Tubes & Stay Rods — Insert & Welding', 'Production'],
  ['pad_plates', 'Pad Plates / Saddles / Nozzles / LH', 'Production'],
  ['smoke_box', 'Smoke Box / Feed Line / Ladder / Platform', 'Production'],
  ['hydro_test', 'Hydro Test (HT)', 'Production'], ['refractory', 'Refractory', 'Production'],
  ['painting', 'Painting', 'Production'], ['packing', 'Packing & Labeling', 'Dispatch'],
  ['site_installation', 'Site Installation', 'Installation'], ['commissioning', 'Commissioning & Handover', 'Installation'],
];

// doneThrough = index of the last milestone considered done; the next one (if any) is in_progress,
// everything after stays pending. A simple, explicit stage marker rather than the app's own
// demoStory date-derived algorithm — deliberate here since each project needs to sit at one clear,
// predictable stage for the demo, not a randomized "today" snapshot.
async function seedMilestones(projectId, doneThrough) {
  for (let i = 0; i < MILESTONES.length; i++) {
    const [key, label, department] = MILESTONES[i];
    let status = 'pending', as = null, ae = null, ps = null, pe = null;
    if (i <= doneThrough) {
      status = 'done';
      ps = isoDaysAgo(120 - i * 3); pe = isoDaysAgo(117 - i * 3); as = ps; ae = pe;
    } else if (i === doneThrough + 1) {
      status = 'in_progress';
      ps = isoDaysAgo(3); as = ps;
      pe = isoDaysFromNow(4);
    } else {
      ps = isoDaysFromNow((i - doneThrough) * 4);
      pe = isoDaysFromNow((i - doneThrough) * 4 + 3);
    }
    await run(
      `INSERT INTO milestones (project_id, milestone_key, milestone_label, sort_order, department, planned_start, planned_end, actual_start, actual_end, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [projectId, key, label, i, department, ps, pe, as, ae, status]
    );
  }
}

async function getOrCreateCustomer({ name, phone, email, city, state, gst_no }) {
  const existing = await run('SELECT id FROM customers WHERE name = ?', [name]);
  if (existing.rows.length) return existing.rows[0].id;
  const r = await run(
    `INSERT INTO customers (name, phone, email, city, state, gst_no) VALUES (?, ?, ?, ?, ?, ?)`,
    [name, phone, email, city, state, gst_no]
  );
  return Number(r.lastInsertRowid);
}

async function createLead({ leadName, companyName, phone, email, customerId }) {
  const r = await run(
    `INSERT INTO leads (lead_name, company_name, phone, email, source, status, owner_dept, notes, converted_customer_id, created_by)
     VALUES (?, ?, ?, ?, 'referral', 'converted', 'Sales', ?, ?, 'seed-script')`,
    [leadName, companyName, phone, email, `Converted to ${companyName} on customer onboarding.`, customerId]
  );
  return Number(r.lastInsertRowid);
}

async function createQuotation({ customerId, items, terms }) {
  const seq = await nextCounter('quotation_no');
  const quotationNo = quotationNumber(seq);
  const subtotal = items.reduce((a, it) => a + it.qty * it.rate, 0);
  const taxPct = 18;
  const taxAmount = subtotal * taxPct / 100;
  const total = subtotal + taxAmount;
  const r = await run(
    `INSERT INTO quotations (quotation_no, customer_id, quotation_date, valid_until, status, subtotal, tax_pct, tax_amount, total, terms, created_by)
     VALUES (?, ?, ?, ?, 'accepted', ?, ?, ?, ?, ?, 'seed-script')`,
    [quotationNo, customerId, isoDaysAgo(30), isoDaysAgo(-30), subtotal, taxPct, taxAmount, total, terms]
  );
  const quotationId = Number(r.lastInsertRowid);
  let sortOrder = 0;
  for (const it of items) {
    await run(
      `INSERT INTO quotation_items (quotation_id, item_description, hsn_code, qty, uom, rate, amount, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [quotationId, it.desc, it.hsn || null, it.qty, it.uom, it.rate, it.qty * it.rate, sortOrder++]
    );
  }
  return { quotationId, quotationNo, customerId, subtotal, taxPct, taxAmount, total, items };
}

async function convertQuotationToSaleOrder(quotation, customerName, company) {
  const seq = await nextCounter('sale_order_no');
  const soNo = `SO-${seq}`;
  const r = await run(
    `INSERT INTO sale_orders (so_no, customer_name, customer_id, quotation_id, description, subtotal, tax_pct, tax_amount, total, company, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'seed-script')`,
    [soNo, customerName, quotation.customerId, quotation.quotationId, `Converted from ${quotation.quotationNo}`,
      quotation.subtotal, quotation.taxPct, quotation.taxAmount, quotation.total, company]
  );
  const soId = Number(r.lastInsertRowid);
  let sortOrder = 0;
  for (const it of quotation.items) {
    await run(
      `INSERT INTO sale_order_items (sale_order_id, item_description, hsn_code, qty, uom, rate, amount, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [soId, it.desc, it.hsn || null, it.qty, it.uom, it.rate, it.qty * it.rate, sortOrder++]
    );
  }
  return { soId, soNo };
}

async function createProject({ projectNo, customerName, customerId, saleOrderId, description, orderValue, company }) {
  const r = await run(
    `INSERT INTO projects (project_no, customer_name, description, order_date, order_value, owner, customer_id, sale_order_id, company)
     VALUES (?, ?, ?, ?, ?, 'manager', ?, ?, ?)`,
    [projectNo, customerName, description, isoDaysAgo(90), orderValue, customerId, saleOrderId, company]
  );
  const projectId = Number(r.lastInsertRowid);
  await run(`INSERT INTO scope_of_supply (project_id, title, status, created_by) VALUES (?, ?, 'released', 'seed-script')`,
    [projectId, `Scope of Supply — SO linked`]);
  return projectId;
}

async function setCustomerLogin(username, projectId) {
  await run('UPDATE users SET project_ids = ? WHERE username = ?', [String(projectId), username]);
}

console.log('=== Step 1: wiping per-project/demo data (config/masters preserved) ===');
{
  // Children before parents — no reliance on ON DELETE CASCADE even where it exists, same explicit
  // philosophy scripts/seed-procurement-demo.mjs already documents for this DB.
  await run('DELETE FROM qc_document_parts');
  await run('DELETE FROM qc_mountings');
  await run('DELETE FROM qc_documents');
  await run('DELETE FROM test_certificates');
  await run('DELETE FROM po_items');
  await run('DELETE FROM supplier_quotes');
  await run('DELETE FROM purchase_orders');
  await run('DELETE FROM rfq_items');
  await run('DELETE FROM rfq_suppliers');
  await run('DELETE FROM rfqs');
  // Real (non-addColumn) FKs to both bom_items and job_cards — must go before either is deleted.
  await run('DELETE FROM material_issues');
  await run('DELETE FROM inventory_reservations');
  await run('DELETE FROM job_card_time_logs');
  await run('DELETE FROM job_card_consumables');
  await run('DELETE FROM job_cards');
  await run('DELETE FROM milestone_stages');
  await run('DELETE FROM milestones');
  await run('DELETE FROM calc_drawing_comments');
  await run('DELETE FROM calc_drawing_files');
  await run('DELETE FROM calc_drawings');
  await run('DELETE FROM calc_notes');
  await run('DELETE FROM calc_variables');
  await run('DELETE FROM calc_sheets');
  await run('DELETE FROM packing_items');
  await run('DELETE FROM packing_lists');
  await run('DELETE FROM bom_items');
  await run('DELETE FROM bom_imports');
  await run('DELETE FROM procurement_requests');
  await run('DELETE FROM pr_item_projects');
  await run('DELETE FROM pr_items');
  await run('DELETE FROM purchase_requisitions');
  await run('DELETE FROM notifications');
  await run('DELETE FROM tasks');
  await run('DELETE FROM attendance_days');
  await run('DELETE FROM scope_of_supply');
  // projects.sale_order_id references sale_orders -- projects must be deleted before sale_orders,
  // not after (every other project-scoped table was already cleared above, so this is safe here).
  await run("UPDATE users SET project_ids = '' WHERE role = 'customer'");
  await run('DELETE FROM projects');
  // opportunities is referenced by leads/quotations/sale_orders -- all three must go first.
  // customers is intentionally NOT wiped, same "accumulating master" treatment as suppliers --
  // getOrCreateCustomer below reuses an existing row by name rather than erroring on UNIQUE(name).
  await run('DELETE FROM opportunity_items');
  await run('DELETE FROM sale_order_items');
  await run('DELETE FROM sale_orders');
  await run('DELETE FROM quotation_items');
  await run('DELETE FROM quotations');
  await run('DELETE FROM leads');
  await run('DELETE FROM opportunities');
  console.log('  wiped.');
}

console.log('=== Step 2: front-of-funnel — Lead -> Customer -> Quotation -> Sale Order (no project yet) ===');
{
  const customerId = await getOrCreateCustomer({
    name: 'Ganga Textiles Pvt Ltd', phone: '9845011223', email: 'procurement@gangatextiles.example',
    city: 'Surat', state: 'Gujarat', gst_no: '24AABCG1234H1Z5',
  });
  await createLead({ leadName: 'R. Chowdhury', companyName: 'Ganga Textiles Pvt Ltd', phone: '9845011223', email: 'procurement@gangatextiles.example', customerId });
  const quotation = await createQuotation({
    customerId,
    items: [
      { desc: '2 TPH Solid Fuel Fired Boiler @ 10.5 Kg/cm2', hsn: '8402', qty: 1, uom: 'No', rate: 3200000 },
      { desc: 'Economizer package', hsn: '8402', qty: 1, uom: 'No', rate: 280000 },
    ],
    terms: 'Advance 30% with order, balance against dispatch. Delivery 16 weeks from drawing approval.',
  });
  const so = await convertQuotationToSaleOrder(quotation, 'Ganga Textiles Pvt Ltd', 'Shanti Boilers');
  console.log(`  Ganga Textiles -> ${quotation.quotationNo} (accepted) -> ${so.soNo} — stops here, no project yet.`);
}

console.log('=== Step 3: mid-pipeline project — Design in progress, BOM sourcing underway ===');
{
  const customerId = await getOrCreateCustomer({
    name: 'Konkan Sugars Ltd', phone: '9822334455', email: 'engg@konkansugars.example',
    city: 'Kolhapur', state: 'Maharashtra', gst_no: '27AADCK5678L1Z9',
  });
  await createLead({ leadName: 'V. Patil', companyName: 'Konkan Sugars Ltd', phone: '9822334455', email: 'engg@konkansugars.example', customerId });
  const quotation = await createQuotation({
    customerId,
    items: [{ desc: '5 TPH Bagasse Fired Boiler @ 17.5 Kg/cm2', hsn: '8402', qty: 1, uom: 'No', rate: 6800000 }],
    terms: 'Advance 40% with order, 40% before dispatch, 20% on commissioning.',
  });
  const so = await convertQuotationToSaleOrder(quotation, 'Konkan Sugars Ltd', 'Shanti Boilers');
  const seq = await nextCounter('project_no');
  const projectNo = `SB-${seq}`;
  const projectId = await createProject({
    projectNo, customerName: 'Konkan Sugars Ltd', customerId, saleOrderId: so.soId,
    description: '5 TPH Bagasse Fired Boiler @ W.P. 17.5', orderValue: quotation.total, company: 'Shanti Boilers',
  });
  await seedMilestones(projectId, 1); // Design + Design approval done, Release BOM in progress

  const sheetR = await run(`INSERT INTO calc_sheets (project_id, name, created_by) VALUES (?, 'Main Sheet', 'seed-script')`, [projectId]);
  const sheetId = Number(sheetR.lastInsertRowid);

  const drawings = [
    // Design hasn't shared this one yet — both gates apply: in_progress AND customer_visible=0
    // (the default), demonstrating a drawing that stays internal on Design's own call, not just status.
    { name: 'GA Drawing', drawingType: 'GA', status: 'in_progress', customerVisible: 0 },
    { name: 'Foundation Drawing', drawingType: 'Foundation', status: 'under_review', customerVisible: 1 }, // left live for a demo of the new approve flow
    { name: 'Nozzle Schedule', drawingType: 'GA', status: 'approved', customerVisible: 1 },     // pre-seeded finished example
  ];
  const drawingIds = {};
  for (const d of drawings) {
    const r = await run(
      `INSERT INTO calc_drawings (project_id, name, drawing_type, status, customer_visible) VALUES (?, ?, ?, ?, ?)`,
      [projectId, d.name, d.drawingType, d.status, d.customerVisible]
    );
    drawingIds[d.name] = Number(r.lastInsertRowid);
  }
  await run(`UPDATE calc_drawings SET customer_approved_at = ?, customer_approved_by = 'V. Patil' WHERE id = ?`,
    [isoDaysAgo(2) + ' 10:15:00', drawingIds['Nozzle Schedule']]);
  const nozzleThread = [
    { type: 'internal', name: 'D. Jaganmohan Rao', body: 'Nozzle schedule ready for your review — sizes as per the finalized P&ID.' },
    { type: 'customer', name: 'V. Patil', body: 'Looks good, can you confirm N4 is the feedwater inlet?' },
    { type: 'internal', name: 'D. Jaganmohan Rao', body: 'Confirmed — N4 is feedwater inlet, N5 is the blowdown.' },
  ];
  for (const c of nozzleThread) {
    await run(`INSERT INTO calc_drawing_comments (drawing_id, author_type, author_name, body) VALUES (?, ?, ?, ?)`,
      [drawingIds['Nozzle Schedule'], c.type, c.name, c.body]);
  }

  const bomItems = [
    { desc: 'MS PLATE', moc: 'MS', size: '2000 X 6000 X 10 THK', qty: '4 Nos', section: 'BOILER', status: 'PENDING' },
    { desc: 'PRESSURE GAUGE (STEAM)', moc: null, size: '0-25 Kg/cm2', qty: '2 No', section: 'MOUNTINGS', status: 'PENDING' },
    { desc: 'MS ANGLE', moc: 'MS', size: 'ISA 65 X 65 X 6', qty: '8 Nos', section: 'BOILER', status: 'TRANSIT' },
    { desc: 'FEED PUMP (CENTRIFUGAL) & MOTOR', moc: null, size: '10 HP', qty: '2 Nos', section: 'MOUNTINGS', status: 'RECEIVED' },
  ];
  let sortOrder = 0;
  for (const it of bomItems) {
    await run(
      `INSERT INTO bom_items (project_id, material_description, moc, size_spec, section, qty_text, purchase_status, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [projectId, it.desc, it.moc, it.size, it.section, it.qty, it.status, sortOrder++]
    );
  }

  await setCustomerLogin('hkm_charitable', projectId);
  console.log(`  ${projectNo} (Konkan Sugars) — id ${projectId}, Design in progress, BOM mixed, drawings live for demo.`);
  console.log(`  Customer login: hkm_charitable / hkm_charitable123`);
}

console.log('=== Step 4: near-complete project — rebuilt SB-1018 ===');
{
  const customerId = await getOrCreateCustomer({
    name: 'Asian Brown Bleachchem P Ltd', phone: '9812345678', email: 'purchase@asianbrown.example',
    city: 'Ankleshwar', state: 'Gujarat', gst_no: '24AABCA9876M1Z1',
  });
  await createLead({ leadName: 'S. Mehta', companyName: 'Asian Brown Bleachchem P Ltd', phone: '9812345678', email: 'purchase@asianbrown.example', customerId });
  const quotation = await createQuotation({
    customerId,
    items: [{ desc: '3 TPH Solid Fuel Fired Boiler @ W.P. 10.54', hsn: '8402', qty: 1, uom: 'No', rate: 4200000 }],
    terms: 'Advance 30% with order, balance against dispatch.',
  });
  const so = await convertQuotationToSaleOrder(quotation, 'Asian Brown Bleachchem P Ltd', 'Shanti Boilers');
  const projectNo = 'SB-1018';
  const projectId = await createProject({
    projectNo, customerName: 'Asian Brown Bleachchem P Ltd', customerId, saleOrderId: so.soId,
    description: '3 TPH Solid Fuel Fired Boiler', orderValue: quotation.total, company: 'Shanti Boilers',
  });
  await seedMilestones(projectId, 22); // everything through Painting done, Packing in progress, Site/Commissioning pending

  await run(`INSERT INTO calc_sheets (project_id, name, created_by) VALUES (?, 'Main Sheet', 'seed-script')`, [projectId]);

  const drawings = [
    { name: 'GA Drawing', drawingType: 'GA', status: 'as_built' },
    { name: 'Foundation Drawing', drawingType: 'Foundation', status: 'approved' },
  ];
  const drawingIds = {};
  for (const d of drawings) {
    // Both shared with the customer — GA and Foundation are the two the client actually needs to see.
    const r = await run(`INSERT INTO calc_drawings (project_id, name, drawing_type, status, customer_visible) VALUES (?, ?, ?, ?, 1)`, [projectId, d.name, d.drawingType, d.status]);
    drawingIds[d.name] = Number(r.lastInsertRowid);
  }
  await run(`UPDATE calc_drawings SET customer_approved_at = ?, customer_approved_by = 'S. Mehta' WHERE id IN (?, ?)`,
    [isoDaysAgo(60) + ' 09:00:00', drawingIds['GA Drawing'], drawingIds['Foundation Drawing']]);
  await run(`INSERT INTO calc_drawing_comments (drawing_id, author_type, author_name, body) VALUES (?, 'customer', 'S. Mehta', 'Approved — please proceed to fabrication.')`,
    [drawingIds['GA Drawing']]);

  const bomItems = [
    { desc: 'MS PLATE', moc: 'MS', size: '2000 X 5000 X 8 THK', qty: '2 Nos', section: 'BOILER', status: 'CLOSED' },
    { desc: 'PRESSURE GAUGE (STEAM)', moc: null, size: '0-10 Kg/cm2', qty: '1 No', section: 'MOUNTINGS', status: 'RECEIVED' },
    { desc: 'MS ANGLE', moc: 'MS', size: 'ISA 50 X 50 X 5', qty: '4 Nos', section: 'BOILER', status: 'CLOSED' },
    { desc: 'GLOBE VALVE (MSSV) - F/E', moc: null, size: '50 NB', qty: '1 No', section: 'MOUNTINGS', status: 'RECEIVED' },
    { desc: 'SAFETY VALVE (HIGH LIFT TYPE)', moc: null, size: '2" x 3"', qty: '1 No', section: 'MOUNTINGS', status: 'CLOSED' },
  ];
  let sortOrder = 0;
  const bomIds = [];
  for (const it of bomItems) {
    const r = await run(
      `INSERT INTO bom_items (project_id, material_description, moc, size_spec, section, qty_text, purchase_status, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [projectId, it.desc, it.moc, it.size, it.section, it.qty, it.status, sortOrder++]
    );
    bomIds.push(Number(r.lastInsertRowid));
  }

  console.log('  seeding QC — test certificates + statutory document');
  const certs = [
    { certificate_no: 'TC-9001', cast_no: 'C-101', plate_no: 'PL-01', material_spec: 'IS 2062 E250', steel_maker: 'SAIL', size_t: '8', size_w: '2000', size_l: '5000' },
    { certificate_no: 'TC-9002', cast_no: 'C-102', plate_no: 'PL-02', material_spec: 'IS 2062 E250', steel_maker: 'SAIL', size_t: '10', size_w: '2000', size_l: '6000' },
  ];
  const certIds = [];
  for (const c of certs) {
    const r = await run(
      `INSERT INTO test_certificates (certificate_no, cast_no, plate_no, material_spec, steel_maker, size_t, size_w, size_l, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'seed-script')`,
      [c.certificate_no, c.cast_no, c.plate_no, c.material_spec, c.steel_maker, c.size_t, c.size_w, c.size_l]
    );
    certIds.push(Number(r.lastInsertRowid));
  }
  const docR = await run(
    `INSERT INTO qc_documents (project_id, series, doc_id, boiler_type, design_pressure, hydro_test_pressure, drawing_no, created_by)
     VALUES (?, 'SF', 'SF-2026-018', '3 TPH Solid Fuel Fired', '10.54 Kg/cm2', '16 Kg/cm2', 'SB-1018-GA-01', 'seed-script')`,
    [projectId]
  );
  const docId = Number(docR.lastInsertRowid);
  await run(`INSERT INTO qc_document_parts (document_id, part_no, part_name, qty, test_certificate_id, sort_order) VALUES (?, 'P-01', 'Shell Plate', '2 Nos', ?, 0)`, [docId, certIds[0]]);
  await run(`INSERT INTO qc_document_parts (document_id, part_no, part_name, qty, test_certificate_id, sort_order) VALUES (?, 'P-02', 'End Plate', '2 Nos', ?, 1)`, [docId, certIds[1]]);

  console.log('  seeding Job Cards — done');
  const shellWeldingMilestone = await run("SELECT id FROM milestones WHERE project_id = ? AND milestone_key = 'shell_welding'", [projectId]);
  const paintingMilestone = await run("SELECT id FROM milestones WHERE project_id = ? AND milestone_key = 'painting'", [projectId]);
  await run(
    `INSERT INTO job_cards (project_id, milestone_id, section, qty_planned, qty_done, status, actual_start, actual_end)
     VALUES (?, ?, 'Shell Welding', 1, 1, 'done', ?, ?)`,
    [projectId, shellWeldingMilestone.rows[0].id, isoDaysAgo(40), isoDaysAgo(38)]
  );
  await run(
    `INSERT INTO job_cards (project_id, milestone_id, section, qty_planned, qty_done, status, actual_start, actual_end)
     VALUES (?, ?, 'Painting', 1, 1, 'done', ?, ?)`,
    [projectId, paintingMilestone.rows[0].id, isoDaysAgo(6), isoDaysAgo(5)]
  );

  console.log('  seeding packing list — ready');
  const packNo = `PKL-${await nextCounter('packing_no')}`;
  const packR = await run(
    `INSERT INTO packing_lists (project_id, packing_no, customer_name, customer_address, status, created_by)
     VALUES (?, ?, 'Asian Brown Bleachchem P Ltd', 'Ankleshwar, Gujarat', 'ready', 'seed-script')`,
    [projectId, packNo]
  );
  const packId = Number(packR.lastInsertRowid);
  let s = 0;
  for (const it of bomItems) {
    await run(
      `INSERT INTO packing_items (packing_list_id, s_no, material_description, moc, size_spec, qty, unit)
       VALUES (?, ?, ?, ?, ?, ?, 'No')`,
      [packId, ++s, it.desc, it.moc, it.size, 1]
    );
  }

  await setCustomerLogin('asian_brown', projectId);
  console.log(`  ${projectNo} (Asian Brown Bleachchem) — id ${projectId}, drawings approved, BOM procured, QC + Job Cards + packing ready.`);
  console.log(`  Customer login: asian_brown / asian_brown123`);
}

console.log('\n=== done ===');
console.log('3 projects at 3 distinct stages: Ganga Textiles (Sale Order only, no project) ->');
console.log('Konkan Sugars (Design in progress, live drawing under_review) -> SB-1018 / Asian Brown (near-complete).');
