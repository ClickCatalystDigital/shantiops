// Builds the Acme Boilers demo data (fictional company, customers, suppliers, catalog, five projects).
// Logins/HR rows go straight into the DB; everything with business rules (enquiries, quotations,
// projects, BOM, procurement, receiving, QC, production, dispatch, service, invoices) goes through the
// real API of a running app, so milestones, numbering and stock behave exactly as in real use. A last
// pass backdates the timestamps the API stamps with "now", so finished work reads as finished weeks ago.
//
// Projects (DEMO.md has the walkthrough):
//   AB-1001 Sunrise Dairy      Solid Fuel 600     complete, invoice paid
//   AB-1002 Riverside Textiles Combination 1000   complete, invoice part-paid
//   AB-1003 Bluewave Chemicals Multi Fuel 2000    complete, advance only (70% receivable)
//   AB-1004 Northstar Paper    Oil & Gas 1500     in Procurement (quotes, draft PO, RFQ, part received)
//   AB-1005 Greenfield Foods   Combination 1000   in Production / QC (job cards running, QC fail + NCR)
//
// Run against an EMPTY database that the app has already booted once with CUSTOMER_SEED=acme-seed.json:
//   DB_URL=... DB_TOKEN=... BASE=http://localhost:8790 ADMIN_PASSWORD=... node scripts/demo/seed-acme.mjs
// The nightly reset moves every date forward by (today − demo_meta.seeded_on), so the data stays current.
import { createClient } from '@libsql/client';
import bcrypt from 'bcryptjs';

const { DB_URL, DB_TOKEN, BASE = 'http://localhost:8790', ADMIN_PASSWORD, DEMO_PASSWORD = 'acme-demo' } = process.env;
if (!DB_URL || !ADMIN_PASSWORD) throw new Error('DB_URL and ADMIN_PASSWORD are required');
const db = createClient({ url: DB_URL, authToken: DB_TOKEN || undefined, intMode: 'number' });
const COMPANY = 'Acme Boilers';
const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;

// --- API helper (admin session) ----------------------------------------------------------------
let cookie = '';
async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data)}`);
  return data;
}
async function login() {
  const res = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`admin login failed: ${res.status}`);
  cookie = res.headers.get('set-cookie').split(';')[0];
}
const DAY = 86400000;
const iso = d => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);
const stamp = d => `${iso(d)} ${String(9 + (Math.abs(d) % 8)).padStart(2, '0')}:${String((Math.abs(d) * 7) % 60).padStart(2, '0')}:00`;
const workday = d => { while ([0].includes(new Date(Date.now() + d * DAY).getUTCDay())) d--; return d; }; // Sundays off

// --- 1. Logins + HR (masters, direct) ------------------------------------------------------------
const HEADS = [
  ['manager', 'Priya Nair', 'manager', null],
  ['sales_head', 'Rohan Mehta', 'operator', 'Sales'],
  ['marketing_head', 'Ananya Iyer', 'operator', 'Marketing'],
  ['design_head', 'Vikram Rao', 'operator', 'Design'],
  ['engg_head', 'Sneha Kulkarni', 'operator', 'Engineering'],
  ['procurement_head', 'Arjun Desai', 'operator', 'Procurement'],
  ['stores_head', 'Meera Pillai', 'operator', 'Stores'],
  ['production_head', 'Karan Joshi', 'operator', 'Production'],
  ['qc_head', 'Divya Menon', 'operator', 'QC'],
  ['dispatch_head', 'Sanjay Patil', 'operator', 'Dispatch'],
  ['service_head', 'Neha Gupta', 'operator', 'Installation'],
  ['accounts_head', 'Amit Shah', 'operator', 'Accounts'],
  ['hr_head', 'Kavya Reddy', 'operator', 'HR'],
];
const WORKERS = [['Ramesh Kumar', 'Welder'], ['Suresh Yadav', 'Welder'], ['Mahesh Pawar', 'Fitter'], ['Ganesh More', 'Fitter'],
  ['Dinesh Shinde', 'Gas Cutter'], ['Raju Jadhav', 'Machinist'], ['Prakash Gaikwad', 'Grinder'], ['Santosh Kale', 'Helper']];
async function seedPeople() {
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  let n = 1;
  for (const [username, name, role, dept] of HEADS) {
    // Upsert: migrate() already created sales/marketing/hr/accounts heads with a default password and
    // no safe pass (they would land on the device-setup screen).
    await db.execute({
      sql: `INSERT INTO users (username, password, role, departments, department_roles, display_name, pending, active, safe_pass)
            VALUES (?, ?, ?, ?, ?, ?, 0, 1, 1)
            ON CONFLICT(username) DO UPDATE SET password = excluded.password, role = excluded.role, departments = excluded.departments,
              department_roles = excluded.department_roles, display_name = excluded.display_name, pending = 0, active = 1, safe_pass = 1`,
      args: [username, hash, role, dept, dept ? JSON.stringify({ [dept]: 'head' }) : null, name],
    });
    const [u] = await q('SELECT id FROM users WHERE username = ?', [username]);
    // migrate()'s HR seed gave those four an EMP-1xxx row; one people-master row per login.
    await q("DELETE FROM employees WHERE user_id = ? AND employee_code NOT LIKE 'AB-%'", [u.id]);
    await q(`INSERT OR IGNORE INTO employees (employee_code, name, department, user_id, date_of_joining, email, company)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [`AB-E${String(n++).padStart(3, '0')}`, name, dept || 'Management', u.id, iso(-900 + n * 37), `${username}@acmeboilers.example`, COMPANY]);
  }
  for (const [name, trade] of WORKERS) {
    await q(`INSERT OR IGNORE INTO employees (employee_code, name, employee_type, department, trade, date_of_joining, company)
             VALUES (?, ?, 'worker', 'Production', ?, ?, ?)`,
      [`AB-W${String(n++).padStart(3, '0')}`, name, trade, iso(-700 + n * 21), COMPANY]);
  }
}

