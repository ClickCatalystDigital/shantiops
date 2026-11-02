// Builds the US Acme Boilers demo data (boiler-erp-us; fictional Acme Boilers Inc., Cleveland, Ohio): US customers, suppliers,
// the cleaned US item master (us-items.json), dollar prices, sales tax, ASME jobs. Same flow as seed-acme.mjs (the Indian demo),
// which this copies; run it against an app started with MARKET=NA and CUSTOMER_SEED=acme-us-seed.json.
// Logins/HR rows go straight into the DB; everything with business rules (enquiries, quotations,
// projects, BOM, procurement, receiving, QC, production, dispatch, service, invoices) goes through the
// real API of a running app, so milestones, numbering and stock behave exactly as in real use. A last
// pass backdates the timestamps the API stamps with "now", so finished work reads as finished weeks ago.
//
// Projects (DEMO.md has the walkthrough):
//   AB-1001 Great Lakes Dairy   150 HP firetube, Section I (P-2)       complete, invoice paid
//   AB-1002 Riverside Paperboard 250 HP firetube, Section I (P-2)      complete, invoice part-paid
//   AB-1003 Bluewater Chemical  1,500 gal deaerator tank, Section VIII "U" (U-1A)  complete, deposit only
//   AB-1004 Northstar Paper     350 HP firetube                        in Procurement (quotes, draft PO, RFQ, part received)
//   AB-1005 Greenfield Foods    250 HP firetube                        in Production / QC (job cards running, QC fail + NCR)
//
// Run against an EMPTY database that the app (MARKET=NA) has already booted once with CUSTOMER_SEED=acme-us-seed.json:
//   DB_URL=... DB_TOKEN=... BASE=http://localhost:8790 ADMIN_PASSWORD=... node scripts/demo/seed-acme-us.mjs
// The nightly reset moves every date forward by (today − demo_meta.seeded_on), so the data stays current.
import { createClient } from '@libsql/client';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'node:fs';

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
// Dates in US Central time (the US demo's zone), so "today" matches the app's.
const iso = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(Date.now() + d * DAY));
const stamp = d => `${iso(d)} ${String(9 + (Math.abs(d) % 8)).padStart(2, '0')}:${String((Math.abs(d) * 7) % 60).padStart(2, '0')}:00`;
// (NNN) 555-01xx: the range set aside for fiction.
const usPhone = (seed, area) => `(${area}) 555-01${String(seed.length * 7 % 100).padStart(2, '0')}`;
const workday = d => { while ([0].includes(new Date(Date.now() + d * DAY).getUTCDay())) d--; return d; }; // Sundays off

// --- 1. Logins + HR (masters, direct) ------------------------------------------------------------
const HEADS = [
  ['manager', 'Laura Bennett', 'manager', null],
  ['sales_head', 'Ryan Mitchell', 'operator', 'Sales'],
  ['marketing_head', 'Megan Clark', 'operator', 'Marketing'],
  ['design_head', 'Victor Ramirez', 'operator', 'Design'],
  ['engg_head', 'Sarah Kowalski', 'operator', 'Engineering'],
  ['procurement_head', 'Andrew Davis', 'operator', 'Procurement'],
  ['stores_head', 'Melissa Price', 'operator', 'Stores'],
  ['production_head', 'Kevin Brennan', 'operator', 'Production'],
  ['qc_head', 'Diane Morgan', 'operator', 'QC'],
  ['dispatch_head', 'Scott Palmer', 'operator', 'Dispatch'],
  ['service_head', 'Nicole Grant', 'operator', 'Installation'],
  ['accounts_head', 'Adam Shaw', 'operator', 'Accounts'],
  ['hr_head', 'Karen Reed', 'operator', 'HR'],
];
// Welders carry their ASME stamp (the weld map and the QW-322 continuity log use it).
const WORKERS = [['Mike Hernandez', 'Welder'], ['Tom Walsh', 'Welder'], ['Luis Ortega', 'Fitter'], ['Jake Turner', 'Fitter'],
  ['Dan Sullivan', 'Burner'], ['Rob Miller', 'Machinist'], ['Chris Young', 'Grinder'], ['Sam Brooks', 'Helper']];
const STAMP = { 'Mike Hernandez': 'W-07', 'Tom Walsh': 'W-12' };
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
  // Hourly cost per trade: Labour Utilization and the work orders' actual labour read it.
  for (const [trade, rate] of [['Welder', 38], ['Fitter', 34], ['Burner', 30], ['Machinist', 36], ['Grinder', 27], ['Helper', 22]]) {
    await q("UPDATE employees SET cost_rate_per_hour = ? WHERE employee_type = 'worker' AND trade = ?", [rate, trade]);
  }
}

// --- 2. Masters through the API -------------------------------------------------------------------
// [name, city, state, state code, ZIP, sales tax % on our invoices]. Ohio customers pay Ohio sales tax (state + county);
// out-of-state customers 0% (no nexus there: they self-assess use tax).
const CUSTOMERS = [
  ['Greenfield Foods Inc.', 'Toledo', 'Ohio', 'OH', '43607', 7.75], ['Riverside Paperboard Co.', 'Kalamazoo', 'Michigan', 'MI', '49007', 0],
  ['Cascade Pharma Inc.', 'Fort Wayne', 'Indiana', 'IN', '46802', 0], ['Northstar Paper Mills', 'Duluth', 'Minnesota', 'MN', '55802', 0],
  ['Great Lakes Dairy Cooperative', 'Green Bay', 'Wisconsin', 'WI', '54303', 0], ['Bluewater Chemical Co.', 'Baton Rouge', 'Louisiana', 'LA', '70805', 0],
  ['Harvest Grain Mills', 'Decatur', 'Illinois', 'IL', '62521', 0], ['Metro Health System', 'Columbus', 'Ohio', 'OH', '43215', 7.5],
];
const TAX = Object.fromEntries(CUSTOMERS.map(c => [c[0], c[5]]));
const SUPPLIERS = [['Prime Steel Supply', 'Pittsburgh, PA 15222'], ['National Tube Co.', 'Youngstown, OH 44503'], ['Shield Valve Corp.', 'Houston, TX 77029'],
  ['Precision Gauge Co.', 'Milwaukee, WI 53204'], ['Allied Pumps Inc.', 'Grand Rapids, MI 49503'], ['Unity Fastener Supply', 'Akron, OH 44311']];
// The US item master: the cleaned canonical catalogue (scripts/demo/us-items.mjs). Every row goes into the item master;
// the BOM below uses a few of them plus the plate, tube and structural items a firetube shop buys.
const US_ITEMS = JSON.parse(readFileSync(new URL('./us-items.json', import.meta.url), 'utf8'));
const cat = code => { const it = US_ITEMS.find(i => i.code === code); if (!it) throw new Error(`no catalogue item ${code}`); return it.name; };
const PLATE12 = 'PLATE 1/2" SA-516 GR. 70', PLATE16 = 'PLATE 5/8" SA-516 GR. 70', PLATE8 = 'PLATE 5/16" A36', PLATE10 = 'PLATE 3/8" A36';
const TUBE = 'BOILER TUBE 2-1/2" OD X 0.105" WT SA-178 GR. A', STAY = 'STAY TUBE 2-1/2" OD X 0.250" WT SA-192', ANGLE = 'ANGLE 2" X 2" X 1/4" A36';
const CHANNEL = 'CHANNEL C4 X 5.4 A36', PIPE = cat('US-PIP-CS-NPS2-SCH40'), SV = cat('US-VLV-SRV-2X3-CL300X150-SA216'), MSV = cat('US-VLV-STOPCHK-4IN-CL300-SA216');
const FCV = 'FEEDWATER CHECK VALVE 1-1/4" CLASS 300 SA-216 WCB', BDV = cat('US-VLV-CBD-1.5IN-CL300-WCB'), PG = 'PRESSURE GAUGE 4-1/2" DIAL 0-300 PSIG WITH SIPHON';
const LG = cat('US-VLV-LEVELGAUGE-COL-SA105'), PUMP = cat('US-ROT-BFPUMP-75GPM-400PSI'), GASKET = cat('US-GSK-SW-316GR-NPS4-CL300'), STUD = cat('US-FST-STUD-B7-NPS4-CL300');
const BRICK = 'FIREBRICK 9" STRAIGHT SUPER DUTY';
// [item_name, uom, bom_category, unit price $ per uom]
const ITEMS = [
  [PLATE12, 'LB', 'plate', 0.62], [PLATE16, 'LB', 'plate', 0.64], [PLATE8, 'LB', 'plate', 0.48], [PLATE10, 'LB', 'plate', 0.49],
  [TUBE, 'FT', 'pipe', 6.8], [STAY, 'FT', 'pipe', 14.5], [ANGLE, 'LB', 'angle', 0.55], [CHANNEL, 'LB', 'channel', 0.56], [PIPE, 'FT', 'pipe', 9.5],
  [SV, 'EA', 'standard', 2650], [MSV, 'EA', 'standard', 3900], [FCV, 'EA', 'standard', 640], [BDV, 'EA', 'standard', 1450],
  [PG, 'EA', 'standard', 145], [LG, 'EA', 'standard', 1850], [PUMP, 'EA', 'standard', 9800], [GASKET, 'EA', 'standard', 38],
  [STUD, 'KIT', 'standard', 46], [BRICK, 'EA', 'other', 3.2],
];
const CAT = Object.fromEntries(ITEMS.map(([n, , c]) => [n, c]));
const PRICE = Object.fromEntries(ITEMS.map(([n, , , p]) => [n, p]));
// [code, name, type, price $, series, capacity]. Capacity is stored metric (kg/hr; 1 boiler HP = 15.65 kg/hr) and shown
// in lb/hr; AB-VR-1500 is a Section VIII vessel (capacity = its working volume in litres). Neutral names, no real maker's range.
const PRODUCTS = [
  ['AB-FT-150', 'FIRETUBE-150HP-3P', 'Firetube, natural gas', 168000, 'OF', 2348], ['AB-FT-250', 'FIRETUBE-250HP-3P', 'Firetube, dual fuel', 236000, 'CF', 3913],
  ['AB-VR-1500', 'DEAERATOR-TANK-1500GAL', 'Pressure vessel, Section VIII', 96000, 'MF', 5678], ['AB-FT-350', 'FIRETUBE-350HP-4P', 'Firetube, gas / No. 2 oil', 298000, 'OF', 5478],
];
const HP = { 'AB-FT-150': 150, 'AB-FT-250': 250, 'AB-VR-1500': 150, 'AB-FT-350': 350 };
const product = code => PRODUCTS.find(p => p[0] === code);

