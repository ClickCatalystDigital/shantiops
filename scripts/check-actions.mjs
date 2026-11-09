// Ember AI actions end to end: for every action, a sentence → the card it fills (no model) → Save through
// /api/assistant/act → the app's own route. Plus refusals (a department that may not, a missing field, a bad record).
// Run against a SCRATCH copy of the demo DB only — it writes. Usage:
//   BASE=http://localhost:3080 PASS=<scratch password> DB=<path to that scratch sqlite file> node scripts/check-actions.mjs [only_action_key ...]
// DB: a few records the demo data lacks (a discount waiting for approval, an ECN, an applicant, service expenses at each
// step, a job card on QC hold, a returned piece, a draft service report) are added with the sqlite3 CLI first.
// Also a role check: the actions each kind of login is offered (department staff, a non-head, a manager, admin).
import { execFileSync } from 'node:child_process';
const BASE = process.env.BASE || 'http://localhost:3080', PASS = process.env.PASS;
if (!PASS) { console.error('PASS (the scratch copy password) is required'); process.exit(1); }
const only = process.argv.slice(2);
const FIXTURES = `
UPDATE quotations SET approval_status = 'pending' WHERE quotation_no LIKE 'QTN-8/%';
INSERT INTO bom_change_notes (project_id, bom_item_id, field_changed, old_value, new_value, reason, status, requested_by)
  SELECT project_id, id, 'make', '', 'Kirloskar', 'Customer asked for this make', 'pending', 'engg_head' FROM bom_items WHERE material_description LIKE 'FEED PUMP 3 HP%' LIMIT 1;
INSERT INTO job_openings (title, department, status) VALUES ('Welder', 'Production', 'open');
INSERT INTO job_applicants (job_opening_id, name, status) SELECT MAX(id), 'Ravi Kulkarni', 'applied' FROM job_openings;
INSERT INTO service_expense_requests (req_no, kind, status, requested_by, requester_name, form_date, amount) VALUES
  ('CR-9001', 'cash', 'pending_manager', 'service_head', 'Service Head', '2026-11-01', 5000),
  ('CR-9002', 'cash', 'pending_executive', 'service_head', 'Service Head', '2026-11-02', 3000),
  ('CR-9003', 'cash', 'with_accounts', 'service_head', 'Service Head', '2026-11-03', 2000);
UPDATE job_cards SET requires_qc_hold = 1, qc_released_at = NULL WHERE jc_no = 'JC-1025';
INSERT INTO stock_pieces (inventory_item_id, code, kind, length_mm, width_mm, thickness_mm, weight_kg, status, source)
  SELECT inventory_item_id, 'PL-H10M2201-001-R9', 'plate', 500, 400, 10, 15.7, 'pending_receipt', 'remnant' FROM stock_pieces WHERE code = 'PL-H10M2201-001-R1';
INSERT INTO stock_pieces (inventory_item_id, code, kind, length_mm, width_mm, thickness_mm, weight_kg, status, source)
  SELECT inventory_item_id, 'PL-H10M2201-001-R8', 'plate', 600, 400, 12, 22.6, 'available', 'remnant' FROM stock_pieces WHERE code = 'PL-H10M2201-001-R1';
UPDATE packing_lists SET delivery_ack_status = NULL, delivery_ack_at = NULL WHERE packing_no = 'PL-1004';
INSERT INTO installation_reports (report_no, project_id, call_type, report_date, data_json, created_by)
  SELECT 'FSR-9001', project_id, 'Breakdown', '2026-11-05', '{}', 'service_head' FROM installation_reports LIMIT 1;
`;
if (process.env.DB && !only.length) execFileSync('sqlite3', [process.env.DB, FIXTURES]);
const jars = {};
async function login(u) {
  if (jars[u]) return jars[u];
  const r = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: PASS }) });
  if (!r.ok) throw new Error(`login ${u}: ${r.status}`);
  return (jars[u] = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; '));
}
const post = async (u, body) => {
  const r = await fetch(`${BASE}/api/assistant/act`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: await login(u) }, body: JSON.stringify(body) });
  return r.json();
};
const call = async (u, method, path, body) => {
  const r = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', cookie: await login(u) }, body: body && JSON.stringify(body) });
  return r.json().catch(() => ({}));
};