// --- 2. Masters through the API -------------------------------------------------------------------
const CUSTOMERS = [
  ['Greenfield Foods Pvt Ltd', 'Nashik', 'Maharashtra', '27'], ['Riverside Textiles Ltd', 'Surat', 'Gujarat', '24'],
  ['Kaveri Pharma Pvt Ltd', 'Mysuru', 'Karnataka', '29'], ['Northstar Paper Mills', 'Indore', 'Madhya Pradesh', '23'],
  ['Sunrise Dairy Cooperative', 'Kolhapur', 'Maharashtra', '27'], ['Bluewave Chemicals Ltd', 'Vadodara', 'Gujarat', '24'],
  ['Harvest Rice Mills', 'Raipur', 'Chhattisgarh', '22'], ['Metro Hospital Trust', 'Bengaluru', 'Karnataka', '29'],
];
const SUPPLIERS = ['Prime Steel Traders', 'National Tube Co', 'Shield Valves Pvt Ltd', 'Precision Gauges', 'Allied Pumps', 'Unity Fasteners'];
// [item_name, uom, bom_category, unit price ₹ per uom]
const ITEMS = [
  ['BQ PLATE 12 MM SA 516 GR 70', 'Kgs', 'plate', 74], ['BQ PLATE 16 MM SA 516 GR 70', 'Kgs', 'plate', 76],
  ['MS PLATE 8 MM IS 2062', 'Kgs', 'plate', 62], ['BOILER TUBE 63.5 OD X 3.25 THK SA 210', 'Mtr', 'pipe', 520],
  ['STAY TUBE 63.5 OD X 6.35 THK SA 210', 'Mtr', 'pipe', 980], ['MS ANGLE 50 X 50 X 6 MM', 'Kgs', 'angle', 62],
  ['MS CHANNEL 100 X 50 MM', 'Kgs', 'channel', 60], ['MS PIPE 50 NB CLASS B', 'Mtr', 'pipe', 410],
  ['SAFETY VALVE 40 NB SPRING LOADED', 'Nos', 'standard', 18500], ['MAIN STEAM STOP VALVE 80 NB', 'Nos', 'standard', 24000],
  ['FEED CHECK VALVE 25 NB', 'Nos', 'standard', 6500], ['BLOW DOWN VALVE 25 NB', 'Nos', 'standard', 7200],
  ['PRESSURE GAUGE 0-21 KG/CM2', 'Nos', 'standard', 1850], ['WATER LEVEL GAUGE', 'Nos', 'standard', 9800],
  ['FEED PUMP 3 HP CENTRIFUGAL', 'Nos', 'standard', 38000], ['GASKET SPIRAL WOUND 80 NB', 'Nos', 'standard', 350],
  ['STUD BOLT M16 X 90', 'Nos', 'standard', 28], ['FIRE BRICK IS 8', 'Nos', 'other', 45],
];
const CAT = Object.fromEntries(ITEMS.map(([n, , c]) => [n, c]));
const PRICE = Object.fromEntries(ITEMS.map(([n, , , p]) => [n, p]));
// [code, name, type, price, series, capacity]. Neutral catalog names (not any real maker's range).
const PRODUCTS = [
  ['AB-SF-600', 'BOILER-SF-600-WB', 'Solid Fuel', 1850000, 'SF', 600], ['AB-CF-1000', 'BOILER-CF-1000-WB', 'Combination Fuel', 2650000, 'CF', 1000],
  ['AB-MF-2000', 'BOILER-MF-2000', 'Multi Fuel', 4200000, 'MF', 2000], ['AB-OF-1500', 'BOILER-OF-1500-17B', 'Oil & Gas', 3100000, 'OF', 1500],
];
const product = code => PRODUCTS.find(p => p[0] === code);

const ids = { customers: {}, suppliers: {}, items: {}, products: {} };
async function seedMasters() {
  for (const [name, city, state, code] of CUSTOMERS) {
    const r = await api('POST', '/api/customers', {
      name, city, state, state_code: code, phone: `98${String(20000000 + name.length * 1234567).slice(0, 8)}`,
      email: `purchase@${name.split(' ')[0].toLowerCase()}.example`, address: `Plot 7, Industrial Estate, ${city}`, account_manager: 'sales_head',
    });
    ids.customers[name] = r.id;
  }
  for (const name of SUPPLIERS) {
    const r = await api('POST', '/api/suppliers', {
      name, contact_person: 'Sales desk', phone: `97${String(30000000 + name.length * 2345671).slice(0, 8)}`,
      email: `sales@${name.split(' ')[0].toLowerCase()}.example`, address: 'Bhosari MIDC, Pune', default_payment_terms: '30 days',
    });
    ids.suppliers[name] = r.id ?? r.supplier?.id;
  }
  for (const [item_name, uom, bom_category] of ITEMS) {
    const r = await api('POST', '/api/item-master', { item_name, uom, bom_category, confirm: true });
    ids.items[item_name] = r.id ?? r.item?.id;
  }
  for (const [code, name, type, price] of PRODUCTS) {
    const r = await api('POST', '/api/sales-products', {
      product_code: code, product_name: name, product_type: type, price, gst_pct: 18, unit: 'Nos', hsn_code: '84021920', warranty_days: 365,
    });
    ids.products[code] = r.id ?? r.product?.id;
  }
}

async function seedStock() {
  // [item, on_hand, reorder_point, location]; the angle stock ends below its reorder point once the five boilers use it. Release-bom reserves
  // from this stock, and those reserved lines are not bought again (procure() skips them).
  const STOCK = [['MS PLATE 8 MM IS 2062', 1200, 500, 'Yard A'], ['MS ANGLE 50 X 50 X 6 MM', 900, 400, 'Rack S1'],
    ['MS CHANNEL 100 X 50 MM', 650, 300, 'Rack S1'], ['MS PIPE 50 NB CLASS B', 90, 40, 'Rack P2'],
    ['GASKET SPIRAL WOUND 80 NB', 40, 20, 'Bin G3'], ['STUD BOLT M16 X 90', 600, 200, 'Bin F1'],
    ['FIRE BRICK IS 8', 2500, 1000, 'Shed 2'], ['PRESSURE GAUGE 0-21 KG/CM2', 6, 4, 'Cabinet I1']];
  for (const [name, on_hand, reorder_point, location] of STOCK) {
    await api('POST', '/api/inventory-items', {
      description: name, item_id: ids.items[name], on_hand, reorder_point, location, avg_cost: PRICE[name], category: CAT[name],
    });
  }
}

// --- 3. Sales: enquiries (every stage), quotations, orders ------------------------------------------
async function newLead(org, code, source, daysAgo, extra = {}) {
  const r = await api('POST', '/api/leads', {
    organization: org, company_name: org, lead_name: 'Purchase Manager', phone: '96' + String(10000000 + org.length * 3456789).slice(0, 8),
    email: `enquiry@${org.split(' ')[0].toLowerCase()}.example`, source, owner_dept: 'Sales', assigned_to: 'sales_head',
    account_manager: 'sales_head', enquiry_date: iso(-daysAgo), address: CUSTOMERS.find(c => c[0] === org)?.[1] || 'Pune',
    products: [{ product_id: ids.products[code], qty: 1 }],
  });
  if (Object.keys(extra).length) await api('PATCH', `/api/leads/${r.id}`, extra);
  return r.id;
}
async function note(lead_id, content, daysAgo, next) {
  await api('POST', '/api/crm-notes', { lead_id, note_type: 'call', content, visit_date: iso(-daysAgo), next_plan_date: next != null ? iso(next) : undefined });
}