const ids = { customers: {}, suppliers: {}, items: {}, products: {} };
async function seedMasters() {
  for (const [name, city, state, code, zip] of CUSTOMERS) {
    const r = await api('POST', '/api/customers', {
      name, city, state, state_code: code, phone: usPhone(name, '419'),
      email: `purchasing@${name.split(' ')[0].toLowerCase()}.example`, address: `${100 + name.length * 37} Industrial Drive, ${city}, ${code} ${zip}`, account_manager: 'sales_head',
    });
    ids.customers[name] = r.id;
  }
  for (const [name, where] of SUPPLIERS) {
    const r = await api('POST', '/api/suppliers', {
      name, contact_person: 'Inside sales', phone: usPhone(name, '412'),
      email: `sales@${name.split(' ')[0].toLowerCase()}.example`, address: `${200 + name.length * 11} Commerce Street, ${where}`, default_payment_terms: 'Net 30',
    });
    ids.suppliers[name] = r.id ?? r.supplier?.id;
  }
  for (const [item_name, uom, bom_category] of ITEMS) {
    const r = await api('POST', '/api/item-master', { item_name, uom, bom_category, confirm: true });
    ids.items[item_name] = r.id ?? r.item?.id;
  }
  // The rest of the US catalogue (flanges, fittings, gaskets, studs, pipe, pressure parts), as the item master a buyer searches.
  for (const it of US_ITEMS) {
    if (ids.items[it.name]) continue;
    const r = await api('POST', '/api/item-master', { item_name: it.name, uom: it.uom, bom_category: it.bom_category, detail_desc: [it.spec, it.standard].filter(Boolean).join(' · '), confirm: true });
    ids.items[it.name] = r.id ?? r.item?.id;
  }
  for (const [code, name, type, price] of PRODUCTS) {
    const r = await api('POST', '/api/sales-products', {
      product_code: code, product_name: name, product_type: type, price, gst_pct: 0, unit: 'EA', warranty_days: 365,
    });
    ids.products[code] = r.id ?? r.product?.id;
  }
}

async function seedStock() {
  // [item, on_hand, reorder_point, location]; the angle stock ends below its reorder point once the five boilers use it. Release-bom reserves
  // from this stock, and those reserved lines are not bought again (procure() skips them).
  const STOCK = [[PLATE8, 2600, 1100, 'Yard A'], [ANGLE, 2000, 900, 'Rack S1'],
    [CHANNEL, 1400, 650, 'Rack S1'], [PIPE, 300, 130, 'Rack P2'],
    [GASKET, 40, 20, 'Bin G3'], [STUD, 60, 20, 'Bin F1'],
    [BRICK, 2500, 1000, 'Shed 2'], [PG, 6, 4, 'Cabinet I1'],
    [PLATE10, 0, 0, 'Yard A']]; // tracked as plate pieces (the cut below); pieces own its on-hand
  for (const [name, on_hand, reorder_point, location] of STOCK) {
    await api('POST', '/api/inventory-items', {
      description: name, item_id: ids.items[name], on_hand, reorder_point, location, avg_cost: PRICE[name], category: CAT[name],
    });
  }
}

// --- 3. Sales: enquiries (every stage), quotations, orders ------------------------------------------
async function newLead(org, code, source, daysAgo, extra = {}) {
  const r = await api('POST', '/api/leads', {
    organization: org, company_name: org, lead_name: 'Purchasing Manager', phone: usPhone(org, '614'),
    email: `inquiries@${org.split(' ')[0].toLowerCase()}.example`, source, owner_dept: 'Sales', assigned_to: 'sales_head',
    account_manager: 'sales_head', enquiry_date: iso(-daysAgo), address: CUSTOMERS.find(c => c[0] === org)?.[1] || 'Cleveland',
    products: [{ product_id: ids.products[code], qty: 1 }],
  });
  if (Object.keys(extra).length) await api('PATCH', `/api/leads/${r.id}`, extra);
  return r.id;
}
async function note(lead_id, content, daysAgo, next) {
  // plan_for: the Weekly Planner's owner (else it shows the admin login that ran the seed).
  await api('POST', '/api/crm-notes', { lead_id, note_type: 'call', content, visit_date: iso(-daysAgo), next_plan_date: next != null ? iso(next) : undefined, plan_for: 'sales_head' });
}

