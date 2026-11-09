// lib/cue-cards.js — Cue Cards (/cue-cards): the prompts Ember AI understands, by area and by level. Each card names
// what it should trigger (`expect`), and scripts/assistant-eval.mjs (EVAL_ONLY=cards) asks every card through the real
// pipeline, so a card on the page is one that works. {slots} are filled from this system's own records, so the cards
// read right on any deployment (the demo, the US demo, a client's live data). A card whose record doesn't exist is left out.
// Each person sees only the cards for their own departments (the same filters the chat uses).
import { queryOne } from './db';
import { actionsFor } from './assistant-actions';
import { toolsFor } from './assistant-data';

export const LEVELS = [
  { key: 'know', n: 1, label: 'Know', blurb: 'Explains how the app and your department’s process work, from the help guide.', status: 'live' },
  { key: 'diagnose', n: 2, label: 'Diagnose', blurb: 'Reads your records and answers: stock, orders, payments, approvals. Every number comes straight from the data.', status: 'live' },
  { key: 'predict', n: 3, label: 'Predict', blurb: 'Forecasts delays, shortages and costs.', status: 'soon' },
  { key: 'optimize', n: 4, label: 'Optimize', blurb: 'Recommends decisions and trade-offs.', status: 'soon' },
  { key: 'execute', n: 5, label: 'Execute', blurb: 'Makes everyday changes for you. Each one shows as a card first and is saved only when you press Save.', status: 'live' },
];

export const AREAS = [
  { key: 'today', label: 'Today' }, { key: 'sales', label: 'Sales' }, { key: 'projects', label: 'Projects' },
  { key: 'procurement', label: 'Procurement' }, { key: 'stores', label: 'Stores' }, { key: 'production', label: 'Production' },
  { key: 'qc', label: 'Quality' }, { key: 'dispatch', label: 'Dispatch' }, { key: 'people', label: 'People & service' }, { key: 'accounts', label: 'Accounts' },
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

// The cards this person can use, filled with this system's records. dataOn: live-data answers are switched on.
export async function fillCards(user, { dataOn = false } = {}) {
  const values = {};
  for (const [slot, sql] of Object.entries(SLOT_SQL)) {
    const r = await queryOne(sql).catch(() => null);
    if (r?.v) values[slot] = short(slot, r.v);
  }
  const acts = new Set((await actionsFor(user)).map(a => a.key)), tools = new Set(toolsFor(user).map(t => t.key));
  return CARDS.filter(c => c.expect.type === 'howto' || (c.expect.type === 'action' ? acts.has(c.expect.action) : dataOn && tools.has(c.expect.tool)))
    .filter(c => [...c.q.matchAll(/\{(\w+)\}/g)].every(m => values[m[1]]))
    .map(c => ({ ...c, q: c.q.replace(/\{(\w+)\}/g, (_, s) => values[s]) }));
}