// expect: field → exact value, or /regex/ against the card's display or value. fix: values the person would type on the card.
// as: who saves (default admin). refuse: the save must fail with an error matching this.
const CASES = [
  { action: 'add_enquiry', text: 'add an enquiry from Lotus Breweries, phone 98450 11223, expected value 18 lakh', expect: { lead_name: 'Lotus Breweries', phone: '9845011223', expected_value: 1800000 } },
  { action: 'log_followup', text: 'spoke to Metro Hospital Trust, they want the revised offer by Friday', expect: { lead_id: /Metro Hospital/, note_type: 'call' } },
  { action: 'set_enquiry_stage', text: 'move the Harvest Rice Mills hot lead to proposals', expect: { sales_call_status: 'Proposals' }, fix: { lead_id: 3 } },
  { action: 'assign_enquiry', text: 'assign the Kaveri Pharma follow up enquiry to Rohan', expect: { assigned_to: 'sales_head' }, fix: { lead_id: 2 } },
  { action: 'set_enquiry_value', text: 'Metro Hospital Trust enquiry is worth 42 lakh', expect: { lead_id: /Metro/, expected_value: 4200000 } },
  { action: 'add_customer', text: 'add customer Deccan Agro Foods, email accounts@deccanagro.example', expect: { name: 'Deccan Agro Foods', email: 'accounts@deccanagro.example' } },
  { action: 'quotation_sent', text: 'mark QTN-7 as sent', expect: { quotation_id: /QTN-7/ } },
  { action: 'quotation_rejected', text: 'Metro Hospital said no to QTN-1', expect: { quotation_id: /QTN-1\// } },
  { action: 'quotation_accepted', text: 'Greenfield accepted QTN-7', expect: { quotation_id: /QTN-7/ } },
  { action: 'record_order_payment', text: 'received 2.5 lakh from Northstar against SO-4 by NEFT', expect: { sale_order_id: /SO-4/, amount: 250000, mode: 'NEFT' } },
  { action: 'start_milestone', text: 'site marking started on AB-1005', expect: { milestone_id: /Site Marking · AB-1005/ } },
  { action: 'close_milestone', text: 'shell welding is done on AB-1005', expect: { milestone_id: /Shell Welding · AB-1005/ } },
  { action: 'send_back_milestone', text: 'send Release All Drawings on AB-1004 back for rework', expect: { milestone_id: /Release All Drawings · AB-1004/ }, fix: { reason: 'Nozzle orientation changed by customer' } },
  { action: 'add_task', text: 'add a task to check the hydro pump calibration by Friday', expect: { title: /hydro pump calibration/i }, fix: { department: 'Production' } },
  { action: 'raise_request', text: 'ask Stores to keep two BQ plates for AB-1005 by tomorrow', expect: { department: 'Stores', project_id: /AB-1005/ }, fix: { from_department: 'Production' } },
  { action: 'complete_task', text: 'the BOM weights check for AB-1004 is done', expect: { task_id: /BOM weights/ } },
  { action: 'add_supplier', text: 'add supplier Shree Valves, phone 9822001122', expect: { name: 'Shree Valves', phone: '9822001122' } },
  { action: 'record_supplier_quote', text: 'Prime Steel Traders quoted 68 per kg for the BQ plate 16 mm on AB-1004', expect: { supplier_id: /Prime Steel/, unit_price: 68, uom: 'Kg' }, fix: { bom_item_id: 'BQ PLATE 16 MM AB-1004' } },
  { action: 'issue_po', text: 'issue purchase order 123/AB/2026-27', expect: { po_id: /123\/AB/ } },
  { action: 'log_gate_entry', text: 'truck KA 01 AB 4321 arrived from Prime Steel Traders with plates', expect: { vehicle_no: 'KA 01 AB 4321', supplier_name: 'Prime Steel Traders' } },
  { action: 'issue_material', text: 'issue 2 nos of MS angle 50 x 50 to production for AB-1004', expect: { qty: 2 }, fix: { bom_item_id: 'MS ANGLE 50 X 50 X 6 MM AB-1004' } },
  { action: 'approve_inward', text: 'approve the 12 mm BQ plate on inward inspection', expect: { approval_id: /BQ PLATE 12 MM/ } },
  { action: 'reject_inward', text: 'reject the MS angle that came in, it is bent', expect: { approval_id: /MS ANGLE/ }, fix: { reason: 'Bent on arrival' } },
  { action: 'add_qc_record', text: 'hydro test passed on AB-1003', expect: { project_id: /AB-1003/, test_type: /Hydro/i, result: 'pass' } },
  { action: 'set_qc_result', text: 'change the incoming inspection on AB-1001 to fail', expect: { result: 'fail' }, fix: { record_id: 'pick' } },
  { action: 'raise_ncr', text: 'raise a major NCR on AB-1005: weld porosity on shell seam', expect: { project_id: /AB-1005/, severity: 'major' } },
  { action: 'start_jobcard_stage', text: 'start marking on shell for JC-1029, fitter Vikram Rao', expect: { stage_id: /MARKING ON SHELL/, fitter_employee_id: /Vikram/ } },
  { action: 'finish_jobcard_stage', text: 'shell belt welding is finished on JC-1029', expect: { stage_id: /SHELL BELT/ } },
  { action: 'mark_attendance', text: 'Priya Nair is absent today', expect: { employee_id: /Priya/, status: 'absent' } },
  { action: 'apply_leave', text: 'casual leave for Ananya Iyer from 12 Nov to 13 Nov', expect: { employee_id: /Ananya/, leave_type_id: /Casual/, from_date: '2026-11-12', to_date: '2026-11-13' } },
  { action: 'log_service_visit', text: 'plan a commissioning visit to AB-1001 on 20 Nov', expect: { project_id: /AB-1001/, visit_date: '2026-11-20', status: 'planned' } },
  // Dispatch: a fresh list goes packed → submitted → approved by QC and Production; a second draft is deleted.
  { setup: async () => { const r = await call('admin', 'POST', '/api/packing', { customer_name: 'Ember Check Pvt Ltd', project_id: null }); return r.packing_no; },
    action: 'set_packing_status', text: v => `mark packing list ${v} packed`, expect: { status: 'packed' } },
  { action: 'submit_packing_approval', text: v => `submit ${v} for dispatch approval`, carry: true },
  { action: 'decide_predispatch', text: v => `approve ${v} for dispatch`, expect: { decision: 'approved' }, carry: true, as: 'qc_head' },
  { action: 'decide_predispatch', text: v => `production approves ${v} for dispatch`, expect: { decision: 'approved' }, carry: true, as: 'production_head', fill_as: 'admin' },
  { setup: async () => (await call('admin', 'POST', '/api/packing', { customer_name: 'Ember Mistake Ltd' })).packing_no,
    action: 'delete_packing_list', text: v => `delete draft packing list ${v}` },
  { action: 'delete_qc_record', text: 'delete the hydro test record on AB-1003', fix: { record_id: 'pick' } }, // two hydro records there: the card asks
  { action: 'cancel_po', text: 'cancel purchase order 123/AB/2026-27, not needed', expect: { po_id: /123\/AB/ } },
  { action: 'delete_enquiry', text: 'delete the Lotus Breweries enquiry, it was a duplicate', expect: { lead_id: /Lotus/ } },
  // ---- added 2026-11-08 ----
  { action: 'edit_enquiry_contact', text: 'Metro Hospital Trust enquiry: the phone number is 98450 22334', expect: { lead_id: /Metro/, phone: '9845022334' } },
  { action: 'add_crm_task', text: 'add a follow-up to send the Kaveri Pharma brochure by Friday', fix: { lead_id: 'pick' } }, // two Kaveri enquiries in the demo: the card asks
  { action: 'complete_crm_task', text: 'the Kaveri Pharma brochure follow-up is done', expect: { task_id: /brochure/i } },
  { action: 'set_opportunity_stage', text: 'move the second boiler for the new plant opportunity to hot offers', expect: { opportunity_id: /Second boiler/, stage: 'Hot Offers' } },
  { action: 'convert_enquiry', text: 'make the Harvest Rice Mills enquiry a customer', fix: { lead_id: 'pick' } },
  { action: 'close_sales_call', text: 'close the sales call on Harvest Rice Mills', fix: { lead_id: 'pick' } },
  { action: 'approve_quotation_discount', text: 'approve the discount on QTN-8', expect: { quotation_id: /QTN-8/ }, as: 'sales_head' },
  { action: 'convert_quotation_to_order', text: 'make a sale order from QTN-8', expect: { quotation_id: /QTN-8/ } },
  { action: 'set_order_status', text: 'mark SO-4 as ready', expect: { sale_order_id: /SO-4/, track_status: 'Ready' } },
  { action: 'record_invoice_receipt', text: 'received 50,000 against invoice AB/2/2026-27 by NEFT', expect: { invoice_id: /AB\/2\//, amount: 50000, payment_mode: 'NEFT' }, as: 'accounts_head' },
  { action: 'create_project', text: 'create a project for Lotus Breweries', expect: { customer_name: 'Lotus Breweries' }, as: 'design_head', refuse: /already exists/i }, // the demo's project counter is behind its data: the screen hits the same
  { action: 'release_bom', text: 'release the BOM of SO-5', expect: { project_id: /SO-5/ }, as: 'engg_head' },
  { action: 'set_ecn_status', text: 'approve the change note on the feed pump for AB-1004', expect: { ecn_id: /FEED PUMP|make/, status: 'approved' }, as: 'engg_head' },
  { action: 'cancel_bom_line', text: 'cancel the blow down valve line on AB-1004, not needed', expect: { bom_item_id: /BLOW DOWN VALVE/ }, as: 'engg_head' },
  { action: 'raise_pr_for_line', text: 'send the pressure gauge on AB-1004 to procurement', expect: { bom_item_id: /PRESSURE GAUGE/ }, as: 'stores_head' },
  { action: 'add_delivery_followup', text: 'spoke to the supplier about the water level gauge on AB-1004, it ships Monday', expect: { bom_item_id: /WATER LEVEL GAUGE/ }, as: 'procurement_head' },
  { action: 'add_delivery_lot', text: 'schedule 1 of the stay tube on PO 101 for 25 Nov', fix: { po_item_id: 'pick', expected_delivery_date: '2026-11-25' }, as: 'procurement_head' },
  { action: 'record_vendor_bill', text: 'record the supplier bill against purchase order 101', fix: { po_id: 'pick', bill_no: 'EMB-501' }, as: 'procurement_head' },
  { action: 'approve_vendor_bill', text: 'approve the bill EMB-501', expect: { bill_id: /EMB-501/ }, as: 'procurement_head' },
  { action: 'pay_vendor_bill', text: 'paid 1000 on bill EMB-501 by RTGS', expect: { bill_id: /EMB-501/, amount: 1000, payment_mode: 'RTGS' }, as: 'accounts_head' },
  { action: 'receive_bom_line', text: 'received 2 nos of the stay tube for AB-1004', expect: { bom_item_id: /STAY TUBE/, qty_text: 2 }, fix: { supplier_id: 'Prime Steel Traders', grn_ref: 'GRN-EMB-1', invoice_no: 'INV-EMB-1' }, as: 'stores_head' },
  { action: 'add_stock_receipt', text: 'open a stock receipt from Prime Steel Traders', expect: { supplier_id: /Prime Steel/ }, fix: { grn_ref: 'GRN-EMB-2', invoice_no: 'INV-EMB-2' }, as: 'stores_head' },
  { action: 'reserve_piece', text: 'reserve piece PL-H10M2201-001-R8 for the 12 mm BQ plate on AB-1004', expect: { piece_id: /R8/ }, fix: { bom_item_id: 'FEED CHECK VALVE 25 NB AB-1004' }, as: 'stores_head' },
  { action: 'issue_reservation', text: 'issue the reserved gasket spiral wound for AB-1005 to production', expect: { reservation_id: /GASKET/ }, as: 'stores_head' },
  { action: 'release_reservation', text: 'release the stud bolt reservation on AB-1005', expect: { reservation_id: /STUD BOLT/ }, as: 'stores_head' },
  { action: 'scrap_piece', text: 'scrap the returned piece PL-H10M2201-001-R9', expect: { piece_id: /R9/ }, as: 'stores_head' },
  { action: 'close_gate_entry', text: 'close gate entry 1001', expect: { gir_id: /1001/ }, fix: { grn_ref: 'GRN-EMB-3' }, as: 'stores_head' },
  { action: 'create_gate_pass', text: 'gate pass for the old pump going to Shree Motors for repair, returnable by 30 Nov', expect: { type: 'returnable', expected_return_date: '2026-11-30' }, fix: { party: 'Shree Motors', item: 'Old feed pump' }, as: 'stores_head' },
  { setup: async () => `GP-${(await call('admin', 'GET', '/api/gate-passes')).find?.(g => g.party === 'Shree Motors')?.gp_no}`,
    action: 'approve_gate_pass', text: v => `approve gate pass ${v}`, expect: { gate_pass_id: /Shree Motors/ }, as: 'stores_head' },
  { action: 'issue_gate_pass', text: v => `issue gate pass ${v}`, expect: { gate_pass_id: /Shree Motors/ }, carry: true, as: 'stores_head' },
  { action: 'cancel_gate_pass', text: v => `cancel gate pass ${v}`, expect: { gate_pass_id: /Shree Motors/ }, carry: true, as: 'stores_head' },
  { action: 'disposition_ncr', text: 'NCR-1001: use as is', expect: { ncr_id: /NCR-1001/, disposition: 'use_as_is' }, fix: { disposition_notes: 'Within tolerance after review' }, as: 'qc_head' },
  { action: 'verify_ncr', text: 'verify NCR-1001', expect: { ncr_id: /NCR-1001/ }, as: 'qc_head' },
  { action: 'close_ncr', text: 'close NCR-1001', expect: { ncr_id: /NCR-1001/ }, as: 'qc_head' },
  { action: 'qc_release_job_card', text: 'release JC-1025 from QC hold', expect: { job_card_id: /JC-1025/ }, as: 'qc_head' },
  { action: 'log_job_card_time', text: 'Ramesh Kumar worked 2 hours on JC-1024', expect: { job_card_id: /JC-1024/, employee_id: /Ramesh/, minutes: 120 }, as: 'production_head' },
  { action: 'mark_worker_day', text: 'Suresh Yadav is present today', expect: { employee_id: /Suresh/, status: 'present' }, as: 'production_head' },
  { action: 'create_packing_from_bom', text: 'make a packing list for AB-1005', expect: { project_id: /AB-1005/ }, as: 'dispatch_head' },
  { action: 'acknowledge_delivery', text: 'Bluewave received PL-1004 fine', expect: { packing_id: /PL-1004/, status: 'accepted' }, as: 'dispatch_head' },
  { setup: async () => { const a = await call('admin', 'POST', '/api/packing', { customer_name: 'Ember Ship Ltd', ship_to_address: '1 Ring Road' }); const b = await call('admin', 'POST', '/api/packing', { customer_name: 'Ember Ship Ltd', ship_to_address: '1 Ring Road' }); return [a.packing_no, b.packing_no]; },
    action: 'create_shipment', text: v => `ship ${v[0]} and ${v[1]} together on truck MH 12 AB 1234`, expect: { vehicle_no: 'MH 12 AB 1234' }, fix: v => ({ packing_id: v[0], packing_id_2: v[1] }), as: 'dispatch_head' },
  { action: 'approve_leave', text: "approve Divya Menon's leave", expect: { leave_request_id: /Divya/ }, as: 'hr_head' },
  { action: 'reject_leave', text: "reject Ananya Iyer's casual leave", expect: { leave_request_id: /Ananya/ }, as: 'hr_head' },
  { action: 'allocate_leave', text: 'give Priya Nair 12 days of earned leave for 2026', expect: { employee_id: /Priya/, leave_type_id: /Earned/, allocated: 12, year: 2026 }, as: 'hr_head' },
  { action: 'submit_expense_claim', text: 'Vikram Rao spent 850 on a taxi to the site today', expect: { employee_id: /Vikram/, amount: 850 }, fix: { description: 'Taxi to site' }, as: 'hr_head' },
  { action: 'approve_expense_claim', text: "approve Vikram Rao's expense claim", expect: { claim_id: /Vikram/ }, as: 'hr_head' },
  { action: 'record_advance', text: 'gave Karan Joshi an advance of 5000 today', expect: { employee_id: /Karan/, amount: 5000 }, as: 'hr_head' },
  { action: 'record_loan', text: 'loan of 60000 to Sanjay Patil over 12 months', expect: { employee_id: /Sanjay/, principal_amount: 60000, tenure_months: 12 }, as: 'hr_head' },
  { action: 'set_applicant_status', text: 'move Ravi Kulkarni to interview', expect: { applicant_id: /Ravi/, status: 'interview' }, as: 'hr_head' },
  { action: 'log_service_call', text: 'Sunrise Dairy called, the boiler on AB-1001 has a steam leak, urgent', expect: { project_id: /AB-1001/, priority: 'high' }, fix: { subject: 'Steam leak' }, as: 'service_head' },
  { action: 'set_service_call_status', text: 'the steam leak service call on AB-1001 is resolved', expect: { service_call_id: /Steam leak/, status: 'resolved' }, as: 'service_head' },
  { action: 'add_service_call_visit', text: 'visited the steam leak call on AB-1001 today, replaced the gasket', expect: { service_call_id: /Steam leak/ }, as: 'service_head' },
  { action: 'approve_service_expense', text: 'approve CR-9001', expect: { expense_id: /CR-9001/ }, as: 'manager', fill_as: 'admin' },
  { action: 'reject_service_expense', text: 'reject CR-9002, no bills attached', expect: { expense_id: /CR-9002/ }, fix: { reason: 'No bills attached' } }, // admin decides either step
  { action: 'settle_service_expense', text: 'settle CR-9003', expect: { expense_id: /CR-9003/ }, as: 'accounts_head' },
  { action: 'finalize_service_report', text: 'finalize report FSR-9001', expect: { report_id: /FSR-9001/ }, as: 'service_head' },
  { action: 'share_service_report', text: 'share FSR-1001 with the customer', expect: { report_id: /FSR-1001/ }, as: 'service_head' },
  // Roles: the route would refuse, so the action is not even offered (same rules as the screen).
  { action: 'disposition_ncr', text: 'NCR-1001: use as is', as: 'qc_member', refuse: /unknown action/i },
  { action: 'approve_leave', text: "approve Divya Menon's leave", as: 'stores_head', refuse: /unknown action/i },
  { action: 'mark_attendance', text: 'Priya Nair is absent today', as: 'manager', refuse: /unknown action/i },
  { action: 'record_order_payment', text: 'received 2.5 lakh against SO-4', as: 'accounts_head', refuse: /unknown action/i },
  { action: 'approve_service_expense', text: 'approve CR-9001', as: 'sales_head', refuse: /unknown action/i },
  // Refusals: the route decides, never the card.
  { action: 'issue_material', text: 'issue 1 nos of BQ plate 12 mm for AB-1004', fix: { bom_item_id: 'BQ PLATE 12 MM AB-1004' }, as: 'sales_head', refuse: /unknown action|forbidden/i },
  { action: 'delete_enquiry', text: 'delete the Kaveri Pharma follow up enquiry', fix: { lead_id: 2 }, as: 'design_head', refuse: /unknown action|forbidden|head/i },
  { action: 'record_order_payment', text: 'received money on SO-4', as: 'admin', refuse: /missing: amount/i },
  { action: 'close_milestone', text: 'close it', fix: { milestone_id: 999999 }, refuse: /no matching record/i },
];

const shown = (f) => f?.type === 'ref' ? (f.display || '') : f?.value;
let fails = 0, carry = null;
for (const c of CASES) {
  if (only.length && !only.includes(c.action)) continue;
  if (c.setup) carry = await c.setup();
  const text = typeof c.text === 'function' ? c.text(carry) : c.text;
  const problems = [];
  const card = await post(c.fill_as || 'admin', { preview: true, action: c.action, text });
  if (card.error) problems.push(`preview: ${card.error}`);
  const byName = Object.fromEntries((card.fields || []).map(f => [f.name, f]));
  for (const [k, want] of Object.entries(c.expect || {})) {
    const got = want instanceof RegExp ? shown(byName[k]) : byName[k]?.value;
    if (want instanceof RegExp ? !want.test(String(got ?? '')) : got !== want) problems.push(`${k}: got ${JSON.stringify(got)}${byName[k]?.options ? ` options ${JSON.stringify(byName[k].options.slice(0, 3))}` : ''}`);
  }
  const fields = { ...(card.values || {}) };
  for (const [k, v] of Object.entries((typeof c.fix === 'function' ? c.fix(carry) : c.fix) || {})) fields[k] = v === 'pick' ? (byName[k]?.options?.[0]?.value ?? fields[k]) : v;
  const out = await post(c.as || 'admin', { action: c.action, fields });
  if (c.refuse) { if (out.ok || !c.refuse.test(out.error || '')) problems.push(`should be refused (${c.refuse}), got ${out.ok ? 'ok' : out.error}`); }
  else if (!out.ok) problems.push(`save: ${out.error}`);
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${c.action}${c.as ? ` (${c.as})` : ''}: ${out.summary || card.summary || ''}${problems.length ? `\n      ${problems.join('\n      ')}` : ''}`);
  if (problems.length) fails++;
}
// Who is offered what: department staff only their department's actions, Head-only actions only to heads, admin all.
const offered = async as => (await post('admin', { list: true, as })).actions || [];
const all = await offered('admin');
const ROLES = [
  ['admin', a => [...new Set(CASES.map(c => c.action))].every(k => a.includes(k)), 'every action'],
  ['qc_member', a => a.includes('add_qc_record') && !a.some(k => ['disposition_ncr', 'approve_inward', 'decide_predispatch', 'approve_leave'].includes(k)), 'QC work, not Head-only QC or other departments'],
  ['qc_head', a => a.includes('disposition_ncr') && a.includes('approve_inward') && !a.includes('approve_leave') && !a.includes('issue_po'), 'all QC incl. Head-only'],
  ['stores_head', a => a.includes('receive_bom_line') && !a.includes('approve_leave') && !a.includes('record_invoice_receipt'), 'Stores only'],
  ['manager', a => !a.includes('mark_attendance') && !a.includes('settle_service_expense') && a.includes('issue_po') && a.includes('approve_service_expense'), 'all but HR/Accounts/Marketing'],
  ['accounts_head', a => a.includes('record_invoice_receipt') && a.includes('pay_vendor_bill') && !a.includes('record_order_payment'), 'Accounts only'],
];
for (const [u, ok, what] of ROLES) {
  if (only.length) break;
  const a = await offered(u);
  const good = ok(a) && (u === 'admin' || a.every(k => all.includes(k)));
  console.log(`${good ? 'ok  ' : 'FAIL'} role ${u}: ${a.length} actions (${what})`);
  if (!good) fails++;
}
console.log(`admin is offered ${all.length} actions`);
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