// One accepted quotation → sale order (with its items) for a project's customer.
async function sell(customer, code, orderAgo, leadId) {
  const [, name, , price] = product(code);
  const qt = await api('POST', '/api/quotations', {
    customer_id: ids.customers[customer], lead_id: leadId, company: COMPANY, quotation_date: iso(-orderAgo - 12), valid_until: iso(-orderAgo + 18), tax_pct: 18,
    terms: '30% advance with order, 60% before dispatch, 10% after commissioning.',
    items: [
      { product_id: ids.products[code], item_description: `${name} steam boiler, IBR, with mountings`, qty: 1, uom: 'Nos', rate: price, gst_pct: 18 },
      { item_description: 'Erection and commissioning at site', qty: 1, uom: 'Lot', rate: Math.round(price * 0.04), gst_pct: 18, hsn_code: '998719' },
    ],
  });
  await api('PATCH', `/api/quotations/${qt.id}`, { status: 'sent' });
  await api('PATCH', `/api/quotations/${qt.id}`, { status: 'accepted' });
  const so = await api('POST', `/api/quotations/${qt.id}/convert`, { company: COMPANY });
  await api('PATCH', `/api/sale-orders/${so.id}`, { order_date: iso(-orderAgo), expected_delivery_date: iso(-orderAgo + 110) });
  if (leadId) await api('PATCH', `/api/leads/${leadId}`, { sales_call_status: 'Order Received' });
  return { quotation: qt.id, so: so.id };
}

async function seedPipeline() {
  // Open and closed enquiries that never became projects: every funnel stage has something.
  const hot = await newLead('Metro Hospital Trust', 'AB-OF-1500', 'Exhibition', 21, { sales_call_status: 'Hot Offers', next_contact_date: iso(0), expected_value: 3100000 });
  await note(hot, 'Visited the boiler house; they want a 1.5 TPH oil-fired unit before monsoon. Offer sent, call back on price.', 9, 0);
  const qt = await api('POST', '/api/quotations', {
    customer_id: ids.customers['Metro Hospital Trust'], lead_id: hot, company: COMPANY, quotation_date: iso(-9), valid_until: iso(21), tax_pct: 18,
    items: [{ product_id: ids.products['AB-OF-1500'], item_description: 'BOILER-OF-1500-17B steam boiler, IBR', qty: 1, uom: 'Nos', rate: 3100000, gst_pct: 18 }],
  });
  await api('PATCH', `/api/quotations/${qt.id}`, { status: 'sent' });
  const follow = await newLead('Kaveri Pharma Pvt Ltd', 'AB-CF-1000', 'Website', 14, { sales_call_status: 'Follow up stage', next_contact_date: iso(2) });
  await note(follow, 'Asked for a combination-fuel option and payback figures. Sending a comparison next week.', 6, 2);
  const cold = await newLead('Harvest Rice Mills', 'AB-SF-600', 'IndiaMART', 30, { sales_call_status: 'Lead - Hot', next_contact_date: iso(-1) });
  await note(cold, 'Husk-fired unit for the new parboiling line. Budget approval pending; call overdue.', 12, -1);
  const lost = await newLead('Harvest Rice Mills', 'AB-MF-2000', 'Reference', 75, { sales_call_status: 'Order Lost', lost_reason: 'Price: went with a local fabricator' });
  await note(lost, 'Lost on price, about 12% below our offer. Keep in touch for the second line.', 40);
  const dropped = await newLead('Kaveri Pharma Pvt Ltd', 'AB-SF-600', 'IndiaMART', 90, { sales_call_status: 'Lead Project - Dropped', lost_reason: 'Project shelved by the customer' });
  await note(dropped, 'Plant expansion postponed by a year.', 60);

  const camp = await api('POST', '/api/campaigns', { name: 'Dairy and food processing mailer', campaign_type: 'Email', start_date: iso(-45), end_date: iso(15), budget: 40000, owner_dept: 'Marketing', notes: 'Case study of a 600 kg/hr solid-fuel install.' });
  await api('POST', '/api/campaigns', { name: 'Boiler Expo, Pune', campaign_type: 'Event', start_date: iso(-25), end_date: iso(-23), budget: 180000, owner_dept: 'Marketing' });
  await api('POST', '/api/opportunities', { title: 'Second boiler for the new plant', customer_id: ids.customers['Sunrise Dairy Cooperative'], customer_name: 'Sunrise Dairy Cooperative',
    stage: 'Proposals', value_num: 1850000, probability: 60, expected_close: iso(30), next_contact_date: iso(1), source: 'Repeat customer', owner_dept: 'Sales',
    campaign_id: camp.id ?? camp.campaign?.id, notes: 'Happy with AB-1001; wants a matching unit next financial year.' });
}

// --- 4. Projects ---------------------------------------------------------------------------------
// One three-subsystem boiler BOM, quantities scaled by capacity. [name, size, qty per 1000 kg/hr, made in house]
const BOM = {
  'Shell & Body': [['BQ PLATE 12 MM SA 516 GR 70', '2500 X 6000 X 12 THK', 2830, true], ['BQ PLATE 16 MM SA 516 GR 70', '2000 X 6000 X 16 THK', 1510, true],
    ['BOILER TUBE 63.5 OD X 3.25 THK SA 210', '63.5 OD X 3.25 THK', 180, true], ['STAY TUBE 63.5 OD X 6.35 THK SA 210', '63.5 OD X 6.35 THK', 24, true],
    ['MS ANGLE 50 X 50 X 6 MM', 'ISA 50 X 50 X 6', 120, true]],
  'Mountings & Fittings': [['SAFETY VALVE 40 NB SPRING LOADED', '40 NB', 2, false], ['MAIN STEAM STOP VALVE 80 NB', '80 NB', 1, false],
    ['FEED CHECK VALVE 25 NB', '25 NB', 2, false], ['BLOW DOWN VALVE 25 NB', '25 NB', 1, false],
    ['PRESSURE GAUGE 0-21 KG/CM2', '0-21 KG/CM2', 2, false], ['WATER LEVEL GAUGE', 'REFLEX', 2, false]],
  'Feed Line': [['FEED PUMP 3 HP CENTRIFUGAL', '3 HP', 2, false], ['MS PIPE 50 NB CLASS B', '50 NB', 30, false],
    ['GASKET SPIRAL WOUND 80 NB', '80 NB', 6, false], ['STUD BOLT M16 X 90', 'M16 X 90', 48, false]],
};
const UOM = Object.fromEntries(ITEMS.map(([n, u]) => [n, u]));

