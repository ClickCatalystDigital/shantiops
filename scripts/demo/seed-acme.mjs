// Builds the Acme Boilers demo data (fictional company, customers, suppliers, catalog, projects).
// Logins/HR rows go straight into the DB; everything with business rules (enquiries, quotations,
// projects, BOM, procurement, receiving, dispatch) goes through the real API of a running app, so
// milestones, numbering and stock behave exactly as in real use.
//
// Run against an EMPTY database that the app has already booted once with CUSTOMER_SEED=acme-seed.json:
//   DB_URL=... DB_TOKEN=... BASE=http://localhost:8790 ADMIN_PASSWORD=... node scripts/demo/seed-acme.mjs
import { createClient } from '@libsql/client';
import bcrypt from 'bcryptjs';

const { DB_URL, DB_TOKEN, BASE = 'http://localhost:8790', ADMIN_PASSWORD, DEMO_PASSWORD = 'acme-demo' } = process.env;
if (!DB_URL || !ADMIN_PASSWORD) throw new Error('DB_URL and ADMIN_PASSWORD are required');
const db = createClient({ url: DB_URL, authToken: DB_TOKEN || undefined, intMode: 'number' });
const COMPANY = 'Acme Boilers';

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
const iso = d => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

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
async function seedPeople() {
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  let n = 1;
  for (const [username, name, role, dept] of HEADS) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO users (username, password, role, departments, department_roles, display_name, pending, active, safe_pass)
            VALUES (?, ?, ?, ?, ?, ?, 0, 1, 1)`,
      args: [username, hash, role, dept, dept ? JSON.stringify({ [dept]: 'head' }) : null, name],
    });
    const u = (await db.execute({ sql: 'SELECT id FROM users WHERE username = ?', args: [username] })).rows[0];
    await db.execute({
      sql: `INSERT OR IGNORE INTO employees (employee_code, name, department, user_id, date_of_joining, email, company)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [`AB-E${String(n++).padStart(3, '0')}`, name, dept || 'Management', u.id, iso(-900 + n * 37), `${username}@acmeboilers.example`, COMPANY],
    });
  }
  const WORKERS = [['Ramesh Kumar', 'Welder'], ['Suresh Yadav', 'Welder'], ['Mahesh Pawar', 'Fitter'], ['Ganesh More', 'Fitter'],
    ['Dinesh Shinde', 'Gas Cutter'], ['Raju Jadhav', 'Machinist'], ['Prakash Gaikwad', 'Grinder'], ['Santosh Kale', 'Helper']];
  for (const [name, trade] of WORKERS) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO employees (employee_code, name, employee_type, department, trade, date_of_joining, company)
            VALUES (?, ?, 'worker', 'Production', ?, ?, ?)`,
      args: [`AB-W${String(n++).padStart(3, '0')}`, name, trade, iso(-700 + n * 21), COMPANY],
    });
  }
}

// --- 2. Masters through the API -------------------------------------------------------------------
const CUSTOMERS = [
  ['Greenfield Foods Pvt Ltd', 'Nashik', 'Maharashtra', '27'], ['Riverside Textiles Ltd', 'Surat', 'Gujarat', '24'],
  ['Kaveri Pharma Pvt Ltd', 'Hyderabad', 'Telangana', '36'], ['Northstar Paper Mills', 'Indore', 'Madhya Pradesh', '23'],
  ['Sunrise Dairy Cooperative', 'Kolhapur', 'Maharashtra', '27'], ['Bluewave Chemicals Ltd', 'Vadodara', 'Gujarat', '24'],
  ['Harvest Rice Mills', 'Raipur', 'Chhattisgarh', '22'], ['Metro Hospital Trust', 'Bengaluru', 'Karnataka', '29'],
];
const SUPPLIERS = [
  ['Prime Steel Traders', 'Plates and sections'], ['National Tube Co', 'Boiler tubes'], ['Shield Valves Pvt Ltd', 'Valves'],
  ['Precision Gauges', 'Instruments'], ['Allied Pumps', 'Pumps and motors'], ['Unity Fasteners', 'Bolts and gaskets'],
];
// [item_name, uom, bom_category]
const ITEMS = [
  ['BQ PLATE 12 MM SA 516 GR 70', 'Kgs', 'plate'], ['BQ PLATE 16 MM SA 516 GR 70', 'Kgs', 'plate'],
  ['MS PLATE 8 MM IS 2062', 'Kgs', 'plate'], ['BOILER TUBE 63.5 OD X 3.25 THK SA 210', 'Mtr', 'pipe'],
  ['STAY TUBE 63.5 OD X 6.35 THK SA 210', 'Mtr', 'pipe'], ['MS ANGLE 50 X 50 X 6 MM', 'Kgs', 'angle'],
  ['MS CHANNEL 100 X 50 MM', 'Kgs', 'channel'], ['MS PIPE 50 NB CLASS B', 'Mtr', 'pipe'],
  ['SAFETY VALVE 40 NB SPRING LOADED', 'Nos', 'standard'], ['MAIN STEAM STOP VALVE 80 NB', 'Nos', 'standard'],
  ['FEED CHECK VALVE 25 NB', 'Nos', 'standard'], ['BLOW DOWN VALVE 25 NB', 'Nos', 'standard'],
  ['PRESSURE GAUGE 0-21 KG/CM2', 'Nos', 'standard'], ['WATER LEVEL GAUGE', 'Nos', 'standard'],
  ['FEED PUMP 3 HP CENTRIFUGAL', 'Nos', 'standard'], ['GASKET SPIRAL WOUND 80 NB', 'Nos', 'standard'],
  ['STUD BOLT M16 X 90', 'Nos', 'standard'], ['FIRE BRICK IS 8', 'Nos', 'other'],
];
const PRODUCTS = [
  ['AB-SF-600', 'BOILER-SF-600-WB', 'SOLID-FLAME', 1850000], ['AB-CF-1000', 'BOILER-CF-1000-WB', 'COMBI-FLAME', 2650000],
  ['AB-MF-2000', 'BOILER-MF-2000', 'MULTI-FLAME', 4200000], ['AB-OF-1500', 'BOILER-OF-1500-17B', 'OIL-FLAME', 3100000],
];

const ids = { customers: {}, suppliers: {}, items: {}, products: {} };
async function seedMasters() {
  for (const [name, city, state, code] of CUSTOMERS) {
    const r = await api('POST', '/api/customers', {
      name, city, state, state_code: code, phone: '9800000000', email: `purchase@${name.split(' ')[0].toLowerCase()}.example`,
      address: `Industrial Estate, ${city}`, account_manager: 'sales_head',
    });
    ids.customers[name] = r.id;
  }
  for (const [name, what] of SUPPLIERS) {
    const r = await api('POST', '/api/suppliers', {
      name, contact_person: 'Sales desk', phone: '9700000000', email: `sales@${name.split(' ')[0].toLowerCase()}.example`,
      address: 'Pune', default_payment_terms: '30 days',
    });
    ids.suppliers[name] = r.id ?? r.supplier?.id;
    void what;
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

// --- 3. Enquiries and quotations -----------------------------------------------------------------
async function seedSales() {
  const enquiries = [
    ['Sunrise Dairy Cooperative', 'AB-SF-600', 'IndiaMART', 0], ['Bluewave Chemicals Ltd', 'AB-MF-2000', 'Website', 1],
    ['Harvest Rice Mills', 'AB-SF-600', 'Reference', 2], ['Metro Hospital Trust', 'AB-OF-1500', 'Exhibition', 3],
  ];
  const leadIds = [];
  for (const [org, product, source] of enquiries) {
    const r = await api('POST', '/api/leads', {
      organization: org, company_name: org, lead_name: 'Purchase Manager', phone: '9600000000', email: `enquiry@${org.split(' ')[0].toLowerCase()}.example`,
      source, owner_dept: 'Sales', assigned_to: 'sales_head', account_manager: 'sales_head', enquiry_date: iso(-20),
      address: CUSTOMERS.find(c => c[0] === org)?.[1] || 'Pune',
      products: [{ product_id: ids.products[product], qty: 1 }],
    });
    leadIds.push(r.id);
  }
  // Two customers get a commercial offer.
  for (const [customer, product] of [['Sunrise Dairy Cooperative', 'AB-SF-600'], ['Metro Hospital Trust', 'AB-OF-1500']]) {
    const price = PRODUCTS.find(p => p[0] === product)[3];
    const q = await api('POST', '/api/quotations', {
      customer_id: ids.customers[customer], company: COMPANY, quotation_date: iso(-7), valid_until: iso(23), tax_pct: 18,
      items: [{ product_id: ids.products[product], item_description: PRODUCTS.find(p => p[0] === product)[1], qty: 1, uom: 'Nos', rate: price, gst_pct: 18 }],
    });
    await api('PATCH', `/api/quotations/${q.id}`, { status: 'sent' });
  }
  return leadIds;
}

// --- 4. Projects ---------------------------------------------------------------------------------
// Every project gets the same three-subsystem boiler BOM; stage differs by how far we push it.
const BOM = {
  'Shell & Body': [['BQ PLATE 12 MM SA 516 GR 70', '2500 X 6000 X 12 THK', '2 Nos', true], ['BQ PLATE 16 MM SA 516 GR 70', '2000 X 6000 X 16 THK', '1 Nos', true],
    ['BOILER TUBE 63.5 OD X 3.25 THK SA 210', '63.5 OD X 3.25 THK', '180 Mtr', true], ['STAY TUBE 63.5 OD X 6.35 THK SA 210', '63.5 OD X 6.35 THK', '24 Mtr', true],
    ['MS ANGLE 50 X 50 X 6 MM', 'ISA 50 X 50 X 6', '120 Kgs', true]],
  'Mountings & Fittings': [['SAFETY VALVE 40 NB SPRING LOADED', '40 NB', '2 Nos', false], ['MAIN STEAM STOP VALVE 80 NB', '80 NB', '1 Nos', false],
    ['FEED CHECK VALVE 25 NB', '25 NB', '2 Nos', false], ['BLOW DOWN VALVE 25 NB', '25 NB', '1 Nos', false],
    ['PRESSURE GAUGE 0-21 KG/CM2', '0-21 KG/CM2', '2 Nos', false], ['WATER LEVEL GAUGE', 'REFLEX', '2 Nos', false]],
  'Feed Line': [['FEED PUMP 3 HP CENTRIFUGAL', '3 HP', '2 Nos', false], ['MS PIPE 50 NB CLASS B', '50 NB', '30 Mtr', false],
    ['GASKET SPIRAL WOUND 80 NB', '80 NB', '6 Nos', false], ['STUD BOLT M16 X 90', 'M16 X 90', '48 Nos', false]],
};
const CAT = Object.fromEntries(ITEMS.map(([n, , c]) => [n, c]));

async function createProject(no, customer, productCode, series, capacity) {
  const price = PRODUCTS.find(p => p[0] === productCode)[3];
  const so = await api('POST', '/api/sale-orders', {
    customer_id: ids.customers[customer], customer_name: customer, company: COMPANY, order_date: iso(-60), total: price * 1.18,
    description: `${PRODUCTS.find(p => p[0] === productCode)[1]} boiler`, sales_person: 'sales_head',
  });
  const p = await api('POST', '/api/projects', {
    project_no: no, customer_name: customer, customer_id: ids.customers[customer], company: COMPANY, sale_order_id: so.id,
    series, model_capacity: capacity, model_design: 'WB', order_date: iso(-60), description: `${capacity} kg/hr ${series} boiler`,
  });
  const lines = [];
  const root = await api('POST', '/api/bom-assemblies', { project_id: p.id, name: 'Boiler', node_type: 'System' });
  for (const [sub, rows] of Object.entries(BOM)) {
    const node = await api('POST', '/api/bom-assemblies', { project_id: p.id, name: sub, node_type: 'Subsystem', parent_id: root.id });
    for (const [name, size, qty, mfg] of rows) {
      const it = await api('POST', '/api/bom-items', {
        project_id: p.id, assembly_id: String(node.id), material_description: name, item_id: String(ids.items[name]), category: CAT[name],
        size_spec: size, qty_text: qty, moc: CAT[name] === 'standard' ? null : 'As per IBR', requires_manufacturing: mfg,
      });
      lines.push({ id: it.id, name, qty, mfg });
    }
  }
  return { id: p.id, so: so.id, lines };
}

const supplierFor = name => /PLATE|ANGLE|CHANNEL/.test(name) ? 'Prime Steel Traders' : /TUBE/.test(name) ? 'National Tube Co'
  : /VALVE/.test(name) ? 'Shield Valves Pvt Ltd' : /GAUGE/.test(name) ? 'Precision Gauges' : /PUMP/.test(name) ? 'Allied Pumps'
  : /PIPE/.test(name) ? 'National Tube Co' : 'Unity Fasteners';

async function procure(project, { issue }) {
  await api('POST', `/api/projects/${project.id}/release-bom`, {});
  const pos = new Set();
  for (const line of project.lines) {
    const main = supplierFor(line.name);
    const alt = main === 'Unity Fasteners' ? 'Prime Steel Traders' : 'Unity Fasteners';
    const base = 1000 + (line.id % 7) * 850;
    const q1 = await api('POST', '/api/supplier-quotes', { supplier_id: ids.suppliers[main], items: [{ bom_item_id: line.id, unit_price: base }], expected_delivery_date: iso(10), payment_terms: '30 days' });
    await api('POST', '/api/supplier-quotes', { supplier_id: ids.suppliers[alt], items: [{ bom_item_id: line.id, unit_price: Math.round(base * 1.12) }], expected_delivery_date: iso(18), payment_terms: 'Advance 50%' });
    if (issue) {
      const sel = await api('POST', `/api/bom-items/${line.id}/select-supplier`, { quote_id: (q1.ids || q1.quote_ids || [q1.id])[0] });
      if (sel.po_id) pos.add(sel.po_id);
    }
  }
  for (const po of pos) await api('PATCH', `/api/purchase-orders/${po}`, { action: 'issue' });
  return [...pos];
}

async function receiveAll(project, routeTo) {
  let grn = 1;
  for (const line of project.lines) {
    await api('POST', `/api/bom-items/${line.id}/receive`, {
      qty_text: line.qty.split(' ')[0],
      receipt: { supplier_id: ids.suppliers[supplierFor(line.name)], grn_ref: `GRN-${project.id}-${grn++}`, invoice_no: `INV-${project.id}-${line.id}` },
      received_heat_no: CAT[line.name] === 'plate' ? `H${line.id}A${project.id}` : undefined,
      received_mtc_no: CAT[line.name] === 'plate' ? `MTC-${line.id}` : undefined,
    });
  }
  const pending = await db.execute({ sql: "SELECT ia.id FROM inward_approvals ia JOIN bom_items b ON b.id = ia.bom_item_id WHERE b.project_id = ? AND ia.status = 'pending'", args: [project.id] });
  for (const r of pending.rows) await api('POST', `/api/inward-approvals/${r.id}/decide`, { decision: 'approved' });
  for (const line of project.lines) await api('POST', `/api/bom-items/${line.id}/route-self`, { routed_to: routeTo(line) });
}

// --- main ----------------------------------------------------------------------------------------
await login();
await seedPeople();
await seedMasters();
await seedSales();

const p1 = await createProject('AB-1001', 'Greenfield Foods Pvt Ltd', 'AB-CF-1000', 'CF', '1000');       // design / BOM
const p2 = await createProject('AB-1002', 'Riverside Textiles Ltd', 'AB-MF-2000', 'MF', '2000');         // procurement
const p3 = await createProject('AB-1003', 'Kaveri Pharma Pvt Ltd', 'AB-SF-600', 'SF', '600');            // production
const p4 = await createProject('AB-1004', 'Northstar Paper Mills', 'AB-OF-1500', 'OF', '1500');          // dispatch
void p1;

await procure(p2, { issue: true });
await procure(p3, { issue: true });
await procure(p4, { issue: true });
await receiveAll(p3, l => (l.mfg ? 'production' : 'dispatch'));
await api('POST', '/api/job-sheets', { project_id: p3.id, card_type: 'boiler', job_number: 'AB-1003-JC1', owner_name: 'Ramesh Kumar' });

// AB-1004: bought-out lines only go straight to Dispatch; fabricated lines stay with Production.
await receiveAll(p4, l => (l.mfg ? 'production' : 'dispatch'));
const pl = await api('POST', '/api/packing/from-bom', { project_id: p4.id, company: COMPANY });
console.log('packing list', pl.id ?? pl);

console.log('Acme demo data seeded:', { projects: [p1.id, p2.id, p3.id, p4.id] });
