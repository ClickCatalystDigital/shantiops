// lib/eway-readiness.mjs — the e-way bill prerequisites as a checklist (pure, no DB). The same list
// drives the Generate card's tick-list and the POST route's refusal, so the screen and the server can
// never disagree. Each item: { key, ok, label, fix, where } — `where` says who fixes it:
// 'here' (Dispatch, on this packing list), 'invoice', 'customer', 'company', 'admin'.
// Run: node lib/eway-readiness.mjs  (self-check at the bottom)

const CUSTOMER_FIELDS = { gst_no: 'GSTIN', state_code: 'State', pin_code: 'Pincode', address: 'Address' };
const COMPANY_FIELDS = { gstin: 'GSTIN', state_code: 'State', registered_address: 'Registered address', place: 'Place', pincode: 'Pincode' };

export function ewayReadiness({ list, customer, company, invoice, invoiceItems = [], hasCredentials, nicConfigured }) {
  const out = [];
  const add = (key, ok, label, fix, where) => out.push({ key, ok: !!ok, label, fix: ok ? null : fix, where });

  const dist = Number(list.transport_distance_km);
  add('distance', dist > 0 && dist <= 4000, 'Transport distance (km)',
    dist > 4000 ? 'Distance cannot exceed 4000 km (NIC’s own limit).' : 'Enter the approximate road distance in km.', 'here');
  add('mode', list.transport_mode && list.vehicle_type, 'Transport mode and vehicle type', 'Choose the transport mode and vehicle type.', 'here');

  add('invoice', list.sales_invoice_id && invoice && ['issued', 'paid'].includes(invoice.status), 'Issued sales invoice linked',
    list.sales_invoice_id ? 'The linked invoice is still a draft - issue it in Sales first.' : 'Link the sales invoice for this shipment (NIC needs its number, date and value).', 'here');
  if (invoice && ['issued', 'paid'].includes(invoice.status)) {
    const noHsn = invoiceItems.filter(li => !li.hsn_code);
    add('items', invoiceItems.length > 0 && noHsn.length === 0, 'Invoice lines have HSN codes',
      invoiceItems.length ? `Add an HSN code on the invoice for: ${noHsn.map(li => li.item_description).join(', ')}.` : 'The linked invoice has no line items.', 'invoice');
  }

  if (!list.project_id) {
    add('customer', false, 'Customer details (GSTIN, state, pincode, address)', 'This list has no project, so there is no customer record. Link it to a project with a customer, or generate the e-way bill from a project list.', 'here');
  } else if (!list.customer_id) {
    add('customer', false, 'Customer details (GSTIN, state, pincode, address)', 'The project has no linked customer record - link a customer to the project.', 'customer');
  } else {
    const missing = Object.keys(CUSTOMER_FIELDS).filter(f => !customer?.[f]);
    add('customer', missing.length === 0, 'Customer details (GSTIN, state, pincode, address)',
      `The customer record is missing: ${missing.map(f => CUSTOMER_FIELDS[f]).join(', ')}. Fill these in on the customer.`, 'customer');
  }

  if (!list.company) {
    add('company', false, 'Our company details', 'This list has no company - pick one in Edit details.', 'here');
  } else {
    const missing = Object.keys(COMPANY_FIELDS).filter(f => !company?.[f]);
    add('company', missing.length === 0, `${list.company} details (GSTIN, address, place, pincode)`,
      `${list.company} is missing: ${missing.map(f => COMPANY_FIELDS[f]).join(', ')}. Fill these in under Accounts > Company Settings.`, 'company');
  }

  add('credentials', hasCredentials, 'NIC credentials saved for this company',
    'Enter the NIC Client ID / Secret / API user / password under Accounts > Company Entities (needs NIC e-way bill API registration first).', 'admin');
  add('nic', nicConfigured, 'E-way bill server connection set up',
    'Your technical team must set the NIC server address and key on this system. Saved credentials are not the problem.', 'admin');
  return out;
}

// Items Dispatch can fix on the list itself must pass before the button enables; admin items are
// shown as blockers too but the message differs, so callers can tell them apart.
export const firstProblem = checks => checks.find(c => !c.ok) || null;

if (process.argv[1] && process.argv[1].endsWith('eway-readiness.mjs')) {
  const assert = (await import('node:assert')).default;
  const base = {
    list: { transport_distance_km: 300, transport_mode: 'road', vehicle_type: 'regular', sales_invoice_id: 1, project_id: 1, customer_id: 2, company: 'Demo Co' },
    customer: { gst_no: 'G', state_code: '36', pin_code: '500001', address: 'x' },
    company: { gstin: 'G', state_code: '36', registered_address: 'a', place: 'p', pincode: '5' },
    invoice: { status: 'issued' }, invoiceItems: [{ item_description: 'Boiler', hsn_code: '8402' }],
    hasCredentials: true, nicConfigured: true,
  };
  assert.equal(firstProblem(ewayReadiness(base)), null);
  const bad = (patch, key) => assert.equal(firstProblem(ewayReadiness({ ...base, ...patch }))?.key, key);
  bad({ list: { ...base.list, transport_distance_km: null } }, 'distance');
  bad({ list: { ...base.list, transport_distance_km: 5000 } }, 'distance');
  bad({ list: { ...base.list, vehicle_type: null } }, 'mode');
  bad({ invoice: { status: 'draft' } }, 'invoice');
  bad({ invoiceItems: [{ item_description: 'Boiler', hsn_code: '' }] }, 'items');
  bad({ customer: { ...base.customer, pin_code: '' } }, 'customer');
  bad({ list: { ...base.list, project_id: null, customer_id: null } }, 'customer');
  bad({ company: { ...base.company, place: null } }, 'company');
  bad({ hasCredentials: false }, 'credentials');
  bad({ nicConfigured: false }, 'nic');
  console.log('eway-readiness selfcheck ok');
}
