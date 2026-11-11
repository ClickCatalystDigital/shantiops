// lib/cue-cards.js — Cue Cards (/cue-cards): the prompts Ember AI understands, by area and by level. Each card names
// what it should trigger (`expect`), and scripts/assistant-eval.mjs (EVAL_ONLY=cards) asks every card through the real
// pipeline, so a card on the page is one that works. {slots} are filled from this system's own records, so the cards
// read right on any deployment (the demo, the US demo, a client's live data). A card whose record doesn't exist is left out.
// Each person sees only the cards for their own departments (the same filters the chat uses).
import { queryOne } from './db';
import { actionsFor } from './assistant-actions';
import { toolsFor } from './assistant-data';
import { isPM, canAccessDepartment } from './auth';
import { WHATIF_CARDS, PLANNED, PLANNED_GROUPS, CARD_STATUS } from './cue-cards-intel.mjs';
export { PLANNED, PLANNED_GROUPS, CARD_STATUS };

export const LEVELS = [
  { key: 'know', n: 1, label: 'Know', blurb: 'Explains how the app and your department’s process work, from the help guide.', status: 'live' },
  { key: 'diagnose', n: 2, label: 'Diagnose', blurb: 'Reads your records and answers: stock, orders, payments, approvals. Every number comes straight from the data.', status: 'live' },
  { key: 'predict', n: 3, label: 'Predict', blurb: 'Planned: from your own records, which open orders are exposed to a steel rise, what an order’s cash gap will cost, which delays will hold up dispatch.', status: 'planned' },
  { key: 'optimize', n: 4, label: 'Optimize', blurb: 'Planned: ranks issues by measured amount and urgency, and shows the evidence and assumptions behind each.', status: 'planned' },
  { key: 'execute', n: 5, label: 'Execute', blurb: 'Makes everyday changes for you. Each one shows as a card first and is saved only when you press Save.', status: 'live' },
];

export const AREAS = [
  { key: 'today', label: 'Today' }, { key: 'sales', label: 'Sales' }, { key: 'projects', label: 'Projects' },
  { key: 'procurement', label: 'Procurement' }, { key: 'stores', label: 'Stores' }, { key: 'production', label: 'Production' },
  { key: 'qc', label: 'Quality' }, { key: 'dispatch', label: 'Dispatch' }, { key: 'people', label: 'People & service' }, { key: 'accounts', label: 'Accounts' },
  { key: 'whatif', label: 'Steel purchase what-if' },
];

const K = 'know', D = 'diagnose', X = 'execute';
const US = process.env.NEXT_PUBLIC_MARKET === 'NA' || process.env.MARKET === 'NA';
const PHONE = US ? '(512) 555-0142' : '98450 11223';
const howto = { type: 'howto' };
const tool = t => ({ type: 'data', tool: t });
const act = a => ({ type: 'action', action: a });