async function createProject(no, customer, code, orderAgo, leadSource) {
  const [, name, , , series, capacity] = product(code);
  const leadId = await newLead(customer, code, leadSource, orderAgo + 30);
  await note(leadId, 'Requirement confirmed after site visit; technical offer accepted.', orderAgo + 20);
  const { quotation, so } = await sell(customer, code, orderAgo, leadId);
  const p = await api('POST', '/api/projects', {
    project_no: no, customer_name: customer, customer_id: ids.customers[customer], company: COMPANY, sale_order_id: so,
    series, model_capacity: capacity, model_pressure: 10.54, model_design: 'WB', order_date: iso(-orderAgo), description: `${capacity} kg/hr ${name} boiler`,
  });
  // The Executive dashboard's value-in-progress reads projects.order_value (the order's value before GST).
  await q('UPDATE projects SET order_value = (SELECT subtotal FROM sale_orders WHERE id = ?) WHERE id = ?', [so, p.id]);

  // Design: calculation sheet + three drawings, approved by the Design Head. The demo has no file storage,
  // so the drawings carry no file; their status is set directly.
  await api('POST', '/api/calc-sheets', { name: `Pressure parts calculation (${name})`, projectId: p.id });
  for (const dwg of ['General arrangement', 'Shell and furnace', 'Tube layout']) {
    const d = await api('POST', '/api/calc-drawings', { name: dwg, projectId: p.id, assignedTo: 'Vikram Rao', description: `${no} ${dwg.toLowerCase()} drawing` });
    await q("UPDATE calc_drawings SET status = 'approved' WHERE id = ?", [d.id ?? d.drawing?.id]);
  }

  const f = capacity / 1000;
  const lines = [];
  const root = await api('POST', '/api/bom-assemblies', { project_id: p.id, name: 'Boiler', node_type: 'System' });
  for (const [sub, rows] of Object.entries(BOM)) {
    const node = await api('POST', '/api/bom-assemblies', { project_id: p.id, name: sub, node_type: 'Subsystem', parent_id: root.id });
    for (const [item, size, per1000, mfg] of rows) {
      const qty = UOM[item] === 'Nos' ? per1000 : Math.round(per1000 * f);
      const it = await api('POST', '/api/bom-items', {
        project_id: p.id, assembly_id: String(node.id), material_description: item, category: CAT[item],
        size_spec: size, qty_text: `${qty} ${UOM[item]}`, moc: CAT[item] === 'standard' ? null : 'As per IBR', requires_manufacturing: mfg,
      });
      await api('POST', `/api/bom-items/${it.id}/link-item`, { item_id: ids.items[item] }); // catalog link: stock matching, rates, HSN
      lines.push({ id: it.id, name: item, qty, mfg });
    }
  }
  return { no, id: p.id, so, quotation, lead: leadId, orderAgo, customer, series, capacity, lines };
}

const supplierFor = name => /PLATE|ANGLE|CHANNEL/.test(name) ? 'Prime Steel Traders' : /TUBE|PIPE/.test(name) ? 'National Tube Co'
  : /VALVE/.test(name) ? 'Shield Valves Pvt Ltd' : /GAUGE/.test(name) ? 'Precision Gauges' : /PUMP/.test(name) ? 'Allied Pumps' : 'Unity Fasteners';
const altFor = main => main === 'Prime Steel Traders' ? 'Unity Fasteners' : 'Prime Steel Traders';

// Release the BOM, then quote every line stores can't cover. stage(line, i) says how far each line goes:
// 'comparison' (two quotes), 'draft' (supplier picked, PO not issued), 'ordered' (PO issued), 'transit', 'enquiry' (left for an RFQ).
async function procure(project, stage = () => 'ordered') {
  await api('POST', `/api/projects/${project.id}/release-bom`, {});
  const covered = new Set((await q(
    `SELECT id FROM bom_items WHERE project_id = ? AND (purchase_status = 'In-Stock'
       OR id IN (SELECT bom_item_id FROM inventory_reservations WHERE bom_item_id IS NOT NULL))`, [project.id])).map(r => r.id));
  project.buy = project.lines.filter(l => !covered.has(l.id));
  project.stock = project.lines.filter(l => covered.has(l.id));
  const pos = new Set();
  for (const [i, line] of project.buy.entries()) {
    line.stage = stage(line, i);
    if (line.stage === 'enquiry') continue;
    const main = supplierFor(line.name);
    const base = PRICE[line.name];
    const q1 = await api('POST', '/api/supplier-quotes', { supplier_id: ids.suppliers[main], items: [{ bom_item_id: line.id, unit_price: base }], expected_delivery_date: iso(-project.orderAgo + 30), payment_terms: '30 days' });
    await api('POST', '/api/supplier-quotes', { supplier_id: ids.suppliers[altFor(main)], items: [{ bom_item_id: line.id, unit_price: Math.round(base * 1.08) }], expected_delivery_date: iso(-project.orderAgo + 38), payment_terms: 'Advance 50%' });
    if (line.stage === 'comparison') continue;
    const sel = await api('POST', `/api/bom-items/${line.id}/select-supplier`, { quote_id: (q1.ids || q1.quote_ids || [q1.id])[0] });
    line.po = sel.po_id;
    if (line.stage !== 'draft' && sel.po_id) pos.add(sel.po_id);
  }
  for (const po of pos) await api('PATCH', `/api/purchase-orders/${po}`, { action: 'issue' });
  for (const line of project.buy.filter(l => l.stage === 'transit')) await api('PATCH', `/api/bom-items/${line.id}`, { purchase_status: 'Transit' });
  return [...pos];
}

// Gate entry, GRN per line, then (unless left pending) the Stores inward approval and routing.
async function receive(project, lines, { approve = true } = {}) {
  const bySupplier = Object.groupBy(lines, l => supplierFor(l.name));
  let n = 1;
  for (const [supplier, group] of Object.entries(bySupplier)) {
    await api('POST', '/api/gate-inward-receipts', { supplier_name: supplier, vehicle_no: `MH12 ${String.fromCharCode(65 + n)}${n} ${4100 + project.id * 10 + n}`,
      driver_name: 'Driver', material_ref: `${project.no} ${group.length} item(s)`, security_docs_ok: 1, security_seal_ok: 1 });
    for (const line of group) {
      await api('POST', `/api/bom-items/${line.id}/receive`, {
        qty_text: String(line.qty),
        receipt: { supplier_id: ids.suppliers[supplier], grn_ref: `GRN-${project.no}-${n}`, invoice_no: `${supplier.split(' ')[0].toUpperCase()}/${project.id}${String(n).padStart(3, '0')}` },
        received_heat_no: CAT[line.name] === 'plate' ? `H${project.id}${line.id}A` : undefined,
        received_mtc_no: CAT[line.name] === 'plate' ? `MTC-${project.id}${line.id}` : undefined,
      });
    }
    n++;
  }
  if (!approve) return;
  const ids_ = lines.map(l => l.id);
  const pending = await q(`SELECT id FROM inward_approvals WHERE status = 'pending' AND bom_item_id IN (${ids_.map(() => '?').join(',')})`, ids_);
  for (const r of pending) await api('POST', `/api/inward-approvals/${r.id}/decide`, { decision: 'approved' });
  for (const line of lines) await api('POST', `/api/bom-items/${line.id}/route-self`, { routed_to: line.mfg ? 'production' : 'dispatch' });
}

// Incoming inspection records the receive step created: pass all (or fail one, see AB-1005).
async function incomingQc(project, result = () => 'pass') {
  const recs = await q(`SELECT r.id, r.bom_item_id FROM qc_records r WHERE r.project_id = ? AND r.result = 'pending'`, [project.id]);
  for (const r of recs) {
    const res = result(r);
    if (res !== 'pending') await api('PATCH', `/api/qc-records/${r.id}`, { result: res });
  }
  return recs;
}