// One accepted quotation → sale order (with its items) for a project's customer.
async function sell(customer, code, orderAgo, leadId) {
  const [, name, , price] = product(code);
  const tax = TAX[customer] ?? 0;
  const vessel = code === 'AB-VR-1500';
  const qt = await api('POST', '/api/quotations', {
    customer_id: ids.customers[customer], lead_id: leadId, company: COMPANY, quotation_date: iso(-orderAgo - 12), valid_until: iso(-orderAgo + 18), tax_pct: tax,
    terms: '30% deposit with order, 60% before shipment, 10% on startup. Net 30. FOB Cleveland, OH.',
    items: [
      { product_id: ids.products[code], item_description: vessel ? `${name} deaerator storage tank, ASME Section VIII Div. 1, "U" stamped` : `${name} steam boiler, ASME Section I, "S" stamped, with trim`, qty: 1, uom: 'EA', rate: price, gst_pct: tax },
      { item_description: 'Installation supervision and startup at site', qty: 1, uom: 'LOT', rate: Math.round(price * 0.04), gst_pct: tax },
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
  const hot = await newLead('Metro Health System', 'AB-FT-350', 'Exhibition', 21, { sales_call_status: 'Hot Offers', next_contact_date: iso(0), expected_value: 298000 });
  await note(hot, 'Walked the boiler room; they want a 350 HP gas / oil unit installed before the heating season. Estimate sent, call back on price.', 9, 0);
  const qt = await api('POST', '/api/quotations', {
    customer_id: ids.customers['Metro Health System'], lead_id: hot, company: COMPANY, quotation_date: iso(-9), valid_until: iso(21), tax_pct: TAX['Metro Health System'],
    items: [{ product_id: ids.products['AB-FT-350'], item_description: 'FIRETUBE-350HP-4P steam boiler, ASME Section I', qty: 1, uom: 'EA', rate: 298000, gst_pct: TAX['Metro Health System'] }],
  });
  await api('PATCH', `/api/quotations/${qt.id}`, { status: 'sent' });
  const follow = await newLead('Cascade Pharma Inc.', 'AB-FT-250', 'Website', 14, { sales_call_status: 'Follow up stage', next_contact_date: iso(2) });
  await note(follow, 'Asked for a dual-fuel option and payback figures. Sending a comparison next week.', 6, 2);
  const cold = await newLead('Harvest Grain Mills', 'AB-FT-150', 'Website', 30, { sales_call_status: 'Lead - Hot', next_contact_date: iso(-1) });
  await note(cold, 'Gas-fired unit for the new drying line. Budget approval pending; call overdue.', 12, -1);
  const lost = await newLead('Harvest Grain Mills', 'AB-FT-350', 'Reference', 75, { sales_call_status: 'Order Lost', lost_reason: 'Price: went with a local fabricator' });
  await note(lost, 'Lost on price, about 12% below our estimate. Keep in touch for the second line.', 40);
  const dropped = await newLead('Cascade Pharma Inc.', 'AB-FT-150', 'Website', 90, { sales_call_status: 'Lead Project - Dropped', lost_reason: 'Project shelved by the customer' });
  await note(dropped, 'Plant expansion postponed by a year.', 60);

  const camp = await api('POST', '/api/campaigns', { name: 'Dairy and food processing mailer', campaign_type: 'Email', start_date: iso(-45), end_date: iso(15), budget: 4500, owner_dept: 'Marketing', notes: 'Case study of a 150 HP gas-fired install.' });
  await api('POST', '/api/campaigns', { name: 'Midwest Boiler & Steam Expo, Columbus', campaign_type: 'Event', start_date: iso(-25), end_date: iso(-23), budget: 18000, owner_dept: 'Marketing' });
  await api('POST', '/api/opportunities', { title: 'Second boiler for the new plant', customer_id: ids.customers['Great Lakes Dairy Cooperative'], customer_name: 'Great Lakes Dairy Cooperative',
    stage: 'Proposals', value_num: 168000, probability: 60, expected_close: iso(30), next_contact_date: iso(1), source: 'Repeat customer', owner_dept: 'Sales',
    campaign_id: camp.id ?? camp.campaign?.id, notes: 'Happy with AB-1001; wants a matching unit next year.' });
}

// --- 4. Projects ---------------------------------------------------------------------------------
// One three-subsystem firetube BOM, quantities scaled by boiler HP (per 150 HP). [name, size, qty per 150 HP, made in house]
const BOM = {
  'Shell & Body': [[PLATE12, '96" X 240" X 1/2"', 9000, true], [PLATE16, '96" X 240" X 5/8"', 3800, true],
    [TUBE, '2-1/2" OD X 0.105" WT', 1100, true], [STAY, '2-1/2" OD X 0.250" WT', 120, true],
    [ANGLE, 'L2 X 2 X 1/4', 260, true]],
  'Trim & Controls': [[SV, '2" X 3"', 2, false], [MSV, '4" CL 300', 1, false],
    [FCV, '1-1/4" CL 300', 2, false], [BDV, '1-1/2" CL 300', 1, false],
    [PG, '0-300 PSIG', 2, false], [LG, 'Gauge column', 2, false]],
  'Feedwater Line': [[PUMP, '75 GPM', 2, false], [PIPE, '2" SCH 40', 90, false],
    [GASKET, '4" CL 300', 6, false], [STUD, '3/4" X 4-1/4"', 6, false]],
};
// The Section VIII deaerator storage tank: shell, heads, nozzles, trim.
const BOM_VESSEL = {
  'Shell & Heads': [[PLATE12, '72" X 240" X 1/2"', 6200, true], [PLATE16, '2:1 SE heads 72" ID X 5/8"', 1900, true], [ANGLE, 'Saddle stiffeners', 300, true]],
  'Trim & Controls': [[SV, '2" X 3"', 1, false], [PG, '0-300 PSIG', 1, false], [LG, 'Gauge column', 1, false]],
  'Nozzles': [[PIPE, '2" SCH 40', 24, false], [GASKET, '4" CL 300', 8, false], [STUD, '3/4" X 4-1/4"', 8, false]],
};
const UOM = Object.fromEntries(ITEMS.map(([n, u]) => [n, u]));

async function createProject(no, customer, code, orderAgo, leadSource) {
  const [, name, type, , series, capacity] = product(code);
  const leadId = await newLead(customer, code, leadSource, orderAgo + 30);
  await note(leadId, 'Requirement confirmed after site visit; technical offer accepted.', orderAgo + 20);
  const { quotation, so } = await sell(customer, code, orderAgo, leadId);
  const p = await api('POST', '/api/projects', {
    project_no: no, customer_name: customer, customer_id: ids.customers[customer], company: COMPANY, sale_order_id: so,
    series, model_capacity: capacity, model_pressure: 10.55, model_design: 'WB', order_date: iso(-orderAgo), description: code === 'AB-VR-1500' ? `${name}, ${type}` : `${HP[code]} HP ${name} boiler`,
  });
  // The Executive dashboard's value-in-progress reads projects.order_value (the order's value before GST).
  await q('UPDATE projects SET order_value = (SELECT subtotal FROM sale_orders WHERE id = ?) WHERE id = ?', [so, p.id]);

  // Design: calculation sheet + three drawings, approved by the Design Head. The demo has no file storage,
  // so the drawings carry no file; their status is set directly.
  const cs = await api('POST', '/api/calc-sheets', { name: `Pressure parts calculation, ASME (${name})`, projectId: p.id });
  await api('POST', '/api/calc-snapshots', { sheetId: cs.id, label: 'Issued for drawing approval' }); // else "No snapshot yet"
  for (const dwg of ['General arrangement', 'Shell and furnace', 'Tube layout']) {
    const d = await api('POST', '/api/calc-drawings', { name: dwg, projectId: p.id, assignedTo: 'Victor Ramirez', description: `${no} ${dwg.toLowerCase()} drawing` });
    await q("UPDATE calc_drawings SET status = 'approved' WHERE id = ?", [d.id ?? d.drawing?.id]);
  }

  const f = HP[code] / 150;
  const lines = [];
  const root = await api('POST', '/api/bom-assemblies', { project_id: p.id, name: code === 'AB-VR-1500' ? 'Vessel' : 'Boiler', node_type: 'System' });
  for (const [sub, rows] of Object.entries(code === 'AB-VR-1500' ? BOM_VESSEL : BOM)) {
    const node = await api('POST', '/api/bom-assemblies', { project_id: p.id, name: sub, node_type: 'Subsystem', parent_id: root.id });
    for (const [item, size, per1000, mfg] of rows) {
      const qty = ['EA', 'KIT'].includes(UOM[item]) ? per1000 : Math.round(per1000 * f);
      const it = await api('POST', '/api/bom-items', {
        project_id: p.id, assembly_id: String(node.id), material_description: item, category: CAT[item],
        size_spec: size, qty_text: `${qty} ${UOM[item]}`, moc: CAT[item] === 'standard' ? null : 'Per ASME Section II', requires_manufacturing: mfg,
      });
      await api('POST', `/api/bom-items/${it.id}/link-item`, { item_id: ids.items[item] }); // catalog link: stock matching, rates, HSN
      lines.push({ id: it.id, name: item, qty, mfg });
    }
  }
  return { no, id: p.id, so, quotation, lead: leadId, orderAgo, customer, series, capacity, lines, code, hp: HP[code], vessel: code === 'AB-VR-1500' };
}

const supplierFor = name => /PLATE|ANGLE|CHANNEL/.test(name) ? 'Prime Steel Supply' : /TUBE|PIPE/.test(name) ? 'National Tube Co.'
  : /VALVE/.test(name) ? 'Shield Valve Corp.' : /GAUGE/.test(name) ? 'Precision Gauge Co.' : /PUMP/.test(name) ? 'Allied Pumps Inc.' : 'Unity Fastener Supply';
const altFor = main => main === 'Prime Steel Supply' ? 'Unity Fastener Supply' : 'Prime Steel Supply';

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
    const q1 = await api('POST', '/api/supplier-quotes', { supplier_id: ids.suppliers[main], items: [{ bom_item_id: line.id, unit_price: base }], expected_delivery_date: iso(-project.orderAgo + 30), payment_terms: 'Net 30' });
    await api('POST', '/api/supplier-quotes', { supplier_id: ids.suppliers[altFor(main)], items: [{ bom_item_id: line.id, unit_price: Math.round(base * 1.08) }], expected_delivery_date: iso(-project.orderAgo + 38), payment_terms: '50% with order' });
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
    await api('POST', '/api/gate-inward-receipts', { supplier_name: supplier, vehicle_no: `PA ${String.fromCharCode(65 + n)}K-${4100 + project.id * 10 + n}`,
      driver_name: 'Driver', material_ref: `${project.no} ${group.length} item(s), BOL ${7000 + project.id * 10 + n}`, security_docs_ok: 1, security_seal_ok: 1 });
    for (const line of group) {
      await api('POST', `/api/bom-items/${line.id}/receive`, {
        qty_text: String(line.qty),
        receipt: { supplier_id: ids.suppliers[supplier], grn_ref: `RCV-${project.no}-${n}`, invoice_no: `${supplier.split(' ')[0].toUpperCase()}-${project.id}${String(n).padStart(3, '0')}` },
        received_heat_no: CAT[line.name] === 'plate' ? `H${project.id}${line.id}A` : undefined,
        received_mtc_no: CAT[line.name] === 'plate' ? `MTR-${project.id}${line.id}` : undefined,
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
    if (res !== 'pending') await api('PATCH', `/api/qc-records/${r.id}`, { result: res, tested_on: iso(-project.orderAgo + 35) });
  }
  return recs;
}

async function milestoneId(project, key) {
  return (await q('SELECT id FROM milestones WHERE project_id = ? AND milestone_key = ?', [project.id, key]))[0].id;
}

// Material issue + job cards for the made-in-house lines. done: how many of the cards to finish.
const JOBS = [['marking_cutting', 'PLATE 1/2"'], ['drilling', 'PLATE 5/8"'], ['shell_welding', 'PLATE 1/2"'],
  ['tube_stay_welding', 'BOILER TUBE'], ['box_up', 'STAY TUBE'], ['smoke_box', 'ANGLE']];
async function produce(project, { done = JOBS.length, running = 0 } = {}) {
  const made = project.lines.filter(l => l.mfg);
  for (const line of made) {
    await api('POST', '/api/material-issues', { project_id: project.id, bom_item_id: line.id, qty: line.qty, notes: 'Issued to shop floor' });
  }
  const cards = [];
  for (const [i, [key, match]] of JOBS.entries()) {
    const line = made.find(l => l.name.startsWith(match)) || made[i % made.length]; // the vessel has no tubes
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

// The 33-stage paper Job Card (Shop Floor → Job Card board, QC → Job Cards). Stages are spread over the
// production window. signed: stages Production finished and QC signed; then one finished stage waiting
// for QC and one started (AB-1005). A finished project passes signed = all.
async function jobSheet(project, { signed = Infinity } = {}) {
  const fitters = (await q("SELECT id FROM employees WHERE employee_type = 'worker' AND trade IN ('Welder', 'Fitter') ORDER BY id")).map(r => r.id);
  const sheet = await api('POST', '/api/job-sheets', {
    job_number: project.no, project_id: project.id, card_type: 'boiler', drawing_approved_on: iso(-project.orderAgo + 20),
    ibr_bvi: `NB-${51000 + project.id}`, drg_nos: `${project.no}-GA-01, ${project.no}-SH-02, ${project.no}-TL-03`, boiler_plate_nos: `P${project.id}01, P${project.id}02`, owner_name: 'Kevin Brennan',
  });
  const { stages } = await api('GET', `/api/job-sheets/${sheet.id}`);
  for (const [i, s] of stages.entries()) {
    const day = workday(Math.min(0, -project.orderAgo + 40 + Math.floor(i * 40 / stages.length)));
    const fitter_employee_id = fitters[i % fitters.length];
    const path = `/api/job-sheets/${sheet.id}/stages/${s.id}`;
    if (i < signed + 1) {
      await api('PATCH', path, { action: 'finish', date: iso(day), fitter_employee_id });
      if (i < signed) await api('PATCH', path, { action: 'qc', date: iso(day), inspection_date: iso(day) });
    } else if (i === signed + 1) await api('PATCH', path, { action: 'start', date: iso(0), fitter_employee_id });
    else break;
  }
  // Sign times are stamped "now"; put them on the stage's own dates.
  await q(`UPDATE job_sheet_stages SET production_sign_at = end_date || ' 17:30:00', qc_sign_at = CASE WHEN qc_sign_by IS NOT NULL THEN inspection_date || ' 11:00:00' END
           WHERE sheet_id = ?`, [sheet.id]);
  await q('UPDATE job_sheets SET created_at = ? WHERE id = ?', [stamp(-project.orderAgo + 38), sheet.id]);
  // Signing a finished project's stages alerts QC and Dispatch today; those weeks-old alerts would be noise.
  if (signed === Infinity) await q("DELETE FROM notifications WHERE project_id = ? AND kind LIKE 'jobsheet%'", [project.id]);
}

// A work order over the project's job cards (Work Order Register, Production Cost Variance, Manufacturing
// Performance): planned materials and route steps, the job cards linked to it, and a day's time logs per card.
const WORKSTATIONS = [['Plate roll', 95], ['Welding bay', 70], ['Tube expander', 55]];
async function workOrder(project, cards, status) {
  const ws = await q('SELECT id FROM workstations WHERE machine_hour_rate IS NOT NULL ORDER BY id'); // ours, not migrate()'s unrated ones
  const wo = await api('POST', '/api/work-orders', {
    mode: 'against_order', project_id: project.id, qty_planned: 1, product_description: `${project.series}-${project.capacity} boiler pressure parts`,
    planned_start: iso(-project.orderAgo + 40), planned_end: iso(-project.orderAgo + 76), notes: 'Shell, furnace, tubes and body',
  });
  for (const l of project.lines.filter(l => l.mfg)) {
    await api('POST', `/api/work-orders/${wo.id}/materials`, { bom_item_id: l.id, description: l.name, qty_required: l.qty, unit_cost: PRICE[l.name] });
  }
  for (const [i, [key]] of JOBS.entries()) {
    await api('POST', `/api/work-orders/${wo.id}/operations`, {
      workstation_id: ws[i % ws.length].id, milestone_id: await milestoneId(project, key), department: 'Production',
      planned_minutes: 960 + i * 240, outputs: key.replace(/_/g, ' '), quality_checkpoint: key === 'shell_welding' ? 'Full RT of longitudinal seams (PW-11)' : undefined,
    });
  }
  for (const s of ['released', 'in_progress', ...(status === 'completed' ? ['completed'] : [])]) await api('PATCH', `/api/work-orders/${wo.id}`, { status: s });
  await q(`UPDATE job_cards SET work_order_id = ? WHERE id IN (${cards.map(() => '?').join(',')})`, [wo.id, ...cards]);
  // Planned = what its job cards plan (rework included, since its output counts as done), not 1 per order.
  await q('UPDATE work_orders SET qty_planned = (SELECT SUM(qty_planned) FROM job_cards WHERE work_order_id = ?) WHERE id = ?', [wo.id, wo.id]);
  await q('UPDATE work_orders SET created_at = ? WHERE id = ?', [stamp(-project.orderAgo + 38), wo.id]);

  const workers = (await q("SELECT id, trade FROM employees WHERE employee_type = 'worker' ORDER BY id"));
  const states = await q(`SELECT id, status FROM job_cards WHERE id IN (${cards.map(() => '?').join(',')}) ORDER BY id`, cards);
  for (const [i, jc] of states.entries()) {
    if (jc.status === 'pending') continue;
    const day = workday(Math.min(0, -project.orderAgo + 41 + i * 6));
    for (const [k, w] of [workers[i % 4], workers[4 + (i % 4)]].entries()) {
      const t = await api('POST', `/api/job-cards/${jc.id}/time-logs`, { employee_id: w.id, minutes: 420 + k * 60 + i * 15, qty_completed: jc.status === 'done' && k === 0 ? 1 : 0 });
      await q('UPDATE job_card_time_logs SET created_at = ? WHERE id = ?', [`${iso(day)} 18:00:00`, t.id]);
    }
  }
  return wo.id;
}

// Shop floor hands the finished subsystems to Dispatch (sets production_done on the made lines).
async function handOver(project) {
  await api('POST', '/api/production/handovers', { items: project.lines.filter(l => l.mfg).map(l => ({ bom_item_id: l.id, qty: l.qty })), note: 'Shell, tubes and body complete', approve: true });
}

// The ASME record package behind a job's data report (lib/qc-asme.mjs has the shape): stamps, the Authorized Inspector,
// WPS/PQR, the two welders' continuity (last welds within six months), the weld map, NDE, PWHT and the hydro test.
function asmeData(project, htDate) {
  const v = project.vessel, d = n => iso(-project.orderAgo + n);
  const welds = v ? [
    { id: 'L1', joint: 'Shell course 1 long seam', category: 'A', type: 'Type 1 double-welded butt', wps: 'WPS-101', welders: ['W-07'], nde: 'RT spot', nde_report: `RT-${project.no}-1`, result: 'Accept' },
    { id: 'L2', joint: 'Shell course 2 long seam', category: 'A', type: 'Type 1 double-welded butt', wps: 'WPS-101', welders: ['W-07'], nde: 'RT spot', nde_report: `RT-${project.no}-1`, result: 'Accept' },
    { id: 'C1', joint: 'Head to shell, left', category: 'B', type: 'Type 1 double-welded butt', wps: 'WPS-101', welders: ['W-12'], nde: 'RT spot', nde_report: `RT-${project.no}-2`, result: 'Accept' },
    { id: 'C2', joint: 'Shell course 1 to 2', category: 'B', type: 'Type 1 double-welded butt', wps: 'WPS-101', welders: ['W-07', 'W-12'], nde: 'RT spot', nde_report: `RT-${project.no}-2`, result: 'Accept' },
    { id: 'C3', joint: 'Head to shell, right', category: 'B', type: 'Type 1 double-welded butt', wps: 'WPS-101', welders: ['W-12'], nde: 'RT spot', nde_report: `RT-${project.no}-2`, result: 'Accept' },
    { id: 'N1', joint: 'Steam inlet nozzle', category: 'D', type: 'Full-penetration set-in', wps: 'WPS-102', welders: ['W-12'], nde: 'MT', nde_report: `MT-${project.no}-1`, result: 'Accept' },
    { id: 'N2', joint: 'Outlet nozzle', category: 'D', type: 'Full-penetration set-in', wps: 'WPS-102', welders: ['W-12'], nde: 'MT', nde_report: `MT-${project.no}-1`, result: 'Accept' },
  ] : [
    { id: 'L1', joint: 'Shell long seam', category: 'A', type: 'Double-welded butt (PW-9)', wps: 'WPS-101', welders: ['W-07'], nde: 'RT full', nde_report: `RT-${project.no}-1`, result: 'Accept' },
    { id: 'C1', joint: 'Front tubesheet to shell', category: 'B', type: 'Full-penetration corner (PW-15)', wps: 'WPS-102', welders: ['W-12'], nde: 'UT', nde_report: `UT-${project.no}-1`, result: 'Accept' },
    { id: 'C2', joint: 'Shell girth seam', category: 'B', type: 'Double-welded butt', wps: 'WPS-101', welders: ['W-07', 'W-12'], nde: 'RT full', nde_report: `RT-${project.no}-1`, result: 'Accept' },
    { id: 'C3', joint: 'Rear tubesheet to shell', category: 'B', type: 'Full-penetration corner (PW-15)', wps: 'WPS-102', welders: ['W-12'], nde: 'UT', nde_report: `UT-${project.no}-1`, result: 'Accept' },
    { id: 'N1', joint: 'Steam outlet nozzle', category: 'D', type: 'Full-penetration set-in', wps: 'WPS-102', welders: ['W-12'], nde: 'MT', nde_report: `MT-${project.no}-1`, result: 'Accept' },
    { id: 'N2', joint: 'Feedwater nozzle', category: 'D', type: 'Full-penetration set-in', wps: 'WPS-102', welders: ['W-07'], nde: 'MT', nde_report: `MT-${project.no}-1`, result: 'Accept' },
    { id: 'N3', joint: 'Safety valve nozzle', category: 'D', type: 'Full-penetration set-in', wps: 'WPS-102', welders: ['W-07'], nde: 'MT', nde_report: `MT-${project.no}-1`, result: 'Accept' },
  ];
  const lastWeld = d(70);
  return {
    form: v ? 'U-1A' : 'P-2', edition: '2025', nb_no: String(51000 + project.id), stamp: v ? 'U' : 'S', coa_no: v ? '61842' : '61841', coa_expires: iso(600),
    location: `${project.customer}, ${CUSTOMERS.find(c => c[0] === project.customer)?.[1]}`,
    inspector: { name: 'J. Peterson', agency: 'Lakeshore Inspection Services', commission: 'NB 14792 A' },
    mawp_temp_f: v ? 250 : 366, mdmt_f: v ? -20 : null, corrosion_in: v ? 0.0625 : 0.0625, supports: v ? 'Two saddles, welded wear plates' : null,
    shell: { spec: 'SA-516 Gr. 70', thk_in: v ? 0.5 : 0.5, id_in: null, length_in: null },
    heads: v ? { spec: 'SA-516 Gr. 70', thk_in: 0.625, type: '2:1 semi-ellipsoidal' } : { spec: 'SA-516 Gr. 70', thk_in: 0.625, type: 'Flat tubesheet, stayed (PG-46)' },
    tubes: v ? null : { spec: 'SA-178 Gr. A', od_in: 2.5, thk_in: 0.105, count: Math.round(project.hp * 1.1) },
    furnace: v ? null : { spec: 'SA-516 Gr. 70', od_in: Math.round(24 + project.hp / 25), thk_in: 0.5, length_in: Math.round(160 + project.hp / 5) },
    safety_valves: v ? [] : [{ size: '2" x 3"', set_psi: 150, capacity: Math.round(project.capacity * 2.2046 * 0.6) }, { size: '2" x 3"', set_psi: 155, capacity: Math.round(project.capacity * 2.2046 * 0.6) }],
    nozzles: v ? [{ purpose: 'Steam inlet', qty: 1, size: '6" Class 150', material: 'SA-106 Gr. B / SA-105', attachment: 'UW-16.1(c)' },
      { purpose: 'Outlet to feed pumps', qty: 1, size: '4" Class 150', material: 'SA-106 Gr. B / SA-105', attachment: 'UW-16.1(c)' },
      { purpose: 'Manway', qty: 1, size: '12" x 16"', material: 'SA-516 Gr. 70', attachment: 'UW-16.1(d)' }]
      : [{ purpose: 'Steam outlet', qty: 1, size: '4" Class 300', material: 'SA-106 Gr. B / SA-105', attachment: 'PW-16.1' },
        { purpose: 'Feedwater', qty: 1, size: '1-1/4" Class 300', material: 'SA-106 Gr. B', attachment: 'PW-16.1' },
        { purpose: 'Handholes', qty: 4, size: '3" x 4"', material: 'SA-516 Gr. 70', attachment: 'Pressed' }],
    wps: [{ id: 'WPS-101', process: 'SAW', pqr: 'PQR-101', base_metal: 'P-No. 1 to P-No. 1', thickness: '3/16" to 1-1/2"', pwht: 'Not required up to 3/4" (PW-39)' },
      { id: 'WPS-102', process: 'SMAW', pqr: 'PQR-102', base_metal: 'P-No. 1 to P-No. 1', thickness: '1/16" to 1-1/4"', pwht: 'Not required up to 3/4" (PW-39)' }],
    welders: [{ stamp: 'W-07', name: 'Mike Hernandez', wpq: 'WPQ-07', processes: { SAW: { qualified_on: iso(-900), last_weld: lastWeld }, SMAW: { qualified_on: iso(-1100), last_weld: lastWeld } } },
      { stamp: 'W-12', name: 'Tom Walsh', wpq: 'WPQ-12', processes: { SAW: { qualified_on: iso(-700), last_weld: lastWeld }, SMAW: { qualified_on: iso(-650), last_weld: lastWeld } } }],
    welds,
    nde: [{ report: `RT-${project.no}-1`, method: 'RT', extent: v ? 'Spot (UW-52)' : 'Full (PW-11)', welds: welds.filter(w => w.nde.startsWith('RT')).map(w => w.id), examiner: 'B. Kaminski', level: 'II', date: d(72), result: 'Accept' },
      ...(v ? [] : [{ report: `UT-${project.no}-1`, method: 'UT', extent: 'Full', welds: ['C1', 'C3'], examiner: 'B. Kaminski', level: 'II', date: d(73), result: 'Accept' }]),
      { report: `MT-${project.no}-1`, method: 'MT', extent: 'Full', welds: welds.filter(w => w.category === 'D').map(w => w.id), examiner: 'R. Ellis', level: 'II', date: d(73), result: 'Accept' }],
    pwht: { required: false, basis: v ? 'P-No. 1 at 1/2" nominal thickness, below 1-1/2" (UCS-56 Table, Note 2)' : 'P-No. 1, all welds 5/8" or thinner (PW-39, Table PW-39-1 exemption)' },
    hydro: { psi: v ? 130 : 225, temp_f: 70, hold_min: 30, date: htDate, gauge: '0-600 psi, calibrated ' + iso(-200), witnessed_by: 'J. Peterson, Authorized Inspector', result: 'No leaks, no permanent distortion' },
  };
}

// Hydro test, mill test reports for the plates/tubes, and the ASME record package with every part linked.
async function qcDocs(project) {
  const htDate = iso(-project.orderAgo + 82);
  const hydroPsi = project.vessel ? 130 : 225; // 1.3 × MAWP (UG-99) / 1.5 × MAWP (PG-99)
  await api('POST', '/api/qc-records', { project_id: project.id, test_type: 'Hydro Test', result: 'pass', tested_on: htDate, inspector: 'Diane Morgan', reference_no: `HT-${project.no}`,
    notes: `Tested at ${hydroPsi} psi (${project.vessel ? '1.3' : '1.5'} × MAWP), held 30 min, examined at MAWP. No leaks. Witnessed by the Authorized Inspector.` });
  const certs = [];
  for (const line of project.lines.filter(l => ['plate', 'pipe'].includes(CAT[l.name]) && l.mfg)) {
    const plate = CAT[line.name] === 'plate';
    const c = await api('POST', '/api/test-certificates', {
      certificate_no: `MTR-${project.id}${line.id}`, cast_no: `C${project.id}${line.id}7`, heat_no: `H${project.id}${line.id}A`, plate_no: plate ? `P${line.id}` : undefined,
      // Strengths stay metric (MPa) like every stored value; the ASME package prints ksi.
      material_spec: plate ? 'SA-516 GR. 70' : /STAY/.test(line.name) ? 'SA-192' : 'SA-178 GR. A', steel_maker: plate ? 'Ohio Valley Plate Mill' : 'Great Lakes Tube Mill',
      size_t: plate ? (/5\/8/.test(line.name) ? '15.9' : '12.7') : /STAY/.test(line.name) ? '6.35' : '2.67', chem_c: '0.21', chem_mn: '1.05', chem_p: '0.018', chem_s: '0.012', chem_si: '0.28',
      ys: '290', uts: '510', elongation: '24', bend_test: 'Satisfactory', certificate_date: iso(-project.orderAgo + 20), inspecting_authority: 'Mill test report (EN 10204 3.1)',
      project_ids: [project.id],
    });
    certs.push(c.id);
  }
  const cap = project.capacity, hp = project.hp;
  // Header fields stored metric (kg/cm², mm, m², kg/hr, °C); the ASME package prints psi, in, sq ft, lb/hr, °F.
  const doc = await api('POST', '/api/qc-documents', {
    project_id: project.id, company: COMPANY, ibr_version: 'asme', doc_id: `ABH-${project.no}`, makers_no: project.no, year_of_make: Number(iso(0).slice(0, 4)),
    design_pressure: project.vessel ? 7.03 : 10.55, hydro_test_pressure: project.vessel ? 9.14 : 15.82, hydro_test_date: htDate, working_pressure: project.vessel ? 7.03 : 10.55,
    boiler_type: project.vessel ? 'Horizontal deaerator storage tank on saddles' : 'Scotch marine firetube, dry back, three pass',
    length_overall: String(project.vessel ? 6400 : Math.round(4300 + hp * 9)), internal_diameter: String(project.vessel ? 1829 : Math.round(1700 + hp * 2.4)),
    heating_surface: project.vessel ? '' : Math.round(hp * 5 * 0.0929), evaporation_capacity: project.vessel ? '' : cap, steam_temp: project.vessel ? 121 : 186,
    drawing_no: `${project.no}-GA-01`, signer_name: 'Diane Morgan',
  });
  await q('UPDATE qc_documents SET asme_data = ? WHERE id = ?', [JSON.stringify(asmeData(project, htDate)), doc.id]);
  const parts = (await q('SELECT id FROM qc_document_parts WHERE document_id = ?', [doc.id])).map(r => r.id);
  if (parts.length && certs.length) await api('POST', `/api/qc-documents/${doc.id}/link-parts`, { part_ids: parts, test_certificate_id: certs[0] });
  // Bought-out items (valves, gauges): pulled from the BOM and covered by the makers' certificate.
  await api('POST', `/api/qc-documents/${doc.id}/sync-mountings`, {});
  const mountings = (await q('SELECT id FROM qc_mountings WHERE document_id = ?', [doc.id])).map(r => r.id);
  if (mountings.length) {
    const mc = await api('POST', '/api/test-certificates', { certificate_no: `VC-${project.id}`, cast_no: `V${project.id}`, material_spec: 'ASME B16.34 / Section I PG-67', steel_maker: 'Shield Valve Corp.', certificate_date: iso(-project.orderAgo + 30), project_ids: [project.id] });
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
  for (const [i, id] of lists.entries()) {
    // E-way bill and freight (E-Way Bill Register, Freight Cost Summary); one trailer's cost split over a shipment's lists.
    // Freight (Freight Cost Summary); one flatbed's cost split over a shipment's lists. No e-way bill in the US.
    await api('PATCH', `/api/packing/${id}`, { status: 'packed', transport_mode: 'road', vehicle_no: `OH TRL ${2200 + project.id}`, dispatch_through: 'Midwest Heavy Haul',
      transport_distance_km: 640, freight_amount: Math.round((3200 + project.hp * 6) / lists.length), freight_paid_by: 'us' });
    await api('POST', `/api/packing/${id}/submit-for-approval`, {});
    // Production's sign-off usually came with the handover; QC signs here.
    const [a] = await q('SELECT id, qc_decision, production_decision FROM pre_dispatch_approvals WHERE packing_list_id = ? ORDER BY id DESC LIMIT 1', [id]);
    for (const role of ['qc', 'production']) if (!a[`${role}_decision`]) await api('POST', `/api/pre-dispatch-approvals/${a.id}/decide`, { decision: 'approved', role });
  }
  if (lists.length > 1) await api('POST', '/api/shipments', { list_ids: lists, vehicle_no: `OH TRL ${2200 + project.id}`, dispatch_through: 'Midwest Heavy Haul', note: 'Flatbed, tank on saddles, oversize permit' });
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
        customer_name: project.customer, site_address: CUSTOMERS.find(c => c[0] === project.customer)[1], contact_person: 'Plant Engineer', contact_no: usPhone(project.customer, '920'),
        equipment_type: project.vessel ? 'Deaerator storage tank' : 'Steam boiler', model: project.code, capacity: project.vessel ? '1,500 gal' : `${project.hp} HP (${Math.round(project.capacity * 2.2046).toLocaleString('en-US')} lb/hr)`, year_of_make: iso(0).slice(0, 4),
        serial_no: project.no, fuel_type: project.vessel ? 'n/a' : project.series === 'OF' ? 'Natural gas' : 'Natural gas / No. 2 oil', design_pressure: project.vessel ? '100 psi' : '150 psi', working_pressure: project.vessel ? '15 psi' : '125 psi',
        commissioning_date: iso(at + 5), inspector: 'Nicole Grant', customer_remarks: project.vessel ? 'Tank in service, levels and pressure control set. Operators trained.' : 'Boiler started up and running at rated output. Operators trained.',
      },
      tables: { erection: ok([['Foundation level & alignment (in)', 'Per GA drawing'], ['Safety valve installation & testing', 'Set and sealed'], ['Water level gauges installed & functional', '2 min.']]) },
    },
  });
  await api('PATCH', `/api/installation-reports/${r.id}`, { action: 'finalize' });
  const call = await api('POST', '/api/service-calls', { project_id: project.id, customer_name: project.customer, contact_person: 'Plant Engineer', contact_phone: usPhone(project.customer, '920'),
    subject: 'Feed pump noisy at start-up', description: 'Pump makes a grinding noise for the first minute after start.', priority: 'medium', sla_hours: 48 });
  await api('POST', `/api/service-calls/${call.id}/visits`, { visit_date: iso(at + 40), technician: 'Nicole Grant', notes: 'Coupling realigned, bearing greased. Running quietly.' });
}

// Invoice from the accepted quotation, issued, then paid in full or in part. The same money is logged
// twice, as in real use: Accounts' receipts against the invoice, Sales' payment tracker against the order
// (30% advance a few days after the order, the rest after the invoice).
async function invoice(project, paid) {
  const inv = await api('POST', `/api/quotations/${project.quotation}/convert-to-invoice`, { company: COMPANY, invoice_date: iso(-project.orderAgo + 90), due_date: iso(-project.orderAgo + 120) });
  await api('PATCH', `/api/sales-invoices/${inv.id}`, { status: 'issued' });
  const [{ total }] = await q('SELECT total FROM sales_invoices WHERE id = ?', [inv.id]);
  const advance = Math.round(total * 0.3), rest = Math.round(total * paid) - advance;
  await api('POST', `/api/sales-invoices/${inv.id}/receipts`, { amount: advance, payment_mode: 'ACH', receipt_date: iso(-project.orderAgo + 97), reference: `ACH-${project.id}01` });
  if (rest > 0) await api('POST', `/api/sales-invoices/${inv.id}/receipts`, { amount: rest, payment_mode: 'Wire', receipt_date: iso(-project.orderAgo + 125), reference: `WIRE-${project.id}02` });
  await orderPayment(project, advance, -project.orderAgo + 5, 'Deposit with order');
  if (rest > 0) await orderPayment(project, rest, -project.orderAgo + 125, 'Balance against invoice', inv.id);
  return inv.id;
}
async function orderPayment(project, amount, day, remark, sales_invoice_id) {
  await api('POST', '/api/sale-order-payments', { sale_order_id: project.so, sales_invoice_id, amount, received_on: iso(day), mode: 'ACH', remark });
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
    ['Sales', 'Marketing', 'Call Metro Health System on the 350 HP estimate', 0], ['Marketing', 'Sales', 'Send the Steam Expo lead list to Sales', 1],
    ['Design', 'Engineering', `Revise tube layout for ${projects[4].no}`, 0], ['Engineering', 'Design', `Check BOM weights for ${projects[3].no}`, 1],
    ['Procurement', 'Engineering', `Chase the safety valve quote for ${projects[3].no}`, 0], ['Stores', 'Procurement', `Receiving inspection for ${projects[3].no} plates`, 0],
    ['Production', 'QC', `Rework the rejected stay tube lot on ${projects[4].no}`, 0], ['QC', 'Production', `Hydro test with the AI for ${projects[4].no}`, 2],
    ['Dispatch', 'Sales', `Book a flatbed for ${projects[4].no}`, 5], ['Installation', 'Sales', `Plan the 3-month service visit at ${projects[0].customer}`, 1],
    ['Accounts', 'Sales', `Follow up the balance payment from ${projects[1].customer}`, 0], ['HR', 'Production', 'Two welder interviews this week (6G test)', 2],
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
    for (const s of staff) await api('POST', '/api/attendance', { employee_id: s.id, date: iso(d), status: 'present', in_time: '07:30', out_time: '16:30' });
  }
}

// Leave balances and requests (HR), supplier bills against the finished orders' POs (Accounts payables).
async function seedHrAndPayables(done, inProduction) {
  const types = await q("SELECT id, name FROM leave_types WHERE name NOT LIKE 'Unpaid%' ORDER BY id");
  const staff = await q("SELECT id FROM employees WHERE employee_code LIKE 'AB-E%' ORDER BY id");
  for (const s of staff) for (const t of types) await api('POST', '/api/leave-allocations', { employee_id: s.id, leave_type_id: t.id, year: Number(iso(0).slice(0, 4)), allocated: /earned/i.test(t.name) ? 15 : 12 });
  const past = await api('POST', '/api/leave-requests', { employee_id: staff[5].id, leave_type_id: types[0].id, from_date: iso(workday(-12)), to_date: iso(workday(-12)), reason: 'Family event' });
  await api('PATCH', `/api/leave-requests/${past.id}`, { status: 'approved' });
  await api('POST', '/api/leave-requests', { employee_id: staff[8].id, leave_type_id: types[0].id, from_date: iso(6), to_date: iso(7), reason: 'Long weekend trip' }); // waits for HR
  // Bills are approved (Purchase Register, Procurement Spend and payables count approved/paid only);
  // AB-1001's are paid. AB-1005's bills are dated this week, so the current month has purchases.
  for (const p of [...done, inProduction]) {
    const pos = await q("SELECT DISTINCT pi.po_id FROM po_items pi JOIN purchase_orders po ON po.id = pi.po_id WHERE pi.project_id = ? AND po.status = 'issued'", [p.id]);
    for (const [i, { po_id }] of pos.entries()) {
      const day = p === inProduction ? -Math.min(i, 4) : -p.orderAgo + 33;
      // Raw material for resale/manufacturing: no sales tax on the supplier's invoice (exemption certificate on file).
      const bill = await api('POST', `/api/purchase-orders/${po_id}/record-bill`, { bill_no: `INV-${p.id}${String(i + 1).padStart(3, '0')}`, bill_date: iso(day), due_date: iso(day + 30), gst_rate_pct: 0, company: COMPANY });
      await api('PATCH', `/api/vendor-bills/${bill.id}`, { status: 'approved' });
      if (p === done[0]) await api('PATCH', `/api/vendor-bills/${bill.id}`, { status: 'paid', payment_ref: `ACH-${p.id}${i + 1}` });
    }
  }

  // Payroll for last month: one salary structure, every staff login on it, the run submitted.
  const st = await api('POST', '/api/salary-structures', { name: 'Salaried staff (monthly)' });
  for (const c of [{ name: 'Health plan stipend', component_type: 'earning', amount: 250 }, { name: 'Phone allowance', component_type: 'earning', amount: 75 }]) {
    await api('POST', `/api/salary-structures/${st.id}/components`, c);
  }
  for (const [i, s] of staff.entries()) {
    await api('POST', '/api/salary-structure-assignments', { employee_id: s.id, salary_structure_id: st.id, base: i === 0 ? 11500 : 5400 + (i % 5) * 600, from_date: iso(-400) });
  }
  const last = new Date(Date.now() - (Number(iso(0).slice(8, 10)) + 1) * DAY);
  const run = await api('POST', '/api/payroll-runs', { period_month: last.getUTCMonth() + 1, period_year: last.getUTCFullYear() });
  await api('PATCH', `/api/payroll-runs/${run.id}`, { status: 'submitted' });
}

// Accounts: a spares invoice issued today, a service contract this week (Revenue (MTD) is not empty)
// and one manual journal entry.
async function seedAccounts(p1, p2) {
  const inv = await api('POST', '/api/sales-invoices', {
    customer_id: ids.customers[p1.customer], company: COMPANY, invoice_date: iso(0), due_date: iso(30), notes: `Spares for ${p1.no} after the service visit`,
    items: [{ item_description: 'Feed pump mechanical seal kit', qty: 2, uom: 'EA', rate: 640, gst_pct: TAX[p1.customer] },
      { item_description: 'Pump coupling with elastomer insert', qty: 1, uom: 'EA', rate: 185, gst_pct: TAX[p1.customer] }],
  });
  await api('PATCH', `/api/sales-invoices/${inv.id}`, { status: 'issued' });
  // A service contract this week too, so MTD sales outweigh the material AB-1005 drew (Net Profit (MTD) > 0).
  const amc = await api('POST', '/api/sales-invoices', {
    customer_id: ids.customers[p2.customer], company: COMPANY, invoice_date: iso(-4), due_date: iso(26), notes: `Annual service contract for ${p2.no}, first quarter`,
    items: [{ item_description: 'Annual service agreement, quarterly visit and water treatment check', qty: 1, uom: 'LOT', rate: 6200, gst_pct: TAX[p2.customer] },
      { item_description: 'Annual jurisdictional inspection assistance and hydro test', qty: 1, uom: 'LOT', rate: 4400, gst_pct: TAX[p2.customer] }],
  });
  await api('PATCH', `/api/sales-invoices/${amc.id}`, { status: 'issued' });
  await api('POST', '/api/journal-entries', { company: COMPANY, entry_date: iso(-1), description: 'Bank fees for wire transfers and the letter of credit',
    lines: [{ accountCode: '5400', debit: 145 }, { accountCode: '1001', credit: 145 }] });
}

// --- main ----------------------------------------------------------------------------------------
await login();
await seedPeople();
await seedMasters();
await seedStock();
await seedPipeline();

const p1 = await createProject('AB-1001', 'Great Lakes Dairy Cooperative', 'AB-FT-150', 150, 'Exhibition');
const p2 = await createProject('AB-1002', 'Riverside Paperboard Co.', 'AB-FT-250', 135, 'Website');
const p3 = await createProject('AB-1003', 'Bluewater Chemical Co.', 'AB-VR-1500', 120, 'Reference');
const p4 = await createProject('AB-1004', 'Northstar Paper Mills', 'AB-FT-350', 26, 'Exhibition');
const p5 = await createProject('AB-1005', 'Greenfield Foods Inc.', 'AB-FT-250', 49, 'Website');

for (const [name, machine_hour_rate] of WORKSTATIONS) await api('POST', '/api/workstations', { name, machine_hour_rate });

// Three complete orders, end to end.
for (const [p, paid] of [[p1, 1], [p2, 0.6], [p3, 0.3]]) {
  await procure(p);
  await receive(p, p.buy);
  for (const l of p.stock) await api('POST', `/api/bom-items/${l.id}/route-self`, { routed_to: l.mfg ? 'production' : 'dispatch' }).catch(() => {});
  await incomingQc(p);
  const cards = await produce(p);
  await jobSheet(p);
  await workOrder(p, cards, 'completed');
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
if (failed) await api('POST', '/api/ncrs', { project_id: p5.id, bom_item_id: stay.id, qc_record_id: failed.id, severity: 'major', description: 'Stay tube lot: wall thickness 0.232" against 0.250" specified on 4 of 12 lengths. Return to supplier.' });
const cards5 = await produce(p5, { done: 2, running: 1 });
// Rework / Rejection: one tube plate drilled off-pitch on the drilling card, re-done on a rework card.
const [drill] = await q('SELECT id, milestone_id, bom_item_id FROM job_cards WHERE id = ?', [cards5[1]]);
await api('PATCH', `/api/job-cards/${drill.id}`, { qty_planned: 2, qty_done: 2, qty_rejected: 1, notes: `${p5.no} drilling: 1 tube plate off-pitch, re-drilled on a rework card` });
const rework = await api('POST', '/api/job-cards', { milestone_id: drill.milestone_id, bom_item_id: drill.bom_item_id, qty_planned: 1, rework_of_job_card_id: drill.id,
  planned_start: iso(-6), planned_end: iso(-5), notes: `${p5.no} rework: re-drill tube plate` });
await api('PATCH', `/api/job-cards/${rework.id}`, { status: 'progress' });
await api('PATCH', `/api/job-cards/${rework.id}`, { status: 'done', qty_done: 1, qty_rejected: 0 });
await q("UPDATE job_cards SET updated_at = ? WHERE id IN (?, ?)", [stamp(-5), drill.id, rework.id]);
await jobSheet(p5, { signed: 10 }); // rolling and fit-up signed, RC tubesheet fit-up waiting for QC, shell welding started
await workOrder(p5, [...cards5, rework.id], 'in_progress');
// Material Utilization: a 10 mm plate cut for AB-1005's saddles, the off-cut kept as a remnant.
// Stored metric: a 3/8" x 60" x 240" plate.
const [plate10] = await q("SELECT id FROM inventory_items WHERE description = ?", [PLATE10]);
const piece = await api('POST', '/api/stock-pieces', { inventory_item_id: plate10.id, kind: 'plate', length_mm: 6096, width_mm: 1524, thickness_mm: 9.525, heat_no: 'H38A2201' });
await api('POST', `/api/stock-pieces/${piece.id}/reserve`, { project_id: p5.id });
await api('POST', `/api/stock-pieces/${piece.id}/cut`, { project_id: p5.id, job_card_id: cards5[2], note: 'Saddles and end-box plates',
  used: [{ length_mm: 3658, width_mm: 1524 }], remnants: [{ length_mm: 2438, width_mm: 1524 }] });
for (const r of await q("SELECT id FROM stock_pieces WHERE parent_id = ? AND status = 'pending_receipt'", [piece.id])) {
  await api('POST', `/api/stock-pieces/${r.id}/confirm-receipt`, {}); // Stores takes the remnant back into stock
}
const plate8 = p5.lines.find(l => l.name === PLATE16);
await api('POST', '/api/material-indents', { project_id: p5.id, items: [{ bom_item_id: plate8.id, qty_requested: 920 }], notes: 'Furnace and tubesheet plates for box-up' }).catch(e => console.warn('indent:', e.message));
await setMilestones(p5, 'shell_welding');
// Shell welding is three days late (the stay-tube lot was rejected): Executive "Needs your attention".
await q(`UPDATE milestones SET planned_end = ?, delay_category = 'Material', delay_reason = 'Stay tube lot rejected at incoming inspection; replacement due from supplier'
         WHERE project_id = ? AND milestone_key = 'shell_welding'`, [iso(-3), p5.id]);
// AB-1004: in Procurement (after AB-1005: a supplier's open draft PO is shared across projects, so AB-1005's
// orders would otherwise pick up and issue AB-1004's draft). Lines spread over every buying stage; two received lines wait for Stores' inward approval.
// By item, so each supplier's PO has one state: plates received (awaiting inward approval), tubes in transit,
// the safety valve on a draft PO, other valves and the pump at quote comparison, two lines left for the RFQ.
const P4_STAGE = { [PLATE12]: 'received', [PLATE16]: 'received', [ANGLE]: 'received', [TUBE]: 'transit', [STAY]: 'transit',
  [PIPE]: 'transit', [SV]: 'draft', [MSV]: 'comparison', [FCV]: 'comparison', [PUMP]: 'comparison',
  [BDV]: 'enquiry', [PG]: 'enquiry' };
await procure(p4, l => P4_STAGE[l.name] || 'ordered');
await receive(p4, p4.buy.filter(l => l.stage === 'received'), { approve: false });
const rfqLines = p4.buy.filter(l => l.stage === 'enquiry').map(l => l.id);
if (rfqLines.length) await api('POST', '/api/rfqs', { bom_item_ids: rfqLines, supplier_ids: [ids.suppliers['Shield Valve Corp.'], ids.suppliers['Unity Fastener Supply']], company: COMPANY });
await setMilestones(p4, 'procurement_ordered');

for (const p of [p4, p5]) {
  await q('UPDATE projects SET created_at = ? WHERE id = ?', [stamp(-p.orderAgo + 1), p.id]);
  await q('UPDATE sale_orders SET created_at = ? WHERE id = ?', [stamp(-p.orderAgo), p.so]);
}

const projects = [p1, p2, p3, p4, p5];
// Open orders: the 30% deposit is in; the PM login owns every project.
for (const p of [p4, p5]) {
  const [{ total }] = await q('SELECT total FROM sale_orders WHERE id = ?', [p.so]);
  await orderPayment(p, Math.round(total * 0.3), -p.orderAgo + 5, 'Deposit with order');
}
await q("UPDATE projects SET owner = 'manager' WHERE project_no LIKE 'AB-%'");
await seedTasks(projects);
await seedAttendance();
await seedHrAndPayables([p1, p2, p3], p5);
await seedAccounts(p1, p2);

// India-only masters that migrate() seeds in every deployment: the US build never reads them. US federal holidays
// replace the Indian ones; staff are paid in dollars with no Indian professional-tax state.
await q('DELETE FROM income_tax_slabs'); await q('DELETE FROM professional_tax_slabs'); await q('DELETE FROM holidays');
const holCols = (await q('PRAGMA table_info(holidays)')).map(c => c.name);
for (const [date, name] of [['2026-01-01', "New Year's Day"], ['2026-05-25', 'Memorial Day'], ['2026-07-03', 'Independence Day (observed)'],
  ['2026-09-07', 'Labor Day'], ['2026-11-26', 'Thanksgiving Day'], ['2026-11-27', 'Day after Thanksgiving'], ['2026-12-25', 'Christmas Day'],
  ['2027-01-01', "New Year's Day"], ['2027-05-31', 'Memorial Day'], ['2027-07-05', 'Independence Day (observed)'], ['2027-09-06', 'Labor Day'],
  ['2027-11-25', 'Thanksgiving Day'], ['2027-11-26', 'Day after Thanksgiving'], ['2027-12-24', 'Christmas Day (observed)']]) {
  await q(`INSERT INTO holidays (${holCols.includes('holiday_date') ? 'holiday_date' : 'date'}, name) VALUES (?, ?)`, [date, name]);
}
await q("UPDATE employees SET salary_currency = 'USD', pt_state = ''");

// The nightly reset shifts every date by (today − seeded_on): workers/demo-reset-cron.
await db.batch(['CREATE TABLE IF NOT EXISTS demo_meta (seeded_on TEXT NOT NULL)', 'DELETE FROM demo_meta', { sql: 'INSERT INTO demo_meta VALUES (?)', args: [iso(0)] }], 'write');

// Row counts: every table the walkthrough relies on must have rows.
const MUST = ['users', 'employees', 'customers', 'suppliers', 'leads', 'crm_notes', 'campaigns', 'opportunities', 'quotations', 'quotation_items',
  'sale_orders', 'sale_order_items', 'projects', 'scope_of_supply_items', 'milestones', 'calc_sheets', 'calc_drawings', 'bom_items', 'supplier_quotes',
  'purchase_orders', 'rfqs', 'gate_inward_receipts', 'stock_receipts', 'inward_approvals', 'material_issues', 'material_indents', 'qc_records', 'ncr_records',
  'job_cards', 'production_handovers', 'test_certificates', 'qc_documents', 'qc_document_parts', 'packing_lists', 'pre_dispatch_approvals', 'shipments',
  'installation_visits', 'installation_reports', 'service_calls', 'sales_invoices', 'customer_receipts', 'sale_order_payments', 'tasks', 'attendance_days', 'leave_requests', 'vendor_bills', 'journal_entries',
  'job_sheets', 'job_sheet_stages', 'work_orders', 'work_order_operations', 'job_card_time_logs', 'stock_pieces', 'calc_snapshots', 'payroll_runs', 'salary_slips'];
const counts = {};
for (const t of MUST) counts[t] = (await q(`SELECT COUNT(*) n FROM ${t}`))[0].n;
console.table(counts);
const empty = MUST.filter(t => !counts[t]);
if (empty.length) { console.error('EMPTY:', empty.join(', ')); process.exit(1); }
console.log('US Acme demo data seeded:', projects.map(p => `${p.no}=${p.id}`).join(' '));