// [area, level, prompt, expect]. The how-to prompts include the tested questions on ahromlabs.com/ai-assistant/manufacturers.
export const CARDS = [
  ['today', D, 'What tasks are open for my department?', tool('open_tasks')],
  ['today', D, 'What approvals are waiting for me?', tool('pending_approvals')],
  ['today', X, 'Add a task to check the hydro pump calibration by Friday', act('add_task')],
  ['today', X, 'Ask Stores to keep the plates ready for {project} by tomorrow', act('raise_request')],
  ['today', X, 'The {task} task is done', act('complete_task')],
  ['today', K, 'Where do I change my password?', howto],

  ['sales', K, 'How do I convert a quotation into a sale order?', howto],
  ['sales', D, 'How much does {customer} owe us?', tool('customer_outstanding')],
  ['sales', D, 'What is pending on {sale_order}?', tool('order_payment')],
  ['sales', X, `Add an enquiry from Lotus Breweries, phone ${PHONE}`, act('add_enquiry')],
  ['sales', X, 'Spoke to {lead}, they want the revised offer by Friday', act('log_followup')],
  ['sales', X, 'Move the {lead} enquiry to proposals', act('set_enquiry_stage')],
  ['sales', X, 'Mark {quotation} as sent', act('quotation_sent')],
  ['sales', X, '{quote_customer} accepted {quotation}', act('quotation_accepted')],
  ['sales', X, 'Add a follow-up to send the brochure to {lead} by Friday', act('add_crm_task')],
  ['sales', X, 'Make the {lead} enquiry a customer', act('convert_enquiry')],
  ['sales', X, 'Mark {sale_order} as ready', act('set_order_status')],
  ['sales', X, 'Make a sale order from {accepted_quotation}', act('convert_quotation_to_order')],

  ['projects', D, 'How is {project} going?', tool('project_status')],
  ['projects', X, 'The {milestone} milestone started on {milestone_project}', act('start_milestone')],
  ['projects', X, 'The {milestone} milestone is done on {milestone_project}', act('close_milestone')],
  ['projects', K, 'How do I release the BOM?', howto],
  ['projects', X, 'Release the BOM of {unreleased_project}', act('release_bom')],

  ['procurement', K, 'How do I raise a purchase request?', howto],
  ['procurement', D, "Which purchase orders haven't been received?", tool('open_purchase_orders')],
  ['procurement', X, 'Add supplier Shree Valves, phone 9822001122', act('add_supplier')],
  ['procurement', X, 'Issue purchase order {draft_po}', act('issue_po')],
  ['procurement', X, 'Spoke to the supplier about the {bom_line}, it ships on Monday', act('add_delivery_followup')],
  ['procurement', X, 'Record the supplier bill against purchase order {issued_po}', act('record_vendor_bill')],

  ['stores', K, 'How do I receive material that came today?', howto],
  ['stores', D, 'How much {stock_item} do we have in stock?', tool('stock_on_hand')],
  ['stores', D, 'Which items are below their minimum?', tool('low_stock')],
  ['stores', X, 'Truck KA 01 AB 4321 arrived from {supplier} with plates', act('log_gate_entry')],
  ['stores', X, 'Release the {reservation_item} reservation', act('release_reservation')],
  ['stores', X, 'Gate pass for the old pump going to Shree Motors for repair, returnable', act('create_gate_pass')],

  ['production', K, 'How do I create a job card?', howto],
  ['production', X, 'Start {stage} on {jc}, fitter {employee}', act('start_jobcard_stage')],
  ['production', X, '{worker} worked 2 hours on {job_card}', act('log_job_card_time')],

  ['qc', K, 'How do I assign test certificates to units?', howto],
  ['qc', X, 'Hydro test passed on {project}', act('add_qc_record')],
  ['qc', X, 'Raise a major NCR on {project}: weld porosity on the shell seam', act('raise_ncr')],
  ['qc', X, 'Approve the {inward_item} on inward inspection', act('approve_inward')],
  ['qc', X, '{ncr}: use as is', act('disposition_ncr')],

  ['dispatch', K, 'How do I send a packing list for approval before dispatch?', howto],
  ['dispatch', X, 'Mark packing list {packing} packed', act('set_packing_status')],
  ['dispatch', X, 'Make a packing list for {project}', act('create_packing_from_bom')],

  ['people', K, 'How do I mark attendance for workers?', howto],
  ['people', K, 'How do I log a service visit?', howto],
  ['people', X, '{employee} is absent today', act('mark_attendance')],
  ['people', X, 'Casual leave for {employee} from next Monday to next Tuesday', act('apply_leave')],
  ['people', X, 'Plan a commissioning visit to {project} next Friday', act('log_service_visit')],
  ['people', X, "Approve {leave_employee}'s leave", act('approve_leave')],
  ['people', X, `Gave {employee} an advance of ${US ? '$500' : '5000'} today`, act('record_advance')],
  ['people', X, 'The customer on {project} called, the boiler has a steam leak, urgent', act('log_service_call')],

  ['accounts', K, 'How do I reconcile the bank statement?', howto],
  ['accounts', X, `Received ${US ? '$5,000' : '50,000'} against invoice {invoice} by ${US ? 'wire' : 'NEFT'}`, act('record_invoice_receipt')],
  // One card for every action (added 2026-11-09).
  ['sales', X, 'Give the {lead} enquiry to {sales_user} to follow up', act('assign_enquiry')],
  ['sales', X, `The {lead} enquiry is worth ${US ? '$50,000' : '18 lakh'}`, act('set_enquiry_value')],
  ['sales', X, 'Add customer Deccan Agro Foods, email accounts@deccanagro.example', act('add_customer')],
  ['sales', X, `Change the phone number on the {lead} enquiry to ${PHONE}`, act('edit_enquiry_contact')],
  ['sales', X, `Add Ravi Shah as a contact at {customer}, mobile ${PHONE}`, act('add_contact')],
  ['sales', X, 'Close the sales call on {lead}, nothing more to follow up', act('close_sales_call')],
  ['sales', X, 'The {crm_task} follow-up is done', act('complete_crm_task')],
  ['sales', X, 'Move the {opportunity} opportunity to proposals', act('set_opportunity_stage')],
  ['sales', X, 'Approve the discount on {discount_quotation}', act('approve_quotation_discount')],
  ['sales', X, '{quote_customer} said no to {quotation}', act('quotation_rejected')],
  ['sales', X, 'Delete the {lead} enquiry, it was a duplicate', act('delete_enquiry')],
  ['projects', X, 'Send {done_milestone} on {done_milestone_project} back for rework', act('send_back_milestone')],
  ['projects', X, 'Create a project for Lotus Breweries', act('create_project')],
  ['projects', X, 'Approve the change note on {ecn_item} for {ecn_project}', act('set_ecn_status')],
  ['projects', X, 'Cancel the {bom_line} line on {bom_project}, not needed', act('cancel_bom_line')],
  ['procurement', X, `{supplier} quoted ${US ? '$12' : '68'} per kg for the {bom_line}`, act('record_supplier_quote')],
  ['procurement', X, 'Cancel purchase order {draft_po}, not needed', act('cancel_po')],
  ['procurement', X, 'Add a delivery lot on purchase order {issued_po}: 2 of {po_line} arriving next Friday', act('add_delivery_lot')],
  ['procurement', X, 'Approve the supplier bill {vendor_bill} for payment', act('approve_vendor_bill')],
  ['accounts', X, `Paid ${US ? '$1,000' : '10,000'} on bill {vendor_bill} by ${US ? 'wire' : 'RTGS'}`, act('pay_vendor_bill')],
  ['accounts', X, 'Settle {accounts_expense}', act('settle_service_expense')],
  ['accounts', X, `Received ${US ? '$25,000' : '2.5 lakh'} against {sale_order} by ${US ? 'wire' : 'NEFT'}`, act('record_order_payment')],
  ['stores', X, 'Issue 2 nos of {bom_line} to production for {bom_project}', act('issue_material')],
  ['stores', X, 'Received 2 nos of {bom_line} for {bom_project}', act('receive_bom_line')],
  ['stores', X, 'Open a stock receipt from {supplier}', act('add_stock_receipt')],
  ['stores', X, 'Reserve 2 {stock_item} from stock for the {bom_line} line on {bom_project}', act('reserve_stock')],
  ['stores', X, 'Reserve piece {piece} for the {bom_line} on {bom_project}', act('reserve_piece')],
  ['stores', X, 'Issue the reserved {reservation_item} to production', act('issue_reservation')],
  ['stores', X, 'Remnant {returned_piece} is back in stores', act('confirm_remnant')],
  ['stores', X, 'Scrap the returned piece {returned_piece}', act('scrap_piece')],
  ['stores', X, 'Close gate entry {gir}', act('close_gate_entry')],
  ['stores', X, 'Send the {bom_line} on {bom_project} to procurement', act('raise_pr_for_line')],
  ['dispatch', X, 'Submit {packing} for dispatch approval', act('submit_packing_approval')],
  ['dispatch', X, 'Delete draft packing list {packing}', act('delete_packing_list')],
  ['dispatch', X, '{dispatched_customer} received {dispatched_packing} fine', act('acknowledge_delivery')],
  ['dispatch', X, 'Ship {packing} and {packing2} together on truck KA 01 AB 4321', act('create_shipment')],
  ['dispatch', X, 'Approve gate pass {gate_pass}', act('approve_gate_pass')],
  ['dispatch', X, 'Issue gate pass {gate_pass}', act('issue_gate_pass')],
  ['dispatch', X, 'Cancel gate pass {gate_pass}', act('cancel_gate_pass')],
  ['qc', X, 'Change the {qc_test} on {qc_project} to fail', act('set_qc_result')],
  ['qc', X, 'Approve {predispatch} for dispatch', act('decide_predispatch')],
  ['qc', X, 'Delete the {qc_test} record on {qc_project}, it was entered twice', act('delete_qc_record')],
  ['qc', X, 'Verify {ncr}', act('verify_ncr')],
  ['qc', X, 'Close {ncr}', act('close_ncr')],
  ['qc', X, 'Release {held_jc} from QC hold', act('qc_release_job_card')],
  ['qc', X, 'Reject the {inward_item} that came in, it is bent', act('reject_inward')],
  ['production', X, '{worker} is present today on the shop floor', act('mark_worker_day')],
  ['production', X, 'Finish {stage} on {jc}', act('finish_jobcard_stage')],
  ['people', X, "Reject {leave_employee}'s leave", act('reject_leave')],
  ['people', X, 'Give {employee} 12 days of earned leave for this year', act('allocate_leave')],
  ['people', X, `{employee} spent ${US ? '$40' : '850'} on a taxi to the site today`, act('submit_expense_claim')],
  ['people', X, "Approve {claim_employee}'s expense claim", act('approve_expense_claim')],
  ['people', X, "Reject {claim_employee}'s expense claim, no bill", act('reject_expense_claim')],
  ['people', X, `Loan of ${US ? '$2,000' : '60,000'} to {employee} over 12 months`, act('record_loan')],
  ['people', X, 'Move {applicant} to interview', act('set_applicant_status')],
  ['people', X, 'Mark the planned service visit to {visit_project} done, the engineer went', act('mark_visit_done')],
  ['people', X, 'Service call {service_call} is resolved', act('set_service_call_status')],
  ['people', X, 'Visited service call {service_call} today, replaced the gasket', act('add_service_call_visit')],
  ['people', X, 'Approve {service_expense}', act('approve_service_expense')],
  ['people', X, 'Reject {service_expense}, no bills attached', act('reject_service_expense')],
  ['people', X, 'Finalize report {draft_report}', act('finalize_service_report')],
  ['people', X, 'Share {final_report} with the customer', act('share_service_report')],
].map(([area, level, q, expect]) => ({ area, level, q, expect }));