async function milestoneId(project, key) {
  return (await q('SELECT id FROM milestones WHERE project_id = ? AND milestone_key = ?', [project.id, key]))[0].id;
}

// Material issue + job cards for the made-in-house lines. done: how many of the cards to finish.
const JOBS = [['marking_cutting', 'BQ PLATE 12 MM'], ['drilling', 'BQ PLATE 16 MM'], ['shell_welding', 'BQ PLATE 12 MM'],
  ['tube_stay_welding', 'BOILER TUBE'], ['box_up', 'STAY TUBE'], ['smoke_box', 'MS ANGLE']];
async function produce(project, { done = JOBS.length, running = 0 } = {}) {
  const made = project.lines.filter(l => l.mfg);
  for (const line of made) {
    await api('POST', '/api/material-issues', { project_id: project.id, bom_item_id: line.id, qty: line.qty, notes: 'Issued to shop floor' });
  }
  const cards = [];
  for (const [i, [key, match]] of JOBS.entries()) {
    const line = made.find(l => l.name.startsWith(match));
    const jc = await api('POST', '/api/job-cards', {
      milestone_id: await milestoneId(project, key), bom_item_id: line.id, qty_planned: 1,
      planned_start: iso(-project.orderAgo + 40 + i * 6), planned_end: iso(-project.orderAgo + 44 + i * 6), notes: `${project.no} ${key.replace(/_/g, ' ')}`,
    });
    cards.push(jc.id);
    if (i < done + running) await api('PATCH', `/api/job-cards/${jc.id}`, { status: 'progress' });
    if (i < done) await api('PATCH', `/api/job-cards/${jc.id}`, { status: 'done', qty_done: 1, qty_rejected: 0 });
  }
  return cards;
}

// Shop floor hands the finished subsystems to Dispatch (sets production_done on the made lines).
async function handOver(project) {
  await api('POST', '/api/production/handovers', { items: project.lines.filter(l => l.mfg).map(l => ({ bom_item_id: l.id, qty: l.qty })), note: 'Shell, tubes and body complete', approve: true });
}

// Hydro test, test certificates for the plates/tubes, and the statutory folder with every part linked.
async function qcDocs(project) {
  const htDate = iso(-project.orderAgo + 82);
  await api('POST', '/api/qc-records', { project_id: project.id, test_type: 'Hydro Test', result: 'pass', tested_on: htDate, inspector: 'Divya Menon', reference_no: `HT-${project.no}`, notes: 'Tested at 1.5 × design pressure, held 30 min, no leaks.' });
  const certs = [];
  for (const line of project.lines.filter(l => ['plate', 'pipe'].includes(CAT[l.name]) && l.mfg)) {
    const plate = CAT[line.name] === 'plate';
    const c = await api('POST', '/api/test-certificates', {
      certificate_no: `TC/${project.id}${line.id}`, cast_no: `C${project.id}${line.id}7`, heat_no: `H${project.id}${line.id}A`, plate_no: plate ? `P${line.id}` : undefined,
      material_spec: plate ? 'SA 516 GR 70' : 'SA 210 GR A1', steel_maker: plate ? 'Deccan Steel Works' : 'Western Tube Mills',
      size_t: plate ? line.name.match(/(\d+) MM/)[1] : '3.25', chem_c: '0.21', chem_mn: '1.05', chem_p: '0.018', chem_s: '0.012', chem_si: '0.28',
      ys: '290', uts: '510', elongation: '24', bend_test: 'Satisfactory', certificate_date: iso(-project.orderAgo + 20), inspecting_authority: 'Third-party inspector',
      project_ids: [project.id],
    });
    certs.push(c.id);
  }
  const cap = project.capacity;
  const doc = await api('POST', '/api/qc-documents', {
    project_id: project.id, company: COMPANY, ibr_version: '2026', doc_id: `ABH-${project.no}`, makers_no: project.no, year_of_make: Number(iso(0).slice(0, 4)),
    design_pressure: 10.54, hydro_test_pressure: 15.8, hydro_test_date: htDate, working_pressure: 10.54, boiler_type: 'Wet back, three pass, smoke tube',
    length_overall: String(Math.round(3800 + cap)), internal_diameter: String(Math.round(1400 + cap / 3)), heating_surface: Math.round(cap / 30), evaporation_capacity: cap, steam_temp: 185,
  });
  const parts = (await q('SELECT id FROM qc_document_parts WHERE document_id = ?', [doc.id])).map(r => r.id);
  if (parts.length && certs.length) await api('POST', `/api/qc-documents/${doc.id}/link-parts`, { part_ids: parts, test_certificate_id: certs[0] });
  // Form III A (2026 Form IV(Part-B)): the feed pipeline group, holding the boiler tube part.
  const g = await api('POST', `/api/qc-documents/${doc.id}/iiia-groups`, { name: 'Feed pipeline' });
  const [tubePart] = await q("SELECT id FROM qc_document_parts WHERE document_id = ? AND part_name LIKE '%TUBE%' ORDER BY id LIMIT 1", [doc.id]);
  if (tubePart) await api('POST', `/api/qc-documents/${doc.id}/iiia-groups/${g.id ?? g.group?.id}/parts`, { part_id: tubePart.id });
  // Bought-out items (valves, gauges): pulled from the BOM and covered by the makers' certificate.
  await api('POST', `/api/qc-documents/${doc.id}/sync-mountings`, {});
  const mountings = (await q('SELECT id FROM qc_mountings WHERE document_id = ?', [doc.id])).map(r => r.id);
  if (mountings.length) {
    const mc = await api('POST', '/api/test-certificates', { certificate_no: `VC/${project.id}`, cast_no: `V${project.id}`, material_spec: 'IS 1538 / IBR Form III-C', steel_maker: 'Shield Valves Pvt Ltd', certificate_date: iso(-project.orderAgo + 30), project_ids: [project.id] });
    await api('POST', `/api/qc-documents/${doc.id}/link-mountings`, { mounting_ids: mountings, test_certificate_id: mc.id });
  }
  await api('PATCH', `/api/qc-documents/${doc.id}`, { customer_visible: 1 });
  return doc.id;
}

