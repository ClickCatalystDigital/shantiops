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
  ['sales', X, `Received ${US ? '$25,000' : '2.5 lakh'} against {sale_order} by ${US ? 'wire' : 'NEFT'}`, act('record_order_payment')],

  ['projects', D, 'How is {project} going?', tool('project_status')],
  ['projects', X, 'The {milestone} milestone started on {milestone_project}', act('start_milestone')],
  ['projects', X, 'The {milestone} milestone is done on {milestone_project}', act('close_milestone')],
  ['projects', K, 'How do I release the BOM?', howto],

  ['procurement', K, 'How do I raise a purchase request?', howto],
  ['procurement', D, "Which purchase orders haven't been received?", tool('open_purchase_orders')],
  ['procurement', X, 'Add supplier Shree Valves, phone 9822001122', act('add_supplier')],
  ['procurement', X, 'Issue purchase order {draft_po}', act('issue_po')],

  ['stores', K, 'How do I receive material that came today?', howto],
  ['stores', D, 'How much {stock_item} do we have in stock?', tool('stock_on_hand')],
  ['stores', D, 'Which items are below their minimum?', tool('low_stock')],
  ['stores', X, 'Truck KA 01 AB 4321 arrived from {supplier} with plates', act('log_gate_entry')],

  ['production', K, 'How do I create a job card?', howto],
  ['production', X, 'Start {stage} on {jc}, fitter {employee}', act('start_jobcard_stage')],

  ['qc', K, 'How do I assign test certificates to units?', howto],
  ['qc', X, 'Hydro test passed on {project}', act('add_qc_record')],
  ['qc', X, 'Raise a major NCR on {project}: weld porosity on the shell seam', act('raise_ncr')],
  ['qc', X, 'Approve the {inward_item} on inward inspection', act('approve_inward')],

  ['dispatch', K, 'How do I send a packing list for approval before dispatch?', howto],
  ['dispatch', X, 'Mark packing list {packing} packed', act('set_packing_status')],

  ['people', K, 'How do I mark attendance for workers?', howto],
  ['people', K, 'How do I log a service visit?', howto],
  ['people', X, '{employee} is absent today', act('mark_attendance')],
  ['people', X, 'Casual leave for {employee} from next Monday to next Tuesday', act('apply_leave')],
  ['people', X, 'Plan a commissioning visit to {project} next Friday', act('log_service_visit')],

  ['accounts', K, 'How do I reconcile the bank statement?', howto],
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
  const acts = new Set(actionsFor(user).map(a => a.key)), tools = new Set(toolsFor(user).map(t => t.key));
  return CARDS.filter(c => c.expect.type === 'howto' || (c.expect.type === 'action' ? acts.has(c.expect.action) : dataOn && tools.has(c.expect.tool)))
    .filter(c => [...c.q.matchAll(/\{(\w+)\}/g)].every(m => values[m[1]]))
    .map(c => ({ ...c, q: c.q.replace(/\{(\w+)\}/g, (_, s) => values[s]) }));
}