const SLOT_SQL = {
  project: "SELECT project_no AS v FROM projects WHERE is_system = 0 AND status = 'active' AND master_project_id IS NULL ORDER BY id LIMIT 1",
  task: "SELECT title AS v FROM tasks WHERE status = 'open' ORDER BY length(title) LIMIT 1",
  customer: `SELECT so.customer_name AS v FROM sale_orders so WHERE COALESCE(so.status, '') != 'cancelled' AND so.customer_name IS NOT NULL
    AND so.total > COALESCE((SELECT SUM(amount) FROM sale_order_payments p WHERE p.sale_order_id = so.id), 0) ORDER BY so.id LIMIT 1`,
  sale_order: "SELECT so_no AS v FROM sale_orders WHERE COALESCE(status, '') != 'cancelled' ORDER BY id DESC LIMIT 1",
  lead: "SELECT COALESCE(company_name, lead_name) AS v FROM leads WHERE COALESCE(sales_call_status, '') NOT IN ('Order Received', 'Order Lost') ORDER BY id LIMIT 1",
  quotation: "SELECT substr(quotation_no, 1, instr(quotation_no || '/', '/') - 1) AS v FROM quotations WHERE status IN ('draft', 'sent') ORDER BY id DESC LIMIT 1",
  quote_customer: "SELECT c.name AS v FROM quotations q JOIN customers c ON c.id = q.customer_id WHERE q.status IN ('draft', 'sent') ORDER BY q.id DESC LIMIT 1",
  milestone: `SELECT m.milestone_label AS v FROM milestones m JOIN projects p ON p.id = m.project_id WHERE p.is_system = 0 AND p.status = 'active'
    AND m.status = 'pending' AND m.department = 'Production' ORDER BY p.id DESC, m.sort_order LIMIT 1`,
  milestone_project: `SELECT p.project_no AS v FROM milestones m JOIN projects p ON p.id = m.project_id WHERE p.is_system = 0 AND p.status = 'active'
    AND m.status = 'pending' AND m.department = 'Production' ORDER BY p.id DESC, m.sort_order LIMIT 1`,
  draft_po: "SELECT po_no AS v FROM purchase_orders WHERE status = 'draft' ORDER BY id LIMIT 1",
  supplier: 'SELECT name AS v FROM suppliers WHERE COALESCE(active, 1) = 1 ORDER BY id LIMIT 1',
  sales_user: "SELECT COALESCE(NULLIF(display_name, ''), username) AS v FROM users WHERE active = 1 AND INSTR(',' || COALESCE(departments, '') || ',', ',Sales,') > 0 ORDER BY id LIMIT 1",
  crm_task: "SELECT t.title AS v FROM tasks t WHERE t.status = 'open' AND t.lead_id IS NOT NULL ORDER BY t.id LIMIT 1",
  opportunity: "SELECT title AS v FROM opportunities ORDER BY id LIMIT 1",
  discount_quotation: "SELECT substr(quotation_no, 1, instr(quotation_no || '/', '/') - 1) AS v FROM quotations WHERE approval_status = 'pending' ORDER BY id LIMIT 1",
  done_milestone: `SELECT m.milestone_label AS v FROM milestones m JOIN projects p ON p.id = m.project_id WHERE p.is_system = 0 AND m.status = 'done' AND m.department = 'Design' ORDER BY p.id DESC LIMIT 1`,
  done_milestone_project: `SELECT p.project_no AS v FROM milestones m JOIN projects p ON p.id = m.project_id WHERE p.is_system = 0 AND m.status = 'done' AND m.department = 'Design' ORDER BY p.id DESC LIMIT 1`,
  ecn_item: "SELECT COALESCE(b.material_description, n.field_changed) AS v FROM bom_change_notes n LEFT JOIN bom_items b ON b.id = n.bom_item_id WHERE n.status = 'pending' ORDER BY n.id LIMIT 1",
  ecn_project: "SELECT p.project_no AS v FROM bom_change_notes n JOIN projects p ON p.id = n.project_id WHERE n.status = 'pending' ORDER BY n.id LIMIT 1",
  bom_project: "SELECT p.project_no AS v FROM bom_items b JOIN projects p ON p.id = b.project_id WHERE b.purchase_status IN ('Ordered', 'Transit') ORDER BY length(b.material_description) LIMIT 1",
  po_line: "SELECT pi.description AS v FROM po_items pi JOIN purchase_orders po ON po.id = pi.po_id WHERE po.status = 'issued' ORDER BY po.id DESC LIMIT 1",
  vendor_bill: "SELECT bill_no AS v FROM vendor_bills WHERE status IN ('draft', 'approved') ORDER BY id DESC LIMIT 1",
  accounts_expense: "SELECT req_no AS v FROM service_expense_requests WHERE status = 'with_accounts' ORDER BY id LIMIT 1",
  service_expense: "SELECT req_no AS v FROM service_expense_requests WHERE status IN ('pending_manager', 'pending_executive') ORDER BY id LIMIT 1",
  piece: "SELECT code AS v FROM stock_pieces WHERE status = 'available' ORDER BY id LIMIT 1",
  returned_piece: "SELECT code AS v FROM stock_pieces WHERE status = 'pending_receipt' ORDER BY id LIMIT 1",
  gir: "SELECT gir_no AS v FROM gate_inward_receipts WHERE status = 'open' ORDER BY id LIMIT 1",
  packing2: "SELECT packing_no AS v FROM packing_lists WHERE status = 'draft' ORDER BY id LIMIT 1 OFFSET 1",
  dispatched_packing: "SELECT packing_no AS v FROM packing_lists WHERE status = 'dispatched' AND delivery_ack_status IS NULL ORDER BY id LIMIT 1",
  dispatched_customer: "SELECT customer_name AS v FROM packing_lists WHERE status = 'dispatched' AND delivery_ack_status IS NULL ORDER BY id LIMIT 1",
  gate_pass: "SELECT 'GP-' || gp_no AS v FROM gate_passes WHERE status IN ('draft', 'approved', 'issued') ORDER BY id LIMIT 1",
  qc_test: "SELECT test_type AS v FROM qc_records q WHERE test_type NOT LIKE '%ydro%' ORDER BY id LIMIT 1",
  qc_project: "SELECT p.project_no AS v FROM qc_records q JOIN projects p ON p.id = q.project_id WHERE q.test_type NOT LIKE '%ydro%' ORDER BY q.id LIMIT 1",
  predispatch: "SELECT pl.packing_no AS v FROM pre_dispatch_approvals a JOIN packing_lists pl ON pl.id = a.packing_list_id WHERE a.status = 'pending' ORDER BY a.id LIMIT 1",
  held_jc: "SELECT jc_no AS v FROM job_cards WHERE requires_qc_hold = 1 AND qc_released_at IS NULL ORDER BY id LIMIT 1",
  claim_employee: "SELECT e.name AS v FROM expense_claims c JOIN employees e ON e.id = c.employee_id WHERE c.status = 'submitted' ORDER BY c.id LIMIT 1",
  applicant: "SELECT name AS v FROM job_applicants WHERE status NOT IN ('hired', 'rejected') ORDER BY id LIMIT 1",
  visit_project: "SELECT p.project_no AS v FROM installation_visits v JOIN projects p ON p.id = v.project_id WHERE v.status = 'planned' ORDER BY v.id LIMIT 1",
  service_call: "SELECT call_no AS v FROM service_calls WHERE status != 'closed' ORDER BY id LIMIT 1",
  draft_report: "SELECT report_no AS v FROM installation_reports WHERE finalized_at IS NULL ORDER BY id LIMIT 1",
  final_report: "SELECT report_no AS v FROM installation_reports WHERE finalized_at IS NOT NULL AND customer_visible = 0 ORDER BY id LIMIT 1",
  accepted_quotation: `SELECT substr(q.quotation_no, 1, instr(q.quotation_no || '/', '/') - 1) AS v FROM quotations q WHERE q.status = 'accepted'
    AND NOT EXISTS (SELECT 1 FROM sale_orders so WHERE so.quotation_id = q.id) ORDER BY q.id DESC LIMIT 1`,
  unreleased_project: `SELECT p.project_no AS v FROM projects p JOIN milestones m ON m.project_id = p.id AND m.milestone_key = 'release_bom'
    WHERE p.is_system = 0 AND p.status = 'active' AND m.status != 'done' AND EXISTS (SELECT 1 FROM bom_items b WHERE b.project_id = p.id) ORDER BY p.id LIMIT 1`,
  bom_line: "SELECT b.material_description AS v FROM bom_items b WHERE b.purchase_status IN ('Ordered', 'Transit') ORDER BY length(b.material_description) LIMIT 1",
  issued_po: "SELECT po_no AS v FROM purchase_orders WHERE status = 'issued' ORDER BY id DESC LIMIT 1",
  reservation_item: "SELECT i.description AS v FROM inventory_reservations r JOIN inventory_items i ON i.id = r.inventory_item_id WHERE r.status = 'active' ORDER BY r.id LIMIT 1",
  worker: "SELECT name AS v FROM employees WHERE active = 1 AND employee_type = 'worker' ORDER BY id LIMIT 1",
  job_card: "SELECT jc_no AS v FROM job_cards WHERE status != 'done' AND jc_no IS NOT NULL ORDER BY id LIMIT 1",
  ncr: "SELECT ncr_no AS v FROM ncr_records WHERE status = 'open' ORDER BY id LIMIT 1",
  leave_employee: "SELECT e.name AS v FROM leave_requests lr JOIN employees e ON e.id = lr.employee_id WHERE lr.status = 'pending' ORDER BY lr.id LIMIT 1",
  invoice: "SELECT invoice_no AS v FROM sales_invoices WHERE status = 'issued' ORDER BY id LIMIT 1",
  stock_item: 'SELECT description AS v FROM inventory_items WHERE on_hand > 0 ORDER BY length(description) LIMIT 1',
  stage: "SELECT st.name AS v FROM job_sheet_stages st WHERE st.end_date IS NULL AND st.start_date IS NULL ORDER BY st.sheet_id DESC, st.sort_order LIMIT 1",
  jc: "SELECT js.jc_no AS v FROM job_sheet_stages st JOIN job_sheets js ON js.id = st.sheet_id WHERE st.end_date IS NULL AND st.start_date IS NULL ORDER BY st.sheet_id DESC, st.sort_order LIMIT 1",
  employee: "SELECT name AS v FROM employees WHERE active = 1 AND employee_type = 'worker' ORDER BY id LIMIT 1",
  inward_item: `SELECT b.material_description AS v FROM inward_approvals a JOIN bom_items b ON b.id = a.bom_item_id WHERE a.status = 'pending' ORDER BY a.id LIMIT 1`,
  packing: "SELECT packing_no AS v FROM packing_lists WHERE status = 'draft' ORDER BY id LIMIT 1",
};