// Packing list(s) → packed → pre-dispatch approval (QC + Production) → dispatched. split: the bought-out
// items go on a second list and both travel as one shipment (a shipment needs two or more lists).
async function dispatch(project, { split = false } = {}) {
  // The handover already opened a draft list with the made lines; this adds the bought-out ones.
  await api('POST', '/api/packing/from-bom', { project_id: project.id, company: COMPANY, mode: split ? 'new' : undefined })
    .catch(e => { if (!/already on an existing/.test(e.message)) throw e; });
  const lists = (await q("SELECT id FROM packing_lists WHERE project_id = ? AND status = 'draft' ORDER BY id", [project.id])).map(r => r.id);
  for (const id of lists) {
    await api('PATCH', `/api/packing/${id}`, { status: 'packed', transport_mode: 'road' });
    await api('POST', `/api/packing/${id}/submit-for-approval`, {});
    // Production's sign-off usually came with the handover; QC signs here.
    const [a] = await q('SELECT id, qc_decision, production_decision FROM pre_dispatch_approvals WHERE packing_list_id = ? ORDER BY id DESC LIMIT 1', [id]);
    for (const role of ['qc', 'production']) if (!a[`${role}_decision`]) await api('POST', `/api/pre-dispatch-approvals/${a.id}/decide`, { decision: 'approved', role });
  }
  if (lists.length > 1) await api('POST', '/api/shipments', { list_ids: lists, vehicle_no: `MH14 GT ${2200 + project.id}`, dispatch_through: 'Sahyadri Roadways', note: 'Trailer, boiler on saddles' });
  for (const id of lists) await api('PATCH', `/api/packing/${id}`, { status: 'dispatched' });
  for (const id of lists) await api('POST', `/api/packing/${id}/acknowledge`, { status: 'accepted', notes: 'Received at site in good condition' });
  return lists;
}

// Site installation, commissioning report (finalised), and one later service call.
async function service(project) {
  const at = -project.orderAgo + 100;
  await api('PATCH', '/api/installation-visits/plan', { project_id: project.id, planned_visits: 2 });
  await api('POST', '/api/installation-visits', { project_id: project.id, visit_date: iso(at), visit_time: '10:00', visited_by: 'service_head', status: 'done', description: 'Erection supervision and alignment check' });
  await api('POST', '/api/installation-visits', { project_id: project.id, visit_date: iso(at + 5), visit_time: '10:00', visited_by: 'service_head', status: 'done', description: 'Commissioning and handover' });
  const ok = rows => rows.map(([label, spec]) => ({ label, spec, observed: 'OK', status: 'OK' }));
  const r = await api('POST', '/api/installation-reports', {
    project_id: project.id, call_type: 'Commissioning', report_date: iso(at + 5),
    data: {
      fields: {
        customer_name: project.customer, site_address: CUSTOMERS.find(c => c[0] === project.customer)[1], contact_person: 'Plant Engineer', contact_no: '9810000000',
        equipment_type: 'Steam boiler', model: `${project.series}-${project.capacity}`, capacity: `${project.capacity} kg/hr`, year_of_make: iso(0).slice(0, 4),
        serial_no: project.no, fuel_type: project.series === 'OF' ? 'Furnace oil' : 'Coal / briquettes', design_pressure: '10.54', working_pressure: '10.54',
        commissioning_date: iso(at + 5), inspector: 'Neha Gupta', customer_remarks: 'Boiler commissioned and running at rated output. Operators trained.',
      },
      tables: { erection: ok([['Foundation level & alignment (mm)', 'As per GA drawing'], ['Safety valve installation & testing', 'Calibrated'], ['Water level gauges installed & functional', '2 No. min']]) },
    },
  });
  await api('PATCH', `/api/installation-reports/${r.id}`, { action: 'finalize' });
  const call = await api('POST', '/api/service-calls', { project_id: project.id, customer_name: project.customer, contact_person: 'Plant Engineer', contact_phone: '9810000000',
    subject: 'Feed pump noisy at start-up', description: 'Pump makes a grinding noise for the first minute after start.', priority: 'medium', sla_hours: 48 });
  await api('POST', `/api/service-calls/${call.id}/visits`, { visit_date: iso(at + 40), technician: 'Neha Gupta', notes: 'Coupling realigned, bearing greased. Running quietly.' });
}

// Invoice from the accepted quotation, issued, then paid in full or in part. The same money is logged
// twice, as in real use: Accounts' receipts against the invoice, Sales' payment tracker against the order
// (30% advance a few days after the order, the rest after the invoice).
async function invoice(project, paid) {
  const inv = await api('POST', `/api/quotations/${project.quotation}/convert-to-invoice`, { company: COMPANY, invoice_date: iso(-project.orderAgo + 90), due_date: iso(-project.orderAgo + 120) });
  await api('PATCH', `/api/sales-invoices/${inv.id}`, { status: 'issued' });
  const [{ total }] = await q('SELECT total FROM sales_invoices WHERE id = ?', [inv.id]);
  const advance = Math.round(total * 0.3), rest = Math.round(total * paid) - advance;
  await api('POST', `/api/sales-invoices/${inv.id}/receipts`, { amount: advance, payment_mode: 'NEFT', receipt_date: iso(-project.orderAgo + 97), reference: `UTR${project.id}01` });
  if (rest > 0) await api('POST', `/api/sales-invoices/${inv.id}/receipts`, { amount: rest, payment_mode: 'RTGS', receipt_date: iso(-project.orderAgo + 125), reference: `UTR${project.id}02` });
  await orderPayment(project, advance, -project.orderAgo + 5, 'Advance with order');
  if (rest > 0) await orderPayment(project, rest, -project.orderAgo + 125, 'Balance against invoice', inv.id);
  return inv.id;
}
async function orderPayment(project, amount, day, remark, sales_invoice_id) {
  await api('POST', '/api/sale-order-payments', { sale_order_id: project.so, sales_invoice_id, amount, received_on: iso(day), mode: 'NEFT', remark });
}

// Milestone dates from the order date (four days each), statuses from where the project really is.
// upTo: the milestone in progress (null = all done).
async function setMilestones(project, upTo = null) {
  const ms = await q('SELECT id, milestone_key FROM milestones WHERE project_id = ? ORDER BY sort_order', [project.id]);
  const cur = upTo ? ms.findIndex(m => m.milestone_key === upTo) : ms.length;
  for (const [i, m] of ms.entries()) {
    const ps = -project.orderAgo + 2 + i * 4, pe = ps + 3;
    const status = i < cur ? 'done' : i === cur ? 'in_progress' : 'pending';
    await q(`UPDATE milestones SET planned_start = ?, planned_end = ?, status = ?, actual_start = ?, actual_end = ?, assignee = CASE WHEN department = 'Installation' THEN 'service_head' ELSE assignee END
             WHERE id = ?`, [iso(ps), iso(pe), status, status === 'pending' ? null : iso(ps), status === 'done' ? iso(pe) : null, m.id]);
  }
}

// The API stamps "now" on what it creates; move a finished project's records back to when they happened.
async function backdate(project) {
  const at = d => stamp(-project.orderAgo + d);
  const P = [project.id];
  const plan = [
    ['bom_items', 'created_at', 'project_id = ?', 6], ['purchase_orders', 'created_at', 'id IN (SELECT po_id FROM po_items WHERE bom_item_id IN (SELECT id FROM bom_items WHERE project_id = ?))', 18],
    ['qc_records', 'created_at', 'project_id = ?', 40], ['material_issues', 'created_at', 'project_id = ?', 42],
    ['job_cards', 'created_at', 'project_id = ?', 42], ['job_cards', 'actual_start', 'project_id = ? AND actual_start IS NOT NULL', 44],
    ['job_cards', 'actual_end', 'project_id = ? AND actual_end IS NOT NULL', 76], ['production_handovers', 'handed_at', 'bom_item_id IN (SELECT id FROM bom_items WHERE project_id = ?)', 80],
    ['packing_lists', 'created_at', 'project_id = ?', 86], ['packing_lists', 'dispatched_at', 'project_id = ? AND dispatched_at IS NOT NULL', 92],
    ['pre_dispatch_approvals', 'created_at', 'project_id = ?', 88], ['shipments', 'created_at', 'id IN (SELECT shipment_id FROM packing_lists WHERE project_id = ?)', 91],
    ['qc_documents', 'created_at', 'project_id = ?', 84], ['installation_reports', 'created_at', 'project_id = ?', 105],
    ['installation_reports', 'finalized_at', 'project_id = ? AND finalized_at IS NOT NULL', 105], ['service_calls', 'created_at', 'project_id = ?', 138],
    ['projects', 'created_at', 'id = ?', 1], ['sale_orders', 'created_at', 'id = (SELECT sale_order_id FROM projects WHERE id = ?)', 0],
  ];
  for (const [t, c, where, d] of plan) {
    const cols = (await q(`PRAGMA table_info(${t})`)).map(r => r.name);
    if (cols.includes(c)) await q(`UPDATE ${t} SET ${c} = ? WHERE ${where}`, [at(d), ...P]);
  }
  // Stock receipts and inward approvals: when the material arrived (received_at etc. vary by table).
  for (const [t, c] of [['stock_receipts', 'created_at'], ['inward_approvals', 'created_at'], ['inward_approvals', 'decided_at'], ['bom_item_receipts', 'created_at']]) {
    const cols = (await q(`PRAGMA table_info(${t})`)).map(r => r.name);
    if (cols.includes(c) && cols.includes('bom_item_id')) await q(`UPDATE ${t} SET ${c} = ? WHERE bom_item_id IN (SELECT id FROM bom_items WHERE project_id = ?) AND ${c} IS NOT NULL`, [at(32), ...P]);
  }
}

// --- 5. Everyday work: tasks per department, attendance, indents ---------------------------------
async function seedTasks(projects) {
  const T = [
    ['Sales', 'Marketing', 'Call Metro Hospital Trust on the oil-fired offer', 0], ['Marketing', 'Sales', 'Send the Boiler Expo lead list to Sales', 1],
    ['Design', 'Engineering', `Revise tube layout for ${projects[4].no}`, 0], ['Engineering', 'Design', `Check BOM weights for ${projects[3].no}`, 1],
    ['Procurement', 'Engineering', `Chase the safety valve quote for ${projects[3].no}`, 0], ['Stores', 'Procurement', `Inward inspection for ${projects[3].no} plates`, 0],
    ['Production', 'QC', `Rework the rejected stay tube lot on ${projects[4].no}`, 0], ['QC', 'Production', `Witness hydro test for ${projects[4].no}`, 2],
    ['Dispatch', 'Sales', `Book a trailer for ${projects[4].no}`, 5], ['Installation', 'Sales', `Plan the 3-month service visit at ${projects[0].customer}`, 1],
    ['Accounts', 'Sales', `Follow up the balance payment from ${projects[1].customer}`, 0], ['HR', 'Production', 'Two welder interviews this week', 2],
  ];
  for (const [department, from, title, due] of T) {
    const proj = projects.find(p => title.includes(p.no) || title.includes(p.customer));
    await api('POST', '/api/production/tasks', { department, from_department: from, title, due_date: iso(due), project_id: proj?.id, assigned_to: HEADS.find(h => h[3] === department)?.[0] });
  }
}

async function seedAttendance() {
  const workers = await q("SELECT id FROM employees WHERE employee_type = 'worker' ORDER BY id");
  const staff = await q("SELECT id FROM employees WHERE employee_code LIKE 'AB-E%' ORDER BY id");
  const ms = await q("SELECT m.id, m.project_id FROM milestones m JOIN projects p ON p.id = m.project_id WHERE p.project_no = 'AB-1005' AND m.status = 'in_progress' LIMIT 1");
  const days = [...new Set([0, -1, -2, -3, -4, -5, -6].map(workday))];
  for (const d of days) {
    for (const [i, w] of workers.entries()) {
      const status = (i + d) % 9 === 0 ? 'absent' : 'present';
      await api('POST', '/api/production/worker-days', { employee_id: w.id, date: iso(d), status, project_id: ms[0]?.project_id, milestone_id: status === 'present' ? ms[0]?.id : undefined,
        work_allocated: status === 'present' ? ['Shell welding', 'Tube expansion', 'Fit-up', 'Grinding'][i % 4] : undefined });
    }
    for (const s of staff) await api('POST', '/api/attendance', { employee_id: s.id, date: iso(d), status: 'present', in_time: '09:15', out_time: '18:10' });
  }
}

// Leave balances and requests (HR), supplier bills against the finished orders' POs (Accounts payables).
async function seedHrAndPayables(done) {
  const types = await q("SELECT id, name FROM leave_types WHERE name NOT LIKE 'Unpaid%' ORDER BY id");
  const staff = await q("SELECT id FROM employees WHERE employee_code LIKE 'AB-E%' ORDER BY id");
  for (const s of staff) for (const t of types) await api('POST', '/api/leave-allocations', { employee_id: s.id, leave_type_id: t.id, year: Number(iso(0).slice(0, 4)), allocated: /earned/i.test(t.name) ? 15 : 12 });
  const past = await api('POST', '/api/leave-requests', { employee_id: staff[5].id, leave_type_id: types[0].id, from_date: iso(workday(-12)), to_date: iso(workday(-12)), reason: 'Family function' });
  await api('PATCH', `/api/leave-requests/${past.id}`, { status: 'approved' });
  await api('POST', '/api/leave-requests', { employee_id: staff[8].id, leave_type_id: types[0].id, from_date: iso(6), to_date: iso(7), reason: 'Travelling home' }); // waits for HR
  for (const p of done) {
    const pos = await q('SELECT DISTINCT po_id FROM po_items WHERE project_id = ?', [p.id]);
    for (const [i, { po_id }] of pos.entries()) {
      await api('POST', `/api/purchase-orders/${po_id}/record-bill`, { bill_no: `SB/${p.id}${String(i + 1).padStart(3, '0')}`, bill_date: iso(-p.orderAgo + 33), due_date: iso(-p.orderAgo + 63), gst_rate_pct: 18, company: COMPANY });
    }
  }
}

// --- main ----------------------------------------------------------------------------------------
await login();
await seedPeople();
await seedMasters();
await seedStock();
await seedPipeline();