// How a record reads in a sentence: a task title mid-sentence in lower case; a person by full name.
const short = (slot, v) => {
  const s = String(v).trim();
  return slot === 'task' ? s.charAt(0).toLowerCase() + s.slice(1) : slot === 'stage' ? s.toLowerCase() : s;
};

// The steel purchase what-if: Ember answers each with a fixed pointer to the project page's card (never a calculation). Shown to
// the people who can open that card: PM, Sales and Marketing (the page's canSeeMoney gate).
const WHATIF = WHATIF_CARDS.map(q => ({ area: 'whatif', level: 'calculate', q, expect: { type: 'pointer' } }));

// The cards this person can use, filled with this system's records. dataOn: live-data answers are switched on.
// When they are off, the live-data cards are still listed, marked off (Ask disabled), so the page shows what exists here.
export async function fillCards(user, { dataOn = false } = {}) {
  const values = {};
  for (const [slot, sql] of Object.entries(SLOT_SQL)) {
    const r = await queryOne(sql).catch(() => null);
    if (r?.v) values[slot] = short(slot, r.v);
  }
  const acts = new Set((await actionsFor(user)).map(a => a.key)), tools = new Set(toolsFor(user).map(t => t.key));
  const money = isPM(user) || canAccessDepartment(user, 'Sales') || canAccessDepartment(user, 'Marketing');
  const filled = CARDS.filter(c => c.expect.type === 'howto' || (c.expect.type === 'action' ? acts.has(c.expect.action) : tools.has(c.expect.tool)))
    .filter(c => [...c.q.matchAll(/\{(\w+)\}/g)].every(m => values[m[1]]))
    .map(c => ({ ...c, q: c.q.replace(/\{(\w+)\}/g, (_, s) => values[s]), ...(c.expect.type === 'data' && !dataOn ? { off: true } : {}) }));
  return [...filled, ...(money ? WHATIF : [])];
}