const p1 = await createProject('AB-1001', 'Sunrise Dairy Cooperative', 'AB-SF-600', 150, 'IndiaMART');
const p2 = await createProject('AB-1002', 'Riverside Textiles Ltd', 'AB-CF-1000', 135, 'Website');
const p3 = await createProject('AB-1003', 'Bluewave Chemicals Ltd', 'AB-MF-2000', 120, 'Reference');
const p4 = await createProject('AB-1004', 'Northstar Paper Mills', 'AB-OF-1500', 26, 'Exhibition');
const p5 = await createProject('AB-1005', 'Greenfield Foods Pvt Ltd', 'AB-CF-1000', 49, 'Website');

// Three complete orders, end to end.
for (const [p, paid] of [[p1, 1], [p2, 0.6], [p3, 0.3]]) {
  await procure(p);
  await receive(p, p.buy);
  for (const l of p.stock) await api('POST', `/api/bom-items/${l.id}/route-self`, { routed_to: l.mfg ? 'production' : 'dispatch' }).catch(() => {});
  await incomingQc(p);
  await produce(p);
  await handOver(p);
  await qcDocs(p);
  await dispatch(p, { split: p === p3 });
  await service(p);
  await invoice(p, paid);
  await setMilestones(p);
  await backdate(p);
}

// AB-1005: in Production / QC. Two cards done, one running; a stay-tube lot failed incoming QC (NCR raised);
// two inspections still pending; a material indent for the next stage.
await procure(p5);
await receive(p5, p5.buy);
const recs5 = await q(`SELECT r.id, r.bom_item_id FROM qc_records r WHERE r.project_id = ? AND r.result = 'pending' ORDER BY r.id`, [p5.id]);
const stay = p5.lines.find(l => l.name.startsWith('STAY TUBE'));
const pendingRecs = new Set(recs5.slice(-2).map(r => r.id));
await incomingQc(p5, r => r.bom_item_id === stay.id ? 'fail' : pendingRecs.has(r.id) ? 'pending' : 'pass');
const failed = recs5.find(r => r.bom_item_id === stay.id);
if (failed) await api('POST', '/api/ncrs', { project_id: p5.id, bom_item_id: stay.id, qc_record_id: failed.id, severity: 'major', description: 'Stay tube lot: wall thickness 5.9 mm against 6.35 mm specified on 4 of 12 lengths. Return to supplier.' });
await produce(p5, { done: 2, running: 1 });
const plate8 = p5.lines.find(l => l.name.startsWith('BQ PLATE 16'));
await api('POST', '/api/material-indents', { project_id: p5.id, items: [{ bom_item_id: plate8.id, qty_requested: 420 }], notes: 'Furnace and tube plates for box-up' }).catch(e => console.warn('indent:', e.message));
await setMilestones(p5, 'shell_welding');
// AB-1004: in Procurement (after AB-1005: a supplier's open draft PO is shared across projects, so AB-1005's
// orders would otherwise pick up and issue AB-1004's draft). Lines spread over every buying stage; two received lines wait for Stores' inward approval.
// By item, so each supplier's PO has one state: plates received (awaiting inward approval), tubes in transit,
// the safety valve on a draft PO, other valves and the pump at quote comparison, two lines left for the RFQ.
const P4_STAGE = { 'BQ PLATE 12': 'received', 'BQ PLATE 16': 'received', 'MS ANGLE': 'received', 'BOILER TUBE': 'transit', 'STAY TUBE': 'transit',
  'MS PIPE': 'transit', 'SAFETY VALVE': 'draft', 'MAIN STEAM': 'comparison', 'FEED CHECK': 'comparison', 'FEED PUMP': 'comparison',
  'BLOW DOWN': 'enquiry', 'PRESSURE GAUGE': 'enquiry' };
await procure(p4, l => Object.entries(P4_STAGE).find(([k]) => l.name.startsWith(k))?.[1] || 'ordered');
await receive(p4, p4.buy.filter(l => l.stage === 'received'), { approve: false });
const rfqLines = p4.buy.filter(l => l.stage === 'enquiry').map(l => l.id);
if (rfqLines.length) await api('POST', '/api/rfqs', { bom_item_ids: rfqLines, supplier_ids: [ids.suppliers['Shield Valves Pvt Ltd'], ids.suppliers['Unity Fasteners']], company: COMPANY });
await setMilestones(p4, 'procurement_ordered');

for (const p of [p4, p5]) {
  await q('UPDATE projects SET created_at = ? WHERE id = ?', [stamp(-p.orderAgo + 1), p.id]);
  await q('UPDATE sale_orders SET created_at = ? WHERE id = ?', [stamp(-p.orderAgo), p.so]);
}

const projects = [p1, p2, p3, p4, p5];
// Open orders: the 30% advance is in; the PM login owns every project.
for (const p of [p4, p5]) {
  const [{ total }] = await q('SELECT total FROM sale_orders WHERE id = ?', [p.so]);
  await orderPayment(p, Math.round(total * 0.3), -p.orderAgo + 5, 'Advance with order');
}
await q("UPDATE projects SET owner = 'manager' WHERE project_no LIKE 'AB-%'");
await seedTasks(projects);
await seedAttendance();
await seedHrAndPayables([p1, p2, p3]);

// The nightly reset shifts every date by (today − seeded_on): workers/demo-reset-cron.
await db.batch(['CREATE TABLE IF NOT EXISTS demo_meta (seeded_on TEXT NOT NULL)', 'DELETE FROM demo_meta', { sql: 'INSERT INTO demo_meta VALUES (?)', args: [iso(0)] }], 'write');

// Row counts: every table the walkthrough relies on must have rows.
const MUST = ['users', 'employees', 'customers', 'suppliers', 'leads', 'crm_notes', 'campaigns', 'opportunities', 'quotations', 'quotation_items',
  'sale_orders', 'sale_order_items', 'projects', 'scope_of_supply_items', 'milestones', 'calc_sheets', 'calc_drawings', 'bom_items', 'supplier_quotes',
  'purchase_orders', 'rfqs', 'gate_inward_receipts', 'stock_receipts', 'inward_approvals', 'material_issues', 'material_indents', 'qc_records', 'ncr_records',
  'job_cards', 'production_handovers', 'test_certificates', 'qc_documents', 'qc_document_parts', 'packing_lists', 'pre_dispatch_approvals', 'shipments',
  'installation_visits', 'installation_reports', 'service_calls', 'sales_invoices', 'customer_receipts', 'sale_order_payments', 'tasks', 'attendance_days', 'leave_requests', 'vendor_bills', 'journal_entries'];
const counts = {};
for (const t of MUST) counts[t] = (await q(`SELECT COUNT(*) n FROM ${t}`))[0].n;
console.table(counts);
const empty = MUST.filter(t => !counts[t]);
if (empty.length) { console.error('EMPTY:', empty.join(', ')); process.exit(1); }
console.log('Acme demo data seeded:', projects.map(p => `${p.no}=${p.id}`).join(' '));
