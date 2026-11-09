// lib/assistant-actions.js — what Ember AI may DO, one entry per everyday task. Each action is a plain description of
// an existing API route: the same request the screen sends, so the route's own checks (department, Head-only action
// permissions, Sales visibility, demo rules) decide, and nothing about permissions is written twice.
// lib/assistant-act.js runs them; the chat turns a message into a card (fill), MCP passes fields in (check).
// Every write is confirmed first: a card + Save in chat, propose → confirm in MCP.
// One registry drives: Jev's choices (about), the card's fields, validation, the MCP schema and the eval.
import { queryAll } from './db';
import { isPM, canAccessDepartment, isDepartmentHead, departmentRole, headDepartments, isInternal } from './auth';
import { canPerformAction, requireCrmAction, canEngineeringAction } from './action-permissions';
import { todayISO } from './date';
import { DEPARTMENTS } from './milestones';
import { scopeRows } from './sales-visibility';

// ---------------- text helpers ----------------
const STOP = new Set(('a an and any are as at be by can could did do does for from get give have how i in is it its me my of on or our please '
  + 'set show tell that the their there these this those to us was we were what when where which who will with would you your mark make add '
  + 'new create raise log record today tomorrow yesterday now done finished complete completed close closed start started open reopen send sent '
  + 'accepted accept rejected reject won lost approve approved delete remove cancel issue issued status stage update change move put '
  + 'enquiry enquiries lead leads quotation quote customer client project milestone task po purchase order supplier vendor line item items '
  + 'material qc test record ncr packing list job card stage employee leave attendance visit service note follow followup call called '
  + 'spoke met meeting email emailed pvt ltd limited private co company').split(/\s+/));
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9/-]+/g, ' ').replace(/\s+/g, ' ').trim();
const toks = s => norm(s).split(' ').filter(Boolean);
const distinctive = q => toks(q).map(w => w.replace(/^[/-]+|[/-]+$/g, '').replace(/'s$/, '')).filter(w => w && !STOP.has(w) && (w.length >= 3 || /\d/.test(w)));

// Rank rows by how well the question's distinctive words hit their text; rare words count more, prefixes count.
function rank(question, rows, text) {
  const ts = [...new Set(distinctive(question))];
  if (!ts.length || !rows.length) return [];
  const hay = rows.map(r => ({ r, w: new Set(toks(text(r)).flatMap(x => [x, ...x.split(/[/-]/)])) }));
  const match = (w, t) => w.has(t) || (t.length >= 4 && [...w].some(x => x.length >= 4 && (x.startsWith(t) || t.startsWith(x))));
  const N = rows.length;
  const idf = new Map(ts.map(t => [t, Math.log((N + 1) / (hay.filter(h => match(h.w, t)).length || N + 1)) + 1]));
  return hay.map(h => ({ r: h.r, score: ts.reduce((a, t) => a + (match(h.w, t) ? idf.get(t) : 0), 0) }))
    .filter(x => x.score > 0).sort((a, b) => b.score - a.score);
}
const clearWinner = (c, ratio = 1.4) => (c[0] && (!c[1] || c[0].score >= ratio * c[1].score) ? c[0] : null);
const tidy = t => { const x = String(t || '').replace(/\s+/g, ' ').replace(/^[\s,.:-]+|[\s,.:!?-]+$/g, ''); return x.charAt(0).toUpperCase() + x.slice(1); };

// ---------------- dates (IST) ----------------
const iso = d => d.toISOString().slice(0, 10);
const D = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const monIdx = w => ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(w.slice(0, 3).toLowerCase());
const WEEKDAYS = ['sun', 'mon', 'tues', 'wednes', 'thurs', 'fri', 'satur'];
// Every date the message names, in order: 2026-11-12, 12 Nov, today/tomorrow/yesterday, next Friday, in 3 days.
function datesIn(q, day) {
  const out = [];
  const re = new RegExp(`(\\d{4}-\\d{2}-\\d{2})|\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*${MON}\\w*(?:\\s*(\\d{4}))?|\\b${MON}\\w*\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b|\\b(today|tomorrow|yesterday)\\b|\\b(?:next |on |by |this )?(sun|mon|tues|wednes|thurs|fri|satur)day\\b|\\bin (\\d{1,3}) (day|week)s?\\b`, 'gi');
  const ty = Number(day.slice(0, 4));
  for (const m of String(q).matchAll(re)) {
    if (m[1]) out.push(m[1]);
    else if (m[2]) out.push(iso(new Date(Date.UTC(Number(m[4] || ty), monIdx(m[3]), Number(m[2])))));
    else if (m[5]) out.push(iso(new Date(Date.UTC(ty, monIdx(m[5]), Number(m[6])))));
    else if (m[7]) out.push(addDays(day, { today: 0, tomorrow: 1, yesterday: -1 }[m[7].toLowerCase()]));
    else if (m[8]) { const want = WEEKDAYS.indexOf(m[8].toLowerCase()), now = D(day).getUTCDay(); out.push(addDays(day, ((want - now + 7) % 7) || 7)); }
    else if (m[9]) out.push(addDays(day, Number(m[9]) * (m[10].toLowerCase() === 'week' ? 7 : 1)));
  }
  return out;
}
const stripDates = t => t.replace(new RegExp(`\\b(on |by |from |till |to |until )?(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}(st|nd|rd|th)?\\s*${MON}\\w*(\\s*\\d{4})?|today|tomorrow|yesterday|(next |this )?(sun|mon|tues|wednes|thurs|fri|satur)day|in \\d{1,3} (day|week)s?)\\b`, 'gi'), ' ');

// Indian registration plate: state, district, series letters, number (KA 01 AB 4321). Letters required, so PL-1008 is not one.
const VEHICLE = /\b[A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{1,3}[\s-]?\d{4}\b/i;
const PHONE = /(\+?\d[\d\s-]{8,13}\d)/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const MONEY = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(k|lakh|lakhs|lac|l|cr|crore)?\b|\b([\d,]+(?:\.\d+)?)\s*(k|lakh|lakhs|lac|cr|crore|rupees)\b|\b(\d[\d,]{2,10}(?:\.\d+)?)\b/i;
// Document numbers (SO-5, AB-1001, PL-1009, 612/SB/2026-27) are not amounts or quantities.
const noCodes = s => s.replace(/\S+/g, w => (/\d/.test(w) && (/[a-z]/i.test(w) || /\d[/-]\d/.test(w)) && !/^[₹\d,.]+(k|l|cr|lakh|lakhs|kg|kgs|nos|no|mtr|mtrs|m|ltr|pcs)$/i.test(w) ? ' ' : w));
const PER = /(?:₹|rs\.?)?\s*\b(\d[\d,]*(?:\.\d+)?)\s*(?:\/-)?\s*(?:per|\/|a|each)\s*(kg|kgs|no|nos|mtr|mtrs|meter|unit|piece|pc|set|ltr|pair)\b/i;
function money(q) {
  const s = noCodes(stripDates(String(q).replace(PHONE, ' ')));
  const per = PER.exec(s);
  if (per) return Number(per[1].replace(/,/g, ''));
  const m = MONEY.exec(s);
  if (!m) return null;
  const n = Number((m[1] || m[3] || m[5]).replace(/,/g, '')), u = (m[2] || m[4] || '').toLowerCase();
  return u === 'k' ? n * 1e3 : ['lakh', 'lakhs', 'lac', 'l'].includes(u) ? n * 1e5 : ['cr', 'crore'].includes(u) ? n * 1e7 : n;
}

// ---------------- records the actions point at ----------------
// sql = candidate rows (only the ones the action may act on), text = what the words are matched against,
// label = what the card shows, code = a document number the message may quote exactly (AB-1001, PL-1009).
const KINDS = {
  enquiry: { sql: 'SELECT id, lead_name, company_name, phone, owner_dept, account_manager, assigned_to, initiated_by, created_by FROM leads', scope: 'leads',
    mine: (u, r) => canAccessDepartment(u, r.owner_dept || 'Sales'),
    text: r => `${r.lead_name} ${r.company_name || ''}`, label: r => r.company_name && r.company_name !== r.lead_name ? `${r.lead_name} (${r.company_name})` : r.lead_name },
  customer: { sql: 'SELECT id, name FROM customers WHERE COALESCE(active, 1) = 1', text: r => r.name, label: r => r.name },
  quotation: { sql: `SELECT q.id, q.quotation_no, q.status, q.created_by, q.lead_id, c.name AS customer FROM quotations q LEFT JOIN customers c ON c.id = q.customer_id
      WHERE q.status IN ('draft','sent','accepted','rejected')`, scope: 'quotations',
    text: r => `${r.quotation_no} ${r.customer || ''}`, label: r => `${r.quotation_no} · ${r.customer || ''} (${r.status})`, code: r => r.quotation_no },
  sale_order: { sql: `SELECT id, so_no, customer_name, created_by, lead_id, sales_person_override FROM sale_orders WHERE COALESCE(status, '') != 'cancelled'`, scope: 'saleOrders',
    text: r => `${r.so_no} ${r.customer_name || ''}`, label: r => `${r.so_no} · ${r.customer_name || ''}`, code: r => r.so_no },
  project: { sql: "SELECT id, project_no, customer_name FROM projects WHERE is_system = 0 AND status = 'active'",
    text: r => `${r.project_no} ${r.customer_name || ''}`, label: r => `${r.project_no} · ${r.customer_name || ''}`, code: r => r.project_no },
  open_milestone: { mine: (u, r) => isPM(u) || canAccessDepartment(u, r.department),
    sql: `SELECT m.id, m.milestone_label, m.status, m.department, p.project_no, p.customer_name FROM milestones m JOIN projects p ON p.id = m.project_id
      WHERE p.is_system = 0 AND m.status != 'done' AND m.actual_end IS NULL`,
    text: r => `${r.milestone_label} ${r.project_no} ${r.customer_name || ''}`, proj: r => r.project_no, label: r => `${r.milestone_label} · ${r.project_no}` },
  done_milestone: { sql: `SELECT m.id, m.milestone_label, p.project_no, p.customer_name FROM milestones m JOIN projects p ON p.id = m.project_id
      WHERE p.is_system = 0 AND (m.status = 'done' OR m.actual_end IS NOT NULL)`,
    text: r => `${r.milestone_label} ${r.project_no} ${r.customer_name || ''}`, proj: r => r.project_no, label: r => `${r.milestone_label} · ${r.project_no}` },
  // Sales/Marketing follow-ups (tasks with an enquiry, opportunity or customer) are crm_task, completed through their own route.
  task: { sql: "SELECT id, title, department, from_department FROM tasks WHERE status = 'open' AND lead_id IS NULL AND opportunity_id IS NULL AND customer_id IS NULL",
    mine: (u, r) => canAccessDepartment(u, r.department) || (r.from_department && canAccessDepartment(u, r.from_department)), text: r => r.title, label: r => `${r.title} (${r.department})` },
  supplier: { sql: 'SELECT id, name FROM suppliers WHERE COALESCE(active, 1) = 1', text: r => r.name, label: r => r.name },
  draft_po: { sql: `SELECT po.id, po.po_no, s.name AS supplier FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.status = 'draft'`,
    text: r => `${r.po_no} ${r.supplier}`, label: r => `${r.po_no} · ${r.supplier}`, code: r => r.po_no },
  live_po: { sql: `SELECT po.id, po.po_no, po.status, s.name AS supplier FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.status IN ('draft','issued')`,
    text: r => `${r.po_no} ${r.supplier}`, label: r => `${r.po_no} · ${r.supplier} (${r.status})`, code: r => r.po_no },
  bom_line: { sql: `SELECT b.id, b.material_description, b.size_spec, p.project_no FROM bom_items b JOIN projects p ON p.id = b.project_id
      WHERE COALESCE(b.purchase_status, '') NOT IN ('Cancelled')`,
    text: r => `${r.material_description} ${r.size_spec || ''} ${r.project_no}`, proj: r => r.project_no, label: r => `${r.material_description}${r.size_spec ? ` ${r.size_spec}` : ''} · ${r.project_no}` },
  employee: { sql: 'SELECT id, name, department FROM employees WHERE active = 1', text: r => r.name, label: r => `${r.name}${r.department ? ` (${r.department})` : ''}` },
  // Hydro tests belong to Production, every other test to QC (server/api/qc-records canTouch).
  qc_record: { mine: (u, r) => canAccessDepartment(u, /hydro/i.test(r.test_type || '') ? 'Production' : 'QC'), sql: `SELECT q.id, q.test_type, q.result, q.reference_no, p.project_no FROM qc_records q JOIN projects p ON p.id = q.project_id`,
    text: r => `${r.test_type} ${r.reference_no || ''} ${r.project_no}`, proj: r => r.project_no, label: r => `${r.test_type} · ${r.project_no} (${r.result})` },
  packing: { sql: `SELECT id, packing_no, customer_name, status FROM packing_lists WHERE status != 'dispatched'`,
    text: r => `${r.packing_no} ${r.customer_name || ''}`, label: r => `${r.packing_no} · ${r.customer_name || ''} (${r.status})`, code: r => r.packing_no },
  dispatched_packing: { sql: `SELECT id, packing_no, customer_name FROM packing_lists WHERE status = 'dispatched' AND delivery_ack_status IS NULL`,
    text: r => `${r.packing_no} ${r.customer_name || ''}`, label: r => `${r.packing_no} · ${r.customer_name || ''}`, code: r => r.packing_no },
  draft_packing: { sql: `SELECT id, packing_no, customer_name FROM packing_lists WHERE status = 'draft'`,
    text: r => `${r.packing_no} ${r.customer_name || ''}`, label: r => `${r.packing_no} · ${r.customer_name || ''}`, code: r => r.packing_no },
  inward: { sql: `SELECT a.id, b.material_description, p.project_no FROM inward_approvals a JOIN bom_items b ON b.id = a.bom_item_id
      LEFT JOIN projects p ON p.id = a.project_id WHERE a.status = 'pending'`,
    text: r => `${r.material_description} ${r.project_no || ''}`, label: r => `${r.material_description} · ${r.project_no || 'stock'}` },
  predispatch: { sql: `SELECT a.id, pl.packing_no, pl.customer_name FROM pre_dispatch_approvals a JOIN packing_lists pl ON pl.id = a.packing_list_id
      WHERE a.status = 'pending'`,
    text: r => `${r.packing_no} ${r.customer_name || ''}`, label: r => `${r.packing_no} · ${r.customer_name || ''}`, code: r => r.packing_no },
  stage: { sql: `SELECT st.id, st.sheet_id, st.name, js.jc_no, p.project_no, st.start_date FROM job_sheet_stages st JOIN job_sheets js ON js.id = st.sheet_id
      LEFT JOIN projects p ON p.id = js.project_id WHERE st.end_date IS NULL`,
    text: r => `${r.name} ${r.jc_no} ${r.project_no || ''}`, proj: r => r.project_no, label: r => `${r.name} · ${r.jc_no}${r.project_no ? ` ${r.project_no}` : ''}${r.start_date ? ' (started)' : ''}` },
  leave_type: { sql: 'SELECT id, name FROM leave_types WHERE active = 1', text: r => r.name, label: r => r.name },
  pending_leave: { sql: `SELECT lr.id, e.name, lt.name AS type, lr.from_date, lr.to_date FROM leave_requests lr JOIN employees e ON e.id = lr.employee_id
      LEFT JOIN leave_types lt ON lt.id = lr.leave_type_id WHERE lr.status = 'pending'`,
    text: r => `${r.name} ${r.type || ''}`, label: r => `${r.name} · ${r.type || 'leave'} ${r.from_date} to ${r.to_date}` },
  expense_claim: { sql: `SELECT c.id, e.name, c.claim_date, c.total_amount FROM expense_claims c JOIN employees e ON e.id = c.employee_id WHERE c.status = 'submitted'`,
    text: r => r.name, label: r => `${r.name} · ₹${Number(r.total_amount || 0).toLocaleString('en-IN')} (${r.claim_date})` },
  service_expense: { sql: `SELECT id, req_no, requester_name, kind, amount, status FROM service_expense_requests WHERE status IN ('pending_manager', 'pending_executive')`,
    // Who approves which step: server/api/service-expenses/[id] STEPS (manager, then executive; admin either).
    mine: (u, r) => (r.status === 'pending_manager' ? ['manager', 'admin'] : ['executive', 'admin']).includes(u.role),
    text: r => `${r.req_no} ${r.requester_name || ''}`, label: r => `${r.req_no} · ${r.requester_name || ''} ₹${Number(r.amount || 0).toLocaleString('en-IN')}`, code: r => r.req_no },
  accounts_expense: { sql: `SELECT id, req_no, requester_name, amount FROM service_expense_requests WHERE status = 'with_accounts'`,
    text: r => `${r.req_no} ${r.requester_name || ''}`, label: r => `${r.req_no} · ${r.requester_name || ''} ₹${Number(r.amount || 0).toLocaleString('en-IN')}`, code: r => r.req_no },
  service_call: { sql: `SELECT s.id, s.call_no, s.subject, s.customer_name, s.status, p.project_no FROM service_calls s LEFT JOIN projects p ON p.id = s.project_id WHERE s.status != 'closed'`,
    text: r => `${r.call_no || ''} ${r.subject} ${r.customer_name || ''} ${r.project_no || ''}`, proj: r => r.project_no, label: r => `${r.call_no || `#${r.id}`} · ${r.subject} (${r.status})`, code: r => r.call_no },
  crm_task: { sql: `SELECT t.id, t.title, t.department, l.lead_name FROM tasks t LEFT JOIN leads l ON l.id = t.lead_id
      WHERE t.status = 'open' AND (t.lead_id IS NOT NULL OR t.opportunity_id IS NOT NULL OR t.customer_id IS NOT NULL)`,
    mine: (u, r) => canAccessDepartment(u, r.department), text: r => `${r.title} ${r.lead_name || ''}`, label: r => `${r.title}${r.lead_name ? ` · ${r.lead_name}` : ''}` },
  ncr: { sql: `SELECT n.id, n.ncr_no, n.description, n.status, p.project_no FROM ncr_records n LEFT JOIN projects p ON p.id = n.project_id WHERE n.status != 'closed'`,
    text: r => `${r.ncr_no} ${r.description} ${r.project_no || ''}`, proj: r => r.project_no, label: r => `${r.ncr_no} · ${r.project_no || ''} (${r.status})`, code: r => r.ncr_no },
  discount_quotation: { sql: `SELECT q.id, q.quotation_no, q.created_by, q.lead_id, c.name AS customer FROM quotations q LEFT JOIN customers c ON c.id = q.customer_id WHERE q.approval_status = 'pending'`,
    scope: 'quotations', text: r => `${r.quotation_no} ${r.customer || ''}`, label: r => `${r.quotation_no} · ${r.customer || ''}`, code: r => r.quotation_no },
  accepted_quotation: { sql: `SELECT q.id, q.quotation_no, q.created_by, q.lead_id, c.name AS customer FROM quotations q LEFT JOIN customers c ON c.id = q.customer_id
      WHERE q.status = 'accepted' AND NOT EXISTS (SELECT 1 FROM sale_orders so WHERE so.quotation_id = q.id)`,
    scope: 'quotations', text: r => `${r.quotation_no} ${r.customer || ''}`, label: r => `${r.quotation_no} · ${r.customer || ''}`, code: r => r.quotation_no },
  invoice: { sql: `SELECT i.id, i.invoice_no, i.total, i.sale_order_id, i.created_by, c.name AS customer FROM sales_invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.status = 'issued'`,
    scope: 'invoices', text: r => `${r.invoice_no} ${r.customer || ''}`, label: r => `${r.invoice_no} · ${r.customer || ''} ₹${Number(r.total || 0).toLocaleString('en-IN')}`, code: r => r.invoice_no },
  vendor_bill: { sql: `SELECT vb.id, vb.bill_no, vb.status, vb.payable_amount, s.name AS supplier FROM vendor_bills vb JOIN purchase_orders po ON po.id = vb.po_id
      JOIN suppliers s ON s.id = po.supplier_id WHERE vb.status IN ('draft', 'approved')`,
    text: r => `${r.bill_no} ${r.supplier}`, label: r => `${r.bill_no} · ${r.supplier} (${r.status})`, code: r => r.bill_no },
  issued_po: { sql: `SELECT po.id, po.po_no, s.name AS supplier FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.status = 'issued'`,
    text: r => `${r.po_no} ${r.supplier}`, label: r => `${r.po_no} · ${r.supplier}`, code: r => r.po_no },
  po_line: { sql: `SELECT pi.id, pi.po_id, pi.description, pi.qty, po.po_no, p.project_no FROM po_items pi JOIN purchase_orders po ON po.id = pi.po_id
      LEFT JOIN projects p ON p.id = pi.project_id WHERE po.status = 'issued'`,
    text: r => `${r.description} ${r.po_no} ${r.project_no || ''}`, proj: r => r.project_no, label: r => `${r.description} · ${r.po_no} (${r.qty})` },
  piece: { sql: `SELECT sp.id, sp.code, sp.status, i.description FROM stock_pieces sp JOIN inventory_items i ON i.id = sp.inventory_item_id WHERE sp.status = 'available'`,
    text: r => `${r.code} ${r.description}`, label: r => `${r.code} · ${r.description}`, code: r => r.code },
  returned_piece: { sql: `SELECT sp.id, sp.code, i.description FROM stock_pieces sp JOIN inventory_items i ON i.id = sp.inventory_item_id WHERE sp.status = 'pending_receipt'`,
    text: r => `${r.code} ${r.description}`, label: r => `${r.code} · ${r.description}`, code: r => r.code },
  stock_item: { sql: 'SELECT id, description, item_code, on_hand, unit FROM inventory_items', text: r => `${r.description} ${r.item_code || ''}`,
    label: r => `${r.description} (${r.on_hand ?? 0}${r.unit ? ` ${r.unit}` : ''} on hand)`, code: r => r.item_code },
  reservation: { sql: `SELECT r.id, r.qty, i.description, p.project_no FROM inventory_reservations r JOIN inventory_items i ON i.id = r.inventory_item_id
      LEFT JOIN bom_items b ON b.id = r.bom_item_id LEFT JOIN projects p ON p.id = b.project_id WHERE r.status = 'active'`,
    text: r => `${r.description} ${r.project_no || ''}`, proj: r => r.project_no, label: r => `${r.description} × ${r.qty}${r.project_no ? ` · ${r.project_no}` : ''}` },
  gate_pass: { sql: `SELECT id, gp_no, party, status FROM gate_passes WHERE status IN ('draft', 'approved', 'issued')`,
    text: r => `GP-${r.gp_no} ${r.party || ''}`, label: r => `GP-${r.gp_no} · ${r.party || ''} (${r.status})`, code: r => `gp-${r.gp_no}` },
  open_gir: { sql: `SELECT id, gir_no, vehicle_no, supplier_name FROM gate_inward_receipts WHERE status = 'open'`,
    text: r => `${r.gir_no} ${r.vehicle_no || ''} ${r.supplier_name || ''}`, label: r => `${r.gir_no} · ${r.vehicle_no || ''} ${r.supplier_name || ''}`, code: r => r.gir_no },
  install_report: { sql: `SELECT r.id, r.report_no, r.call_type, r.finalized_at, r.customer_visible, p.project_no FROM installation_reports r LEFT JOIN projects p ON p.id = r.project_id`,
    text: r => `${r.report_no} ${r.call_type} ${r.project_no || ''}`, proj: r => r.project_no, label: r => `${r.report_no} · ${r.call_type} ${r.project_no || ''} (${r.finalized_at ? 'final' : 'draft'})`, code: r => r.report_no },
  open_job_card: { sql: `SELECT j.id, j.jc_no, j.section, p.project_no FROM job_cards j LEFT JOIN projects p ON p.id = j.project_id WHERE j.status != 'done'`,
    text: r => `${r.jc_no} ${r.section || ''} ${r.project_no || ''}`, proj: r => r.project_no, label: r => `${r.jc_no} · ${r.section || ''} ${r.project_no || ''}`, code: r => r.jc_no },
  held_job_card: { sql: `SELECT j.id, j.jc_no, j.section, p.project_no FROM job_cards j LEFT JOIN projects p ON p.id = j.project_id WHERE j.requires_qc_hold = 1 AND j.qc_released_at IS NULL`,
    text: r => `${r.jc_no} ${r.section || ''} ${r.project_no || ''}`, proj: r => r.project_no, label: r => `${r.jc_no} · ${r.section || ''} ${r.project_no || ''}`, code: r => r.jc_no },
  opportunity: { sql: "SELECT id, title, customer_name, stage, owner_dept FROM opportunities", mine: (u, r) => canAccessDepartment(u, r.owner_dept || 'Sales'),
    text: r => `${r.title} ${r.customer_name || ''}`, label: r => `${r.title} · ${r.customer_name || ''} (${r.stage})` },
  applicant: { sql: "SELECT id, name, status FROM job_applicants WHERE status NOT IN ('hired', 'rejected')", text: r => r.name, label: r => `${r.name} (${r.status})` },
  pending_ecn: { sql: `SELECT n.id, n.field_changed, n.new_value, p.project_no, b.material_description FROM bom_change_notes n JOIN projects p ON p.id = n.project_id
      LEFT JOIN bom_items b ON b.id = n.bom_item_id WHERE n.status = 'pending'`,
    text: r => `${r.material_description || ''} ${r.field_changed} ${r.project_no}`, proj: r => r.project_no, label: r => `${r.material_description || r.field_changed} → ${r.new_value} · ${r.project_no}` },
  open_enquiry: { sql: 'SELECT id, lead_name, company_name, owner_dept, account_manager, assigned_to, initiated_by, created_by, converted_customer_id FROM leads WHERE sales_call_closed_at IS NULL', scope: 'leads',
    mine: (u, r) => canAccessDepartment(u, r.owner_dept || 'Sales'),
    text: r => `${r.lead_name} ${r.company_name || ''}`, label: r => r.company_name && r.company_name !== r.lead_name ? `${r.lead_name} (${r.company_name})` : r.lead_name },
};

async function rowsOf(kind, user) {
  const k = KINDS[kind];
  let rows = await queryAll(k.sql);
  if (k.mine && user) rows = rows.filter(r => k.mine(user, r));
  return k.scope && user ? scopeRows(user, k.scope, rows) : rows;
}
// A document number quoted exactly (AB-1001, PL-1009, QTN-3, 612/SB/2026-27) wins outright.
function byCode(kind, rows, q) {
  const k = KINDS[kind];
  if (!k.code) return null;
  const words = String(q).split(/\s+/).map(s => s.replace(/^[^\w]+|[^\w]+$/g, '').toLowerCase()).filter(s => /\d/.test(s));
  for (const w of words) {
    const hit = rows.filter(r => { const c = String(k.code(r) || '').toLowerCase(); return c === w || c.startsWith(`${w}/`); });
    if (hit.length === 1) return hit[0];
  }
  return null;
}
async function candidates(kind, q, user) {
  let rows = await rowsOf(kind, user);
  // A message that names a project number (AB-1005) is about that project's milestone / stage / line / record.
  if (KINDS[kind].proj) {
    const named = new Set(String(q).toLowerCase().split(/[\s,.;:()]+/).filter(w => /\d/.test(w)));
    const mine = rows.filter(r => named.has(String(KINDS[kind].proj(r) || '').toLowerCase()));
    if (mine.length) rows = mine;
  }
  const exact = byCode(kind, rows, q);
  if (exact) return [{ id: exact.id, label: KINDS[kind].label(exact), score: 99, row: exact }];
  return rank(q, rows, KINDS[kind].text).slice(0, 5).map(x => ({ id: x.r.id, label: KINDS[kind].label(x.r), score: x.score, row: x.r }));
}

// ---------------- the actions ----------------
const field = (name, label, type = 'text', extra = {}) => ({ name, label, type, required: false, ...extra });
const need = f => ({ ...f, required: true });
const ref = (name, label, kind, required = true) => ({ name, label, type: 'ref', ref: kind, required });
const today = (name = 'date', label = 'Date') => field(name, label, 'date', { default: 'today', required: true });
const reason = (label = 'Reason', required = false) => field('reason', label, 'longtext', { fill: false, required });
const opt = (value, label, words) => ({ value, label, words });

const DEPT_OPTIONS = DEPARTMENTS.map(d => opt(d, d === 'Installation' ? 'Service' : d, new RegExp(`\\b${d === 'Installation' ? 'service|installation' : d === 'QC' ? 'qc|quality' : d.toLowerCase()}\\b`, 'i')));
const NOTE_TYPES = [opt('call', 'Call', /\b(call(ed)?|phoned|rang|spoke)\b/i), opt('meeting', 'Meeting', /\b(met|meeting|visit(ed)?)\b/i),
  opt('email', 'Email', /\be-?mail(ed)?\b/i), opt('note', 'Note', /\bnote\b/i)];
const DECISION = [opt('approved', 'Approve', /\bapprove[ds]?|accept(ed)?|ok(ay)?|pass(ed)?|clear(ed)?\b/i), opt('rejected', 'Reject', /\breject(ed)?|fail(ed)?|not ok\b/i)];
const QC_RESULT = [opt('pass', 'Pass', /\bpass(ed)?|ok|cleared|accepted\b/i), opt('fail', 'Fail', /\bfail(ed)?|rejected|not ok\b/i), opt('pending', 'Pending', /\bpending\b/i)];
const ATTENDANCE = [opt('present', 'Present', /\bpresent|came|in today\b/i), opt('absent', 'Absent', /\babsent|did ?n.?t come|not coming|no show\b/i),
  opt('half', 'Half day', /\bhalf\b/i), opt('leave', 'On leave', /\bon leave|leave\b/i)];
const SEVERITY = [opt('minor', 'Minor', /\bminor\b/i), opt('major', 'Major', /\bmajor|serious\b/i), opt('critical', 'Critical', /\bcritical|severe\b/i)];
const PAY_MODES = [opt('NEFT', 'NEFT', /\bneft\b/i), opt('RTGS', 'RTGS', /\brtgs\b/i), opt('UPI', 'UPI', /\bupi\b/i), opt('Cheque', 'Cheque', /\bcheque|check\b/i), opt('Cash', 'Cash', /\bcash\b/i)];
const PACKING_STATUS = [opt('packed', 'Packed', /\bpacked|ready\b/i), opt('dispatched', 'Dispatched', /\bdispatch(ed)?|shipped|left|sent out\b/i), opt('draft', 'Draft', /\bdraft|back to draft|reopen\b/i)];
// Sales stages come from Masters → Funnel Stages, so they are read when a card is made.
const stageOptions = async () => (await queryAll('SELECT name FROM sales_stages WHERE active = 1 ORDER BY sort_order')).map(r =>
  opt(r.name, r.name, new RegExp(`\\b${r.name.toLowerCase().replace(/[^a-z ]/g, ' ').trim().split(/\s+/).filter(w => !['lead', 'stage', 'project'].includes(w)).join('[\\s-]+')}\\b`, 'i')));

// ---------------- who may do what ----------------
// Each action's gate asks the same functions its route asks (canAccessDepartment, the action_permissions table through
// canPerformAction / requireCrmAction, isDepartmentHead), so chat, MCP, Cue Cards and Jev's choices offer exactly what the
// screen allows. The route still checks again on Save. Admin passes every gate (isPM → all departments, every key).
const has = (u, ...ds) => ds.some(d => canAccessDepartment(u, d));
const may = (d, key) => async u => has(u, d) && canPerformAction(u, d, key); // requireDepartment + requireAction
const keyOnly = (d, key) => u => canPerformAction(u, d, key); // routes that only call requireAction
const crm = key => async u => (isPM(u) || has(u, 'Sales', 'Marketing')) && (await requireCrmAction(u, key)) === null;
const crmAny = key => async u => { for (const d of ['Sales', 'Marketing']) if (has(u, d) && await canPerformAction(u, d, key)) return true; return false; };
const crmFirst = key => async u => { const d = ['Sales', 'Marketing'].find(x => has(u, x)); return !!d && canPerformAction(u, d, key); };
const salesOrPm = key => async u => (isPM(u) || has(u, 'Sales')) && canPerformAction(u, 'Sales', key); // isPM bypasses requireDepartment
const headOf = (...ds) => u => ds.some(d => isDepartmentHead(u, d));
const anyone = u => isInternal(u);
const either = (...gs) => async u => { for (const g of gs) if (await g(u)) return true; return false; };
const S = ['Sales', 'Marketing'];
export const ACTIONS = [
  // ---- Sales / CRM ----
  { key: 'add_enquiry', gate: crmFirst('crm.lead.create'), risk: 'create', about: 'Add a new enquiry (sales lead) from a person or company not yet in the system, with a phone or email if given.',
    strip: /^(please )?(add|create|log|new|enter)( an?)?( new)? (enquiry|inquiry|lead)( from| for| called| named)?/i,
    fields: [need(field('lead_name', 'Name', 'text', { cut: true })), field('phone', 'Phone', 'phone'), field('email', 'Email', 'email'), field('expected_value', 'Expected value (₹)', 'money')],
    request: v => ({ method: 'POST', path: '/api/leads', body: { lead_name: v.lead_name, phone: v.phone, email: v.email, expected_value: v.expected_value, source: 'Ember AI' } }),
    summary: v => `Add enquiry ${v.lead_name}`, link: r => `/sales/leads?highlight=LD-${r.id}` },
  { key: 'log_followup', gate: crmAny('sales.diary.write'), risk: 'create', about: "Log a call, meeting, visit or email with a customer or enquiry, and what they said, in the enquiry's Diary (for example 'met Kaveri Pharma today, they want…', 'spoke to Metro Hospital…').",
    strip: /^(please )?(log|note|record|add)( a)? (call|follow[- ]?up|meeting|note|diary entry)( with| on| for)?/i,
    fields: [ref('lead_id', 'Enquiry', 'enquiry'), need(field('note_type', 'Type', 'enum', { options: NOTE_TYPES, default: 'call' })), need(field('content', 'What was said', 'longtext')), today('visit_date', 'Date')],
    request: v => ({ method: 'POST', path: '/api/crm-notes', body: { lead_id: v.lead_id, note_type: v.note_type, content: v.content, visit_date: v.visit_date } }),
    summary: (v, l) => `Log a ${v.note_type} with ${l.lead_id}`, link: (r, v) => `/sales/leads?highlight=LD-${v.lead_id}` },
  { key: 'set_enquiry_stage', gate: u => has(u, ...S), risk: 'change', about: 'Move an enquiry to another funnel stage (cold, hot, proposal, hot offer, dropped, follow up…).',
    fields: [ref('lead_id', 'Enquiry', 'enquiry'), need(field('sales_call_status', 'New stage', 'enum', { options: stageOptions }))],
    request: v => ({ method: 'PATCH', path: `/api/leads/${v.lead_id}`, body: { sales_call_status: v.sales_call_status } }),
    summary: (v, l) => `Move ${l.lead_id} to ${v.sales_call_status}`, link: (r, v) => `/sales/leads?highlight=LD-${v.lead_id}` },
  { key: 'assign_enquiry', gate: u => has(u, ...S), risk: 'change', about: 'Assign or give an enquiry (lead) to a salesperson, who will follow it up.',
    fields: [ref('lead_id', 'Enquiry', 'enquiry'), need(field('assigned_to', 'Assign to (username)', 'user', { dept: 'Sales' }))],
    request: v => ({ method: 'PATCH', path: `/api/leads/${v.lead_id}`, body: { assigned_to: v.assigned_to } }),
    summary: (v, l) => `Assign ${l.lead_id} to ${v.assigned_to}`, link: (r, v) => `/sales/leads?highlight=LD-${v.lead_id}` },
  { key: 'set_enquiry_value', gate: u => has(u, ...S), risk: 'change', about: 'Set or change the expected order value of an enquiry.',
    fields: [ref('lead_id', 'Enquiry', 'enquiry'), need(field('expected_value', 'Expected value (₹)', 'money'))],
    request: v => ({ method: 'PATCH', path: `/api/leads/${v.lead_id}`, body: { expected_value: v.expected_value } }),
    summary: (v, l) => `Set ${l.lead_id}'s expected value to ₹${Number(v.expected_value).toLocaleString('en-IN')}`, link: (r, v) => `/sales/leads?highlight=LD-${v.lead_id}` },
  { key: 'add_customer', gate: crm('sales.customer.write'), risk: 'create', about: 'Add a new customer (company) to the customer master, with phone, email or GST number if given.',
    strip: /^(please )?(add|create|new)( an?)?( new)? (customer|client)( called| named)?/i,
    fields: [need(field('name', 'Name', 'text', { cut: true })), field('phone', 'Phone', 'phone'), field('email', 'Email', 'email'), field('gst_no', 'GST number', 'text', { pick: /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/i })],
    request: v => ({ method: 'POST', path: '/api/customers', body: { name: v.name, phone: v.phone, email: v.email, gst_no: v.gst_no } }),
    summary: v => `Add customer ${v.name}`, link: () => '/sales/customers' },
  ...[['quotation_sent', 'sent', 'Mark a quotation (commercial offer) as sent to the customer.', 'Mark sent'],
    ['quotation_accepted', 'accepted', 'Mark a quotation (commercial offer) accepted: the customer agreed, the deal is won.', 'Accept'],
    ['quotation_rejected', 'rejected', 'Mark a quotation (commercial offer) rejected: the customer said no or the order was lost.', 'Reject']].map(([key, status, about, verb]) => ({
    key, gate: crm('sales.quotation.status'), risk: 'change', about, fields: [ref('quotation_id', 'Quotation', 'quotation')],
    request: v => ({ method: 'PATCH', path: `/api/quotations/${v.quotation_id}`, body: { status } }),
    summary: (v, l) => `${verb} quotation ${l.quotation_id}`, link: () => '/sales/quotations' })),
  { key: 'record_order_payment', gate: salesOrPm('sales.payment.write'), risk: 'create', about: 'Record a payment received from a customer against a sale order (advance or balance).',
    fields: [ref('sale_order_id', 'Sale order', 'sale_order'), need(field('amount', 'Amount (₹)', 'money')), today('received_on', 'Received on'), field('mode', 'Mode', 'enum', { options: PAY_MODES })],
    request: v => ({ method: 'POST', path: '/api/sale-order-payments', body: { sale_order_id: v.sale_order_id, amount: v.amount, received_on: v.received_on, mode: v.mode } }),
    summary: (v, l) => `Record ₹${Number(v.amount).toLocaleString('en-IN')} received on ${l.sale_order_id}`, link: () => '/sales/payment-orders' },

  // ---- Projects and milestones ----
  { key: 'start_milestone', gate: anyone, risk: 'change', about: 'Start a milestone on a project (AB-…) milestone tracker: that stage of the project (design, cutting, welding, box up, hydro test, packing…) has begun.',
    fields: [ref('milestone_id', 'Milestone', 'open_milestone'), today('actual_start', 'Started on')],
    request: v => ({ method: 'PATCH', path: `/api/milestones/${v.milestone_id}`, body: { status: 'in_progress', actual_start: v.actual_start } }),
    summary: (v, l) => `Start ${l.milestone_id}`, link: () => '/projects' },
  { key: 'close_milestone', gate: anyone, risk: 'change', about: "Close a milestone on a project (AB-…) milestone tracker: that stage of the project (shell welding, box up, design…) is done or finished.",
    fields: [ref('milestone_id', 'Milestone', 'open_milestone'), today('actual_end', 'Finished on'), field('delay_reason', 'Delay reason (if late)', 'longtext', { fill: false })],
    request: v => ({ method: 'PATCH', path: `/api/milestones/${v.milestone_id}`, body: { status: 'done', actual_end: v.actual_end, ...(v.delay_reason ? { delay_reason: v.delay_reason } : null) } }),
    summary: (v, l) => `Close ${l.milestone_id}`, link: () => '/projects' },
  { key: 'send_back_milestone', gate: anyone, risk: 'change', about: 'Send a closed milestone back to its department for rework (reopen it), with a reason.',
    fields: [ref('milestone_id', 'Milestone', 'done_milestone'), need(reason('Reason'))],
    request: v => ({ method: 'POST', path: `/api/milestones/${v.milestone_id}/reopen`, body: { reason: v.reason } }),
    summary: (v, l) => `Send ${l.milestone_id} back for rework`, link: () => '/projects' },

  // ---- Tasks ----
  { key: 'add_task', gate: u => isPM(u) || headDepartments(u).length > 0, risk: 'create', about: "Add a to-do on my own department's task board, with a due date.",
    strip: /^(please )?(add|create)( a)?( new)? (task|to-?do)( to| for)?/i,
    fields: [need(field('title', 'Task')), field('due_date', 'Due', 'date', { when: 'future', default: 'today', required: true }), need(field('department', 'Department', 'enum', { options: DEPT_OPTIONS, mine: true }))],
    // A manager holds no department, so the route takes their task as a raise "from" that department.
    request: (v, user) => ({ method: 'POST', path: '/api/production/tasks', body: { title: v.title, due_date: v.due_date, department: v.department, ...(isPM(user) ? { from_department: v.department } : null) } }),
    summary: v => `Add task “${v.title}” for ${v.department}`, link: () => '/' },
  { key: 'raise_request', gate: u => isPM(u) || headDepartments(u).length > 0, risk: 'create', about: 'Ask or tell another department (Stores, Procurement, QC, Dispatch…) to do something for us: a request raised to that team, optionally about a project.',
    strip: /^(please )?(ask|tell|request|raise( a)?( request)?( for| to)?)\s+(the\s+)?(\w+)(\s+(team|department|dept))?\s+(to\s+)?/i,
    fields: [need(field('department', 'To department', 'enum', { options: DEPT_OPTIONS })), need(field('title', 'What is needed')), field('due_date', 'Due', 'date', { when: 'future', default: 'today', required: true }),
      need(field('from_department', 'From (my department)', 'enum', { options: DEPT_OPTIONS, mine: true, fill: false })), ref('project_id', 'Project', 'project', false)],
    request: v => ({ method: 'POST', path: '/api/production/tasks', body: { department: v.department, from_department: v.from_department, title: v.title, due_date: v.due_date, project_id: v.project_id || null } }),
    summary: v => `Ask ${v.department}: “${v.title}”`, link: () => '/ops' },
  { key: 'complete_task', gate: anyone, risk: 'change', about: 'Mark an open task (a to-do or a request from another department) as done.',
    fields: [ref('task_id', 'Task', 'task')],
    request: v => ({ method: 'PATCH', path: `/api/production/tasks/${v.task_id}`, body: { status: 'done' } }),
    summary: (v, l) => `Mark “${l.task_id}” done`, link: () => '/' },

  // ---- Procurement ----
  { key: 'add_supplier', gate: may('Procurement', 'procurement.supplier.write'), risk: 'create', about: 'Add a new supplier (vendor) to the supplier roster, with phone, email or GST if given.',
    strip: /^(please )?(add|create|new)( a)?( new)? (supplier|vendor)( called| named)?/i,
    fields: [need(field('name', 'Name', 'text', { cut: true })), field('phone', 'Phone', 'phone'), field('email', 'Email', 'email'), field('contact_person', 'Contact person', 'text', { fill: false })],
    request: v => ({ method: 'POST', path: '/api/suppliers', body: { name: v.name, phone: v.phone, email: v.email, contact_person: v.contact_person } }),
    summary: v => `Add supplier ${v.name}`, link: () => '/procurement/suppliers-roster' },
  { key: 'record_supplier_quote', gate: may('Procurement', 'procurement.quotes.record'), risk: 'create', about: "Record a supplier's quoted price for a BOM material line (a quote received by phone, email or visit).",
    fields: [ref('supplier_id', 'Supplier', 'supplier'), ref('bom_item_id', 'Material line', 'bom_line'), need(field('unit_price', 'Unit price (₹)', 'money')), field('uom', 'Per (unit)', 'text', { pick: /\b(kg|kgs|nos|no|mtr|mtrs|meter|set|ltr|pair)\b/i }), field('expected_delivery_date', 'Delivery by', 'date', { when: 'future' })],
    request: v => ({ method: 'POST', path: '/api/supplier-quotes', body: { supplier_id: v.supplier_id, items: [{ bom_item_id: v.bom_item_id, unit_price: v.unit_price, uom: v.uom || null }], expected_delivery_date: v.expected_delivery_date || null, quote_source: 'phone' } }),
    summary: (v, l) => `Record ${l.supplier_id}'s quote of ₹${v.unit_price} for ${l.bom_item_id}`, link: () => '/procurement/selection' },
  { key: 'issue_po', gate: may('Procurement', 'procurement.po.issue'), risk: 'change', about: 'Issue a draft purchase order to its supplier (the PO is final and sent).',
    fields: [ref('po_id', 'Purchase order', 'draft_po')],
    request: v => ({ method: 'PATCH', path: `/api/purchase-orders/${v.po_id}`, body: { action: 'issue' } }),
    summary: (v, l) => `Issue purchase order ${l.po_id}`, link: () => '/procurement/orders' },
  { key: 'cancel_po', gate: may('Procurement', 'procurement.po.cancel'), risk: 'delete', about: 'Cancel a purchase order (draft or issued) that is no longer needed, with a reason.',
    fields: [ref('po_id', 'Purchase order', 'live_po'), reason('Reason')],
    request: v => ({ method: 'PATCH', path: `/api/purchase-orders/${v.po_id}`, body: { action: 'cancel', reason: v.reason || null } }),
    summary: (v, l) => `Cancel purchase order ${l.po_id}`, link: () => '/procurement/orders' },

  // ---- Stores ----
  { key: 'log_gate_entry', gate: may('Stores', 'stores.gir.write'), risk: 'create', about: 'Log a vehicle arriving at the gate with material (a gate inward receipt, GIR): vehicle number, supplier, driver.',
    fields: [field('vehicle_no', 'Vehicle no.', 'text', { pick: VEHICLE }), field('supplier_name', 'Supplier', 'supplier_name'), field('driver_name', 'Driver', 'text', { fill: false }), field('material_ref', 'Material / DC ref', 'text', { fill: false })],
    request: v => ({ method: 'POST', path: '/api/gate-inward-receipts', body: { vehicle_no: v.vehicle_no, supplier_name: v.supplier_name, driver_name: v.driver_name, material_ref: v.material_ref } }),
    summary: v => `Log gate entry${v.vehicle_no ? ` ${v.vehicle_no}` : ''}${v.supplier_name ? ` from ${v.supplier_name}` : ''}`, link: () => '/stores/gir' },
  { key: 'issue_material', gate: u => has(u, 'Stores'), risk: 'create', about: 'Issue material from Stores to production (work in progress) against a BOM line, with a quantity.',
    fields: [ref('bom_item_id', 'Material line', 'bom_line'), need(field('qty', 'Quantity', 'number')), field('notes', 'Note', 'text', { fill: false })],
    request: v => ({ method: 'POST', path: '/api/material-issues', body: { bom_item_id: v.bom_item_id, qty: v.qty, notes: v.notes } }),
    summary: (v, l) => `Issue ${v.qty} of ${l.bom_item_id} to production`, link: () => '/stores/issued' },

  // ---- QC ----
  ...[['approve_inward', 'approved', 'Approve material just received from a supplier that is waiting for QC inward review, so it becomes usable stock.'],
    ['reject_inward', 'rejected', 'Reject material just received from a supplier that is waiting for QC inward review (it is damaged, bent, wrong or failed).']].map(([key, decision, about]) => ({
    key, gate: keyOnly('QC', 'qc.inward.decide'), risk: decision === 'rejected' ? 'delete' : 'change', about,
    fields: [ref('approval_id', 'Material awaiting review', 'inward'), reason(decision === 'rejected' ? 'Why rejected' : 'Note')],
    request: v => ({ method: 'POST', path: `/api/inward-approvals/${v.approval_id}/decide`, body: { decision, reason: v.reason || null } }),
    summary: (v, l) => `${decision === 'approved' ? 'Approve' : 'Reject'} ${l.approval_id} on inward review`, link: () => '/qc/approvals-inward' })),
  { key: 'add_qc_record', gate: either(u => has(u, 'Production'), may('QC', 'qc.test.write')), risk: 'create', about: 'Record a QC test or inspection on a project (hydro test, radiography/NDE, dimensional, material test) with its result.',
    fields: [ref('project_id', 'Project', 'project'), need(field('test_type', 'Test', 'text', { pick: /\b(hydro(static)?( test)?|radiograph(y|ic)( test)?|nde|ndt|dye penetrant|dp test|ultrasonic( test)?|ut|dimensional( inspection)?|visual( inspection)?|material test|mtc)\b/i })),
      need(field('result', 'Result', 'enum', { options: QC_RESULT, default: 'pending' })), field('inspector', 'Inspector', 'text', { fill: false }), today('tested_on', 'Tested on'), field('notes', 'Notes', 'longtext', { fill: false })],
    request: v => ({ method: 'POST', path: '/api/qc-records', body: { project_id: v.project_id, test_type: v.test_type, result: v.result, inspector: v.inspector, tested_on: v.tested_on, notes: v.notes } }),
    summary: (v, l) => `Record ${v.test_type} on ${l.project_id}: ${v.result}`, link: () => '/qc' },
  { key: 'set_qc_result', gate: either(u => has(u, 'Production'), may('QC', 'qc.test.write')), risk: 'change', about: 'Change the result of a QC test or inspection already recorded on a project (an incoming inspection, hydro test, radiography record) to pass, fail or pending.',
    fields: [ref('record_id', 'QC record', 'qc_record'), need(field('result', 'Result', 'enum', { options: QC_RESULT }))],
    request: v => ({ method: 'PATCH', path: `/api/qc-records/${v.record_id}`, body: { result: v.result } }),
    summary: (v, l) => `Set ${l.record_id} to ${v.result}`, link: () => '/qc' },
  { key: 'raise_ncr', gate: async u => { const d = has(u, 'QC') ? 'QC' : has(u, 'Production') ? 'Production' : null; return !!d && canPerformAction(u, d, 'qc.ncr.write'); }, risk: 'create', about: 'Raise a non-conformance report (NCR) on a project: a defect or deviation found.',
    fields: [ref('project_id', 'Project', 'project'), need(field('description', 'What is wrong', 'longtext')), need(field('severity', 'Severity', 'enum', { options: SEVERITY, default: 'minor' }))],
    request: v => ({ method: 'POST', path: '/api/ncrs', body: { project_id: v.project_id, description: v.description, severity: v.severity } }),
    summary: (v, l) => `Raise a ${v.severity} NCR on ${l.project_id}`, link: () => '/qc/ncr' },
  { key: 'decide_predispatch', gate: async u => { if (isPM(u)) return true; const role = has(u, 'QC') && departmentRole(u, 'QC') === 'head' ? 'qc' : has(u, 'Production') && departmentRole(u, 'Production') === 'head' ? 'production' : null; return !!role && canPerformAction(u, role === 'qc' ? 'QC' : 'Production', `${role}.predispatch.decide`); }, risk: 'change', about: "Approve or reject a packing list in pre-dispatch review (QC's or Production's sign-off before it ships).",
    fields: [ref('approval_id', 'Packing list in review', 'predispatch'), need(field('decision', 'Decision', 'enum', { options: DECISION })), reason('Note')],
    request: v => ({ method: 'POST', path: `/api/pre-dispatch-approvals/${v.approval_id}/decide`, body: { decision: v.decision, reason: v.reason || null } }),
    summary: (v, l) => `${v.decision === 'rejected' ? 'Reject' : 'Approve'} ${l.approval_id} for dispatch`, link: () => '/qc/approvals-predispatch' },
  { key: 'delete_qc_record', gate: either(u => has(u, 'Production'), may('QC', 'qc.test.delete')), risk: 'delete', about: 'Delete a QC test record entered by mistake.',
    fields: [ref('record_id', 'QC record', 'qc_record')],
    request: v => ({ method: 'DELETE', path: `/api/qc-records/${v.record_id}` }),
    summary: (v, l) => `Delete QC record ${l.record_id}`, link: () => '/qc' },

  // ---- Production ----
  ...[['start_jobcard_stage', 'start', 'Start a stage on a shop-floor job card (JC-…), usually naming the fitter or welder doing it.'],
    ['finish_jobcard_stage', 'finish', 'Finish a stage on a shop-floor job card (JC-…): that step on the job card is complete.']].map(([key, action, about]) => ({
    key, gate: may('Production', 'production.jobsheet.write'), risk: 'change', about,
    fields: [ref('stage_id', 'Job card stage', 'stage'), ref('fitter_employee_id', 'Fitter / welder', 'employee', false), today('date', 'Date')],
    request: async v => {
      const [st] = await queryAll('SELECT sheet_id FROM job_sheet_stages WHERE id = ?', [v.stage_id]);
      if (!st) throw new Error('That job card stage no longer exists');
      return { method: 'PATCH', path: `/api/job-sheets/${st.sheet_id}/stages/${v.stage_id}`, body: { action, date: v.date, ...(v.fitter_employee_id ? { fitter_employee_id: v.fitter_employee_id } : null) } };
    },
    summary: (v, l) => `${action === 'start' ? 'Start' : 'Finish'} ${l.stage_id}`, link: () => '/production/shop/jobcards' })),

  // ---- Dispatch ----
  { key: 'set_packing_status', gate: may('Dispatch', 'dispatch.packing.status'), risk: 'change', about: 'Change a packing list status: packed (ready), dispatched (shipped), or back to draft.',
    fields: [ref('packing_id', 'Packing list', 'packing'), need(field('status', 'New status', 'enum', { options: PACKING_STATUS }))],
    request: v => ({ method: 'PATCH', path: `/api/packing/${v.packing_id}`, body: { status: v.status } }),
    summary: (v, l) => `Set ${l.packing_id} to ${v.status}`, link: r => '/dispatch' },
  { key: 'submit_packing_approval', gate: may('Dispatch', 'dispatch.packing.submit_approval'), risk: 'change', about: 'Submit a packed packing list for pre-dispatch approval by QC and Production.',
    fields: [ref('packing_id', 'Packing list', 'packing')],
    request: v => ({ method: 'POST', path: `/api/packing/${v.packing_id}/submit-for-approval`, body: {} }),
    summary: (v, l) => `Submit ${l.packing_id} for dispatch approval`, link: () => '/dispatch/approvals' },
  { key: 'delete_packing_list', gate: may('Dispatch', 'dispatch.packing.edit'), risk: 'delete', about: 'Delete a draft packing list made by mistake.',
    fields: [ref('packing_id', 'Draft packing list', 'draft_packing')],
    request: v => ({ method: 'DELETE', path: `/api/packing/${v.packing_id}` }),
    summary: (v, l) => `Delete packing list ${l.packing_id}`, link: () => '/dispatch' },

  // ---- HR ----
  { key: 'mark_attendance', gate: may('HR', 'hr.attendance.mark'), risk: 'change', about: 'Mark an employee present, absent, half day or on leave for a day.',
    fields: [ref('employee_id', 'Employee', 'employee'), need(field('status', 'Attendance', 'enum', { options: ATTENDANCE })), today()],
    request: v => ({ method: 'POST', path: '/api/attendance', body: { employee_id: v.employee_id, date: v.date, status: v.status } }),
    summary: (v, l) => `Mark ${l.employee_id} ${ATTENDANCE.find(o => o.value === v.status)?.label.toLowerCase() || v.status} on ${v.date}`, link: () => '/hr' },
  { key: 'apply_leave', gate: may('HR', 'hr.leave.request'), risk: 'create', about: 'Apply for leave for an employee: the type of leave and from which date to which date.',
    fields: [ref('employee_id', 'Employee', 'employee'), ref('leave_type_id', 'Leave type', 'leave_type'), field('from_date', 'From', 'date', { range: 0, required: true }), field('to_date', 'To', 'date', { range: 1, required: true }), reason('Reason')],
    request: v => ({ method: 'POST', path: '/api/leave-requests', body: { employee_id: v.employee_id, leave_type_id: v.leave_type_id, from_date: v.from_date, to_date: v.to_date, reason: v.reason || null } }),
    summary: (v, l) => `${l.leave_type_id} for ${l.employee_id}, ${v.from_date} to ${v.to_date}`, link: () => '/hr' },

  // ---- Service ----
  { key: 'log_service_visit', gate: may('Installation', 'installation.visit.write'), risk: 'create', about: "Plan or log a service visit to a customer's site for a project (installation, commissioning, breakdown).",
    fields: [ref('project_id', 'Project', 'project'), need(field('description', 'Purpose of visit', 'text')), field('visit_date', 'Visit date', 'date', { default: 'today', required: true }),
      need(field('status', 'Status', 'enum', { options: [opt('planned', 'Planned', /\bplan(ned)?|schedule[d]?|will|going|next\b/i), opt('done', 'Done', /\bdone|visited|completed|went|finished\b/i)], default: 'planned' }))],
    request: v => ({ method: 'POST', path: '/api/installation-visits', body: { project_id: v.project_id, description: v.description, visit_date: v.visit_date, status: v.status } }),
    summary: (v, l) => `${v.status === 'done' ? 'Log' : 'Plan'} a service visit to ${l.project_id} on ${v.visit_date}`, link: () => '/installation' },

  // ---- More Sales / CRM ----
  { key: 'edit_enquiry_contact', gate: u => has(u, ...S), risk: 'change', about: "Change or correct the phone number, email or contact name on an existing enquiry (lead) that is already in the system.",
    fields: [ref('lead_id', 'Enquiry', 'enquiry'), field('lead_name', 'Contact name', 'text', { fill: false }), field('phone', 'Phone', 'phone'), field('email', 'Email', 'email')],
    request: v => ({ method: 'PATCH', path: `/api/leads/${v.lead_id}`, body: Object.fromEntries(['lead_name', 'phone', 'email'].filter(k => v[k]).map(k => [k, v[k]])) }),
    summary: (v, l) => `Update the contact details on ${l.lead_id}`, link: (r, v) => `/sales/leads?highlight=LD-${v.lead_id}` },
  { key: 'convert_enquiry', gate: crmAny('crm.lead.convert'), risk: 'create', about: 'Convert an enquiry into a customer (add the enquiry to the customer master).',
    fields: [ref('lead_id', 'Enquiry', 'open_enquiry'), ref('customer_id', 'Existing customer (if already there)', 'customer', false)],
    request: v => ({ method: 'POST', path: `/api/leads/${v.lead_id}/convert`, body: v.customer_id ? { customer_id: v.customer_id } : { create_new: true } }),
    summary: (v, l) => (v.customer_id ? `Link ${l.lead_id} to customer ${l.customer_id}` : `Make ${l.lead_id} a customer`), link: () => '/sales/customers' },
  { key: 'close_sales_call', gate: u => has(u, ...S), risk: 'change', about: 'Close the sales call on an enquiry: no more follow-up is needed for now.',
    fields: [ref('lead_id', 'Enquiry', 'open_enquiry')],
    request: v => ({ method: 'POST', path: `/api/leads/${v.lead_id}/close-sales-call`, body: {} }),
    summary: (v, l) => `Close the sales call on ${l.lead_id}`, link: (r, v) => `/sales/leads?highlight=LD-${v.lead_id}` },
  { key: 'add_crm_task', gate: crmFirst('crm.task.create'), risk: 'create', about: 'Add a sales follow-up task on an enquiry (call back, send brochure, visit) with a due date.',
    strip: /^(please )?(add|create|set)( a)?( sales)? (follow[- ]?up|reminder|task)( to| for)?/i,
    fields: [ref('lead_id', 'Enquiry', 'enquiry'), need(field('title', 'What to do')), field('due_date', 'Due', 'date', { when: 'future', default: 'today', required: true })],
    request: v => ({ method: 'POST', path: '/api/crm-tasks', body: { lead_id: v.lead_id, title: v.title, due_date: v.due_date } }),
    summary: (v, l) => `Add follow-up “${v.title}” on ${l.lead_id}`, link: () => '/sales/tasks' },
  { key: 'complete_crm_task', gate: crmAny('crm.task.write'), risk: 'change', about: 'Mark a sales follow-up task on an enquiry or customer as done.',
    fields: [ref('task_id', 'Follow-up task', 'crm_task')],
    request: v => ({ method: 'PATCH', path: `/api/crm-tasks/${v.task_id}`, body: { status: 'done' } }),
    summary: (v, l) => `Mark follow-up “${l.task_id}” done`, link: () => '/sales/tasks' },
  { key: 'set_opportunity_stage', gate: crmAny('crm.opportunity.write'), risk: 'change', about: 'Move a pipeline opportunity (deal) to another stage.',
    fields: [ref('opportunity_id', 'Opportunity', 'opportunity'), need(field('stage', 'New stage', 'enum', { options: stageOptions }))],
    request: v => ({ method: 'PATCH', path: `/api/opportunities/${v.opportunity_id}`, body: { stage: v.stage } }),
    summary: (v, l) => `Move ${l.opportunity_id} to ${v.stage}`, link: () => '/pipeline' },
  { key: 'approve_quotation_discount', gate: async u => isDepartmentHead(u, 'Sales') && canPerformAction(u, 'Sales', 'sales.quotation.approve_discount'), risk: 'change',
    about: 'Approve the discount on a quotation that is waiting for the Sales Head to approve it.',
    fields: [ref('quotation_id', 'Quotation', 'discount_quotation')],
    request: v => ({ method: 'POST', path: `/api/quotations/${v.quotation_id}/approve`, body: {} }),
    summary: (v, l) => `Approve the discount on ${l.quotation_id}`, link: () => '/sales/quotations' },
  { key: 'convert_quotation_to_order', gate: crm('sales.quotation.convert'), risk: 'create', about: 'Convert an accepted quotation into a sale order.',
    fields: [ref('quotation_id', 'Accepted quotation', 'accepted_quotation')],
    request: v => ({ method: 'POST', path: `/api/quotations/${v.quotation_id}/convert`, body: {} }),
    summary: (v, l) => `Make a sale order from ${l.quotation_id}`, link: () => '/sales/sale-orders' },
  { key: 'set_order_status', gate: salesOrPm('sales.saleorder.status'), risk: 'change', about: 'Change the tracking status of a sale order (pending, ready, work in progress, dispatched, closed).',
    fields: [ref('sale_order_id', 'Sale order', 'sale_order'), need(field('track_status', 'New status', 'enum', { options: [opt('Pending', 'Pending', /\bpending\b/i),
      opt('Ready', 'Ready', /\bready\b/i), opt('WIP', 'Work in progress', /\bwip|in progress|work in progress|manufactur/i), opt('Dispatched', 'Dispatched', /\bdispatch(ed)?|shipped\b/i), opt('Closed', 'Closed', /\bclose[ds]?\b/i)] }))],
    request: v => ({ method: 'PATCH', path: `/api/sale-orders/${v.sale_order_id}`, body: { track_status: v.track_status } }),
    summary: (v, l) => `Set ${l.sale_order_id} to ${v.track_status}`, link: () => '/sales/payment-orders' },
  { key: 'record_invoice_receipt', gate: async u => (isPM(u) || has(u, ...S) ? (await requireCrmAction(u, 'sales.invoice.receipt.write')) === null : has(u, 'Accounts') && canPerformAction(u, 'Accounts', 'accounts.invoice.receipt.write')),
    risk: 'create', about: 'Record money received from a customer against a sales invoice (INV-…).',
    fields: [ref('invoice_id', 'Invoice', 'invoice'), need(field('amount', 'Amount (₹)', 'money')), today('receipt_date', 'Received on'), field('payment_mode', 'Mode', 'enum', { options: PAY_MODES }), field('reference', 'Reference / UTR', 'text', { fill: false })],
    request: v => ({ method: 'POST', path: `/api/sales-invoices/${v.invoice_id}/receipts`, body: { amount: v.amount, receipt_date: v.receipt_date, payment_mode: v.payment_mode, reference: v.reference } }),
    summary: (v, l) => `Record ₹${Number(v.amount).toLocaleString('en-IN')} received on ${l.invoice_id}`, link: () => '/sales/invoices' },

  // ---- Projects ----
  { key: 'create_project', gate: headOf('Design'), risk: 'create', about: 'Create a new project (boiler order) for a customer.',
    strip: /^(please )?(add|create|open|start)( a)?( new)? project( for)?/i,
    fields: [need(field('customer_name', 'Customer', 'text', { cut: true })), ref('sale_order_id', 'Sale order', 'sale_order', false)],
    request: v => ({ method: 'POST', path: '/api/projects', body: { customer_name: v.customer_name, ...(v.sale_order_id ? { sale_order_id: v.sale_order_id } : null) } }),
    summary: v => `Create a project for ${v.customer_name}`, link: r => (r.id ? `/projects/${r.id}` : '/projects') },
  { key: 'release_bom', gate: u => has(u, 'Design', 'Engineering'), risk: 'change', about: "Release a project's BOM (bill of materials) so Procurement and Stores can start on it.",
    fields: [ref('project_id', 'Project', 'project')],
    request: v => ({ method: 'POST', path: `/api/projects/${v.project_id}/release-bom`, body: {} }),
    summary: (v, l) => `Release the BOM of ${l.project_id}`, link: () => '/engineering' },
  { key: 'set_ecn_status', gate: u => canEngineeringAction(u, 'engineering.ecn.approve'), risk: 'change', about: 'Approve or reject an engineering change note (ECN) on a BOM.',
    fields: [ref('ecn_id', 'Change note', 'pending_ecn'), need(field('status', 'Decision', 'enum', { options: DECISION }))],
    request: v => ({ method: 'PATCH', path: `/api/engineering-change-notes/${v.ecn_id}`, body: { status: v.status } }),
    summary: (v, l) => `${v.status === 'approved' ? 'Approve' : 'Reject'} change note ${l.ecn_id}`, link: () => '/engineering' },
  { key: 'cancel_bom_line', gate: u => has(u, 'Engineering', 'Design'), risk: 'delete', about: 'Cancel a BOM material line that is no longer needed (before it is received).',
    fields: [ref('bom_item_id', 'Material line', 'bom_line'), reason('Reason')],
    request: v => ({ method: 'POST', path: `/api/bom-items/${v.bom_item_id}/cancel`, body: { reason: v.reason || null } }),
    summary: (v, l) => `Cancel ${l.bom_item_id}`, link: () => '/engineering' },

  // ---- Procurement / Accounts ----
  { key: 'raise_pr_for_line', gate: may('Stores', 'stores.procure'), risk: 'create', about: 'Stores sends a specific existing BOM material line that is not in stock to Procurement to buy (raises a purchase request for that line).',
    fields: [ref('bom_item_id', 'Material line', 'bom_line')],
    request: v => ({ method: 'POST', path: `/api/bom-items/${v.bom_item_id}/raise-pr`, body: {} }),
    summary: (v, l) => `Raise a purchase request for ${l.bom_item_id}`, link: () => '/procurement' },
  { key: 'add_delivery_followup', gate: may('Procurement', 'procurement.delivery_followup.write'), risk: 'create', about: "Note a follow-up with a supplier about a late or due delivery on a material line (what they said, new date).",
    fields: [ref('bom_item_id', 'Material line', 'bom_line'), need(field('note', 'What the supplier said', 'longtext'))],
    request: v => ({ method: 'POST', path: `/api/bom-items/${v.bom_item_id}/delivery-followups`, body: { note: v.note } }),
    summary: (v, l) => `Note a delivery follow-up on ${l.bom_item_id}`, link: () => '/procurement/overdues' },
  { key: 'add_delivery_lot', gate: may('Procurement', 'procurement.po.delivery_lots.write'), risk: 'create', about: 'Schedule or plan a delivery lot on an issued purchase order (PO): how much of a PO line the supplier will deliver on which date.',
    fields: [ref('po_item_id', 'PO line', 'po_line'), need(field('qty', 'Quantity', 'number')), field('expected_delivery_date', 'Expected on', 'date', { when: 'future', required: true }), field('notes', 'Note', 'text', { fill: false })],
    request: async v => {
      const [pi] = await queryAll('SELECT po_id FROM po_items WHERE id = ?', [v.po_item_id]);
      if (!pi) throw new Error('That PO line no longer exists');
      return { method: 'POST', path: `/api/purchase-orders/${pi.po_id}/delivery-lots`, body: { expected_delivery_date: v.expected_delivery_date, notes: v.notes, items: [{ po_item_id: v.po_item_id, qty: v.qty }] } };
    },
    summary: (v, l) => `Schedule ${v.qty} of ${l.po_item_id} for ${v.expected_delivery_date}`, link: () => '/procurement/delivery-lots' },
  { key: 'record_vendor_bill', gate: may('Procurement', 'procurement.vendor_bill.write'), risk: 'create', about: "Record a supplier's bill (invoice) against an issued purchase order.",
    fields: [ref('po_id', 'Purchase order', 'issued_po'), need(field('bill_no', 'Supplier bill no.', 'text', { fill: false })), today('bill_date', 'Bill date'),
      field('gst_rate_pct', 'GST %', 'number', { fill: false, default: 18 })],
    request: v => ({ method: 'POST', path: `/api/purchase-orders/${v.po_id}/record-bill`, body: { bill_no: v.bill_no, bill_date: v.bill_date, gst_rate_pct: v.gst_rate_pct } }),
    summary: (v, l) => `Record bill ${v.bill_no} against ${l.po_id}`, link: () => '/procurement/vendor-bills' },
  { key: 'approve_vendor_bill', gate: may('Procurement', 'procurement.vendor_bill.status'), risk: 'change', about: "Approve a supplier's bill for payment.",
    fields: [ref('bill_id', 'Vendor bill', 'vendor_bill')],
    request: v => ({ method: 'PATCH', path: `/api/vendor-bills/${v.bill_id}`, body: { status: 'approved' } }),
    summary: (v, l) => `Approve bill ${l.bill_id}`, link: () => '/procurement/vendor-bills' },
  { key: 'pay_vendor_bill', gate: async u => (isPM(u) || has(u, 'Procurement') ? canPerformAction(u, 'Procurement', 'procurement.vendor_bill.payment.write') : has(u, 'Accounts') && canPerformAction(u, 'Accounts', 'accounts.vendor_bill.payment.write')),
    risk: 'create', about: "Record a payment made to a supplier against an approved bill.",
    fields: [ref('bill_id', 'Vendor bill', 'vendor_bill'), need(field('amount', 'Amount (₹)', 'money')), today('payment_date', 'Paid on'), field('payment_mode', 'Mode', 'enum', { options: PAY_MODES }), field('reference', 'Reference / UTR', 'text', { fill: false })],
    request: v => ({ method: 'POST', path: `/api/vendor-bills/${v.bill_id}/payments`, body: { amount: v.amount, payment_date: v.payment_date, payment_mode: v.payment_mode, reference: v.reference } }),
    summary: (v, l) => `Pay ₹${Number(v.amount).toLocaleString('en-IN')} on bill ${l.bill_id}`, link: () => '/accounts' },

  // ---- Stores ----
  { key: 'receive_bom_line', gate: may('Stores', 'stores.bom.receive'), risk: 'create', about: 'Receive material for a BOM line from a supplier into Stores (quantity, supplier, GRN and invoice numbers).',
    fields: [ref('bom_item_id', 'Material line', 'bom_line'), need(field('qty_text', 'Quantity received', 'number')), ref('supplier_id', 'Supplier', 'supplier'),
      need(field('grn_ref', 'GRN no.', 'text', { fill: false })), need(field('invoice_no', 'Supplier invoice no.', 'text', { fill: false }))],
    request: v => ({ method: 'POST', path: `/api/bom-items/${v.bom_item_id}/receive`, body: { qty_text: String(v.qty_text), receipt: { supplier_id: v.supplier_id, grn_ref: v.grn_ref, invoice_no: v.invoice_no } } }),
    summary: (v, l) => `Receive ${v.qty_text} of ${l.bom_item_id}`, link: () => '/stores/inward' },
  { key: 'add_stock_receipt', gate: may('Stores', 'stores.inventory.write'), risk: 'create', about: 'Open a stock receipt (inward batch) for a supplier delivery with its GRN and invoice numbers.',
    fields: [ref('supplier_id', 'Supplier', 'supplier'), field('grn_ref', 'GRN no.', 'text', { fill: false }), field('invoice_no', 'Invoice no.', 'text', { fill: false }), ref('po_id', 'Purchase order', 'issued_po', false)],
    request: v => ({ method: 'POST', path: '/api/stock-receipts', body: { supplier_id: v.supplier_id, grn_ref: v.grn_ref, invoice_no: v.invoice_no, po_id: v.po_id || null } }),
    summary: (v, l) => `Open a stock receipt from ${l.supplier_id}`, link: () => '/stores/inward' },
  { key: 'reserve_stock', gate: may('Stores', 'stores.reservation.reserve'), risk: 'change', about: 'Stores reserves stock already on hand in inventory against a specific BOM material line (by Stores itself, not a request to Stores).',
    fields: [ref('inventory_item_id', 'Stock item', 'stock_item'), ref('bom_item_id', 'For material line', 'bom_line'), need(field('qty', 'Quantity', 'number'))],
    request: v => ({ method: 'POST', path: `/api/inventory-items/${v.inventory_item_id}/reserve`, body: { bom_item_id: v.bom_item_id, qty: v.qty } }),
    summary: (v, l) => `Reserve ${v.qty} of ${l.inventory_item_id} for ${l.bom_item_id}`, link: () => '/stores/allocations' },
  { key: 'reserve_piece', gate: may('Stores', 'stores.reservation.reserve'), risk: 'change', about: 'Reserve a stock piece (plate/section piece PL-…/LN-…) for a BOM material line.',
    fields: [ref('piece_id', 'Stock piece', 'piece'), ref('bom_item_id', 'For material line', 'bom_line')],
    request: async v => {
      const [b] = await queryAll('SELECT project_id FROM bom_items WHERE id = ?', [v.bom_item_id]);
      return { method: 'POST', path: `/api/stock-pieces/${v.piece_id}/reserve`, body: { bom_item_id: v.bom_item_id, project_id: b?.project_id ?? null } };
    },
    summary: (v, l) => `Reserve ${l.piece_id} for ${l.bom_item_id}`, link: () => '/stores/inventory' },
  { key: 'issue_reservation', gate: may('Stores', 'stores.reservation.issue'), risk: 'change', about: 'Issue reserved stock (a reservation) to production.',
    fields: [ref('reservation_id', 'Reservation', 'reservation')],
    request: v => ({ method: 'POST', path: `/api/inventory-reservations/${v.reservation_id}/issue`, body: {} }),
    summary: (v, l) => `Issue ${l.reservation_id}`, link: () => '/stores/allocations' },
  { key: 'release_reservation', gate: may('Stores', 'stores.reservation.release'), risk: 'change', about: 'Release (un-reserve) stock that was reserved, so it is free again.',
    fields: [ref('reservation_id', 'Reservation', 'reservation')],
    request: v => ({ method: 'POST', path: `/api/inventory-reservations/${v.reservation_id}/release`, body: {} }),
    summary: (v, l) => `Release ${l.reservation_id}`, link: () => '/stores/allocations' },
  { key: 'scrap_piece', gate: async u => { const d = has(u, 'Production') ? 'Production' : has(u, 'Stores') ? 'Stores' : null; return !!d && canPerformAction(u, d, d === 'Production' ? 'production.bom.cut' : 'stores.inventory.write'); },
    risk: 'delete', about: 'Scrap a cut piece (remnant) returned from production that is not usable.',
    fields: [ref('piece_id', 'Returned piece', 'returned_piece')],
    request: v => ({ method: 'POST', path: `/api/stock-pieces/${v.piece_id}/scrap`, body: {} }),
    summary: (v, l) => `Scrap ${l.piece_id}`, link: () => '/stores/inward' },
  { key: 'close_gate_entry', gate: may('Stores', 'stores.gir.write'), risk: 'change', about: 'Close a gate inward entry (GIR) once the material is received, with the GRN number.',
    fields: [ref('gir_id', 'Gate entry', 'open_gir'), need(field('grn_ref', 'GRN no.', 'text', { fill: false }))],
    request: v => ({ method: 'PATCH', path: `/api/gate-inward-receipts/${v.gir_id}`, body: { close: true, grn_ref: v.grn_ref } }),
    summary: (v, l) => `Close gate entry ${l.gir_id}`, link: () => '/stores/gir' },
  { key: 'create_gate_pass', gate: async u => { if (!has(u, 'Stores', 'Dispatch')) return false; return canPerformAction(u, has(u, 'Stores') ? 'Stores' : 'Dispatch', 'stores.gatepass.write'); },
    risk: 'create', about: 'Make a gate pass for material going out of the gate (returnable or non-returnable): to whom, what, why.',
    fields: [need(field('party', 'Going to', 'text', { fill: false })), need(field('item', 'Item going out')), field('qty', 'Quantity', 'number'), field('purpose', 'Purpose', 'text', { fill: false }),
      need(field('type', 'Type', 'enum', { options: [opt('returnable', 'Returnable', /\breturnable|will come back|for repair|on loan\b/i), opt('non_returnable', 'Non-returnable', /\bnon[- ]?returnable\b/i)], default: 'non_returnable' })),
      field('expected_return_date', 'Return by', 'date', { when: 'future' })],
    request: v => ({ method: 'POST', path: '/api/gate-passes', body: { type: v.type, party: v.party, purpose: v.purpose, expected_return_date: v.expected_return_date || null, items: [{ description: v.item, qty: v.qty || 1 }] } }),
    summary: v => `Gate pass for ${v.item} to ${v.party}`, link: () => '/dispatch/gatepasses' },
  ...[['approve_gate_pass', 'approve', 'stores.gatepass.approve', 'Approve a draft gate pass (GP-…).'], ['issue_gate_pass', 'issue', 'stores.gatepass.write', 'Issue an approved gate pass (GP-…): the material leaves the gate.'],
    ['cancel_gate_pass', 'cancel', 'stores.gatepass.write', 'Cancel a gate pass (GP-…) that is no longer needed.']].map(([key, action, akey, about]) => ({
    key, gate: async u => { if (!has(u, 'Stores', 'Dispatch')) return false; const d = has(u, 'Stores') ? 'Stores' : 'Dispatch'; return (await canPerformAction(u, d, 'stores.gatepass.write')) && canPerformAction(u, d, akey); },
    risk: action === 'cancel' ? 'delete' : 'change', about, fields: [ref('gate_pass_id', 'Gate pass', 'gate_pass')],
    request: v => ({ method: 'PATCH', path: `/api/gate-passes/${v.gate_pass_id}`, body: { action } }),
    summary: (v, l) => `${action[0].toUpperCase()}${action.slice(1)} ${l.gate_pass_id}`, link: () => '/dispatch/gatepasses' })),

  // ---- QC ----
  { key: 'disposition_ncr', gate: may('QC', 'qc.ncr.disposition'), risk: 'change', about: 'Decide what to do with an NCR (non-conformance): rework, repair, scrap or use as is.',
    fields: [ref('ncr_id', 'NCR', 'ncr'), need(field('disposition', 'Disposition', 'enum', { options: [opt('rework', 'Rework', /\brework|redo\b/i), opt('repair', 'Repair', /\brepair|fix\b/i),
      opt('scrap', 'Scrap', /\bscrap|discard\b/i), opt('use_as_is', 'Use as is', /\buse as is|accept as is|use it as is\b/i)] })), field('disposition_notes', 'Notes', 'longtext', { fill: false })],
    request: v => ({ method: 'POST', path: `/api/ncrs/${v.ncr_id}/disposition`, body: { disposition: v.disposition, disposition_notes: v.disposition_notes } }),
    summary: (v, l) => `Disposition ${l.ncr_id}: ${v.disposition.replace(/_/g, ' ')}`, link: () => '/qc/ncr' },
  { key: 'verify_ncr', gate: may('QC', 'qc.ncr.verify'), risk: 'change', about: 'Verify an NCR: QC checked the rework or repair and it is now fine.',
    fields: [ref('ncr_id', 'NCR', 'ncr')],
    request: v => ({ method: 'POST', path: `/api/ncrs/${v.ncr_id}/verify`, body: {} }),
    summary: (v, l) => `Verify ${l.ncr_id}`, link: () => '/qc/ncr' },
  { key: 'close_ncr', gate: may('QC', 'qc.ncr.close'), risk: 'change', about: 'Close a verified NCR.',
    fields: [ref('ncr_id', 'NCR', 'ncr')],
    request: v => ({ method: 'POST', path: `/api/ncrs/${v.ncr_id}/close`, body: {} }),
    summary: (v, l) => `Close ${l.ncr_id}`, link: () => '/qc/ncr' },
  { key: 'qc_release_job_card', gate: may('QC', 'qc.hold.release'), risk: 'change', about: 'Release a job card (JC-…) that is held for a QC check, so production can carry on.',
    fields: [ref('job_card_id', 'Held job card', 'held_job_card')],
    request: v => ({ method: 'POST', path: `/api/job-cards/${v.job_card_id}/qc-release`, body: {} }),
    summary: (v, l) => `Release ${l.job_card_id} from QC hold`, link: () => '/qc' },

  // ---- Production ----
  { key: 'log_job_card_time', gate: may('Production', 'production.jobcard.time_log'), risk: 'create', about: 'Log time a worker spent on a job card (JC-…), in minutes or hours.',
    fields: [ref('job_card_id', 'Job card', 'open_job_card'), ref('employee_id', 'Worker', 'employee'), need(field('minutes', 'Minutes', 'number', { parse: q => { const h = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\b/i.exec(q), m = /(\d+)\s*(?:m|min|mins|minutes?)\b/i.exec(q); return h || m ? Math.round((h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0)) || null : null; } }))],
    request: v => ({ method: 'POST', path: `/api/job-cards/${v.job_card_id}/time-logs`, body: { employee_id: v.employee_id, minutes: v.minutes } }),
    summary: (v, l) => `Log ${v.minutes} min by ${l.employee_id} on ${l.job_card_id}`, link: () => '/production/shop/jobcards' },
  { key: 'mark_worker_day', gate: may('Production', 'production.attendance.mark'), risk: 'change', about: "Mark a shop-floor worker present, half day or absent on the Production daily sheet.",
    fields: [ref('employee_id', 'Worker', 'employee'), need(field('status', 'Attendance', 'enum', { options: ATTENDANCE.filter(o => o.value !== 'leave') })), today()],
    request: v => ({ method: 'POST', path: '/api/production/worker-days', body: { employee_id: v.employee_id, date: v.date, status: v.status } }),
    summary: (v, l) => `Mark ${l.employee_id} ${v.status} on ${v.date}`, link: () => '/production/shop' },

  // ---- Dispatch ----
  { key: 'create_packing_from_bom', gate: may('Dispatch', 'dispatch.packing.generate'), risk: 'create', about: "Make a packing list for a project from its items that are ready to pack.",
    fields: [ref('project_id', 'Project', 'project')],
    request: v => ({ method: 'POST', path: '/api/packing/from-bom', body: { project_id: v.project_id } }),
    summary: (v, l) => `Make a packing list for ${l.project_id}`, link: () => '/dispatch' },
  { key: 'acknowledge_delivery', gate: may('Dispatch', 'dispatch.packing.acknowledge'), risk: 'change', about: "Record that the customer received a dispatched packing list (PL-…) and how it arrived: received fine, damaged, or short/different.",
    fields: [ref('packing_id', 'Dispatched packing list', 'dispatched_packing'), need(field('status', 'Received as', 'enum', { options: [opt('accepted', 'Accepted', /\baccepted|received( fine| ok| well)?|fine|ok\b/i),
      opt('damaged', 'Damaged', /\bdamage[ds]?|broken\b/i), opt('discrepancy', 'Discrepancy', /\bshort|missing|discrepanc|wrong|mismatch\b/i)] })), field('notes', 'Notes', 'longtext', { fill: false })],
    request: v => ({ method: 'POST', path: `/api/packing/${v.packing_id}/acknowledge`, body: { status: v.status, notes: v.notes } }),
    summary: (v, l) => `Record ${l.packing_id} as ${v.status}`, link: () => '/dispatch' },
  { key: 'create_shipment', gate: may('Dispatch', 'dispatch.packing.edit'), risk: 'create', about: 'Combine two packing lists going on the same truck into one shipment, with the vehicle number.',
    fields: [ref('packing_id', 'Packing list', 'packing'), ref('packing_id_2', 'Second packing list', 'packing'),
      field('vehicle_no', 'Vehicle no.', 'text', { pick: VEHICLE }), field('dispatch_through', 'Transporter', 'text', { fill: false })],
    request: v => ({ method: 'POST', path: '/api/shipments', body: { list_ids: [v.packing_id, v.packing_id_2], vehicle_no: v.vehicle_no, dispatch_through: v.dispatch_through } }),
    summary: (v, l) => `Ship ${l.packing_id} and ${l.packing_id_2} together`, link: () => '/dispatch/shipments' },

  // ---- HR ----
  ...[['approve_leave', 'approved', 'Approve a pending leave request.'], ['reject_leave', 'rejected', 'Reject a pending leave request.']].map(([key, status, about]) => ({
    key, gate: may('HR', 'hr.leave.decide'), risk: status === 'rejected' ? 'delete' : 'change', about, fields: [ref('leave_request_id', 'Leave request', 'pending_leave')],
    request: v => ({ method: 'PATCH', path: `/api/leave-requests/${v.leave_request_id}`, body: { status } }),
    summary: (v, l) => `${status === 'approved' ? 'Approve' : 'Reject'} ${l.leave_request_id}`, link: () => '/hr' })),
  { key: 'allocate_leave', gate: may('HR', 'hr.leave.allocate'), risk: 'change', about: 'Allocate a number of leave days of a type to an employee for a year.',
    fields: [ref('employee_id', 'Employee', 'employee'), ref('leave_type_id', 'Leave type', 'leave_type'), need(field('allocated', 'Days', 'number')),
      field('year', 'Year', 'number', { pick: /\b20\d\d\b/, default: Number(todayISO().slice(0, 4)), required: true })],
    request: v => ({ method: 'POST', path: '/api/leave-allocations', body: { employee_id: v.employee_id, leave_type_id: v.leave_type_id, allocated: v.allocated, year: Number(v.year) } }),
    summary: (v, l) => `Give ${l.employee_id} ${v.allocated} days of ${l.leave_type_id} for ${v.year}`, link: () => '/hr' },
  { key: 'submit_expense_claim', gate: u => isInternal(u) && (!has(u, 'HR') || canPerformAction(u, 'HR', 'hr.expense.submit')), risk: 'create',
    about: 'Submit an expense claim (money spent on travel, food, local purchase…) for reimbursement.',
    fields: [ref('employee_id', 'Employee (HR only)', 'employee', false), need(field('amount', 'Amount (₹)', 'money')), need(field('description', 'What for')), today('claim_date', 'Date')],
    request: v => ({ method: 'POST', path: '/api/expense-claims', body: { employee_id: v.employee_id || null, claim_date: v.claim_date, items: [{ amount: v.amount, description: v.description, expense_date: v.claim_date }] } }),
    summary: v => `Claim ₹${Number(v.amount).toLocaleString('en-IN')} for ${v.description}`, link: () => '/hr' },
  ...[['approve_expense_claim', 'approved', "Approve an employee's expense claim for reimbursement (HR expense claims: taxi, food, hotel spent by a staff member)."], ['reject_expense_claim', 'rejected', "Reject an employee's expense claim for reimbursement (HR expense claims)."]].map(([key, status, about]) => ({
    key, gate: may('HR', 'hr.expense.decide'), risk: status === 'rejected' ? 'delete' : 'change', about, fields: [ref('claim_id', 'Expense claim', 'expense_claim')],
    request: v => ({ method: 'PATCH', path: `/api/expense-claims/${v.claim_id}`, body: { status } }),
    summary: (v, l) => `${status === 'approved' ? 'Approve' : 'Reject'} the claim ${l.claim_id}`, link: () => '/hr' })),
  { key: 'record_advance', gate: may('HR', 'hr.advance.write'), risk: 'create', about: 'Record a salary advance given to an employee.',
    fields: [ref('employee_id', 'Employee', 'employee'), need(field('amount', 'Amount (₹)', 'money')), today('advance_date', 'Given on'), field('purpose', 'Purpose', 'text', { fill: false })],
    request: v => ({ method: 'POST', path: '/api/employee-advances', body: { employee_id: v.employee_id, amount: v.amount, advance_date: v.advance_date, purpose: v.purpose } }),
    summary: (v, l) => `Advance of ₹${Number(v.amount).toLocaleString('en-IN')} to ${l.employee_id}`, link: () => '/hr' },
  { key: 'record_loan', gate: may('HR', 'hr.loan.write'), risk: 'create', about: 'Record a loan given to an employee, repaid over a number of months.',
    fields: [ref('employee_id', 'Employee', 'employee'), need(field('principal_amount', 'Amount (₹)', 'money')), need(field('tenure_months', 'Months', 'number', { pick: /\b\d{1,3}(?=\s*(months?|instal))/i })),
      today('disbursed_date', 'Given on'), field('purpose', 'Purpose', 'text', { fill: false })],
    request: v => ({ method: 'POST', path: '/api/employee-loans', body: { employee_id: v.employee_id, principal_amount: v.principal_amount, tenure_months: Number(v.tenure_months), disbursed_date: v.disbursed_date, purpose: v.purpose } }),
    summary: (v, l) => `Loan of ₹${Number(v.principal_amount).toLocaleString('en-IN')} to ${l.employee_id} over ${v.tenure_months} months`, link: () => '/hr' },
  { key: 'set_applicant_status', gate: may('HR', 'hr.applicant.decide'), risk: 'change', about: 'Move a job applicant on (screening, interview, offered, hired, rejected).',
    fields: [ref('applicant_id', 'Applicant', 'applicant'), need(field('status', 'New status', 'enum', { options: [opt('screening', 'Screening', /\bscreen/i), opt('interview', 'Interview', /\binterview/i),
      opt('offered', 'Offered', /\boffer(ed)?\b/i), opt('hired', 'Hired', /\bhire[ds]?|join(ed|ing)\b/i), opt('rejected', 'Rejected', /\breject(ed)?|not selected\b/i)] }))],
    request: v => ({ method: 'PATCH', path: `/api/job-applicants/${v.applicant_id}`, body: { status: v.status } }),
    summary: (v, l) => `Set ${l.applicant_id} to ${v.status}`, link: () => '/hr' },

  // ---- Service ----
  { key: 'log_service_call', gate: may('Installation', 'installation.service_call.write'), risk: 'create', about: 'Log a service call or complaint from a customer (breakdown, leak, problem) on a project.',
    fields: [ref('project_id', 'Project', 'project'), need(field('subject', 'Problem')), need(field('priority', 'Priority', 'enum', { options: [opt('low', 'Low', /\blow\b/i),
      opt('medium', 'Medium', /\bmedium|normal\b/i), opt('high', 'High', /\bhigh|urgent|critical|asap|breakdown\b/i)], default: 'medium' }))],
    request: v => ({ method: 'POST', path: '/api/service-calls', body: { project_id: v.project_id, subject: v.subject, priority: v.priority } }),
    summary: (v, l) => `Log a service call on ${l.project_id}: ${v.subject}`, link: () => '/installation' },
  { key: 'set_service_call_status', gate: may('Installation', 'installation.service_call.write'), risk: 'change', about: 'Change the status of a service call (assigned, in progress, resolved, closed).',
    fields: [ref('service_call_id', 'Service call', 'service_call'), need(field('status', 'New status', 'enum', { options: [opt('assigned', 'Assigned', /\bassign/i),
      opt('in_progress', 'In progress', /\bin progress|working|started\b/i), opt('resolved', 'Resolved', /\bresolved|fixed|solved\b/i), opt('closed', 'Closed', /\bclose[ds]?\b/i)] }))],
    request: v => ({ method: 'PATCH', path: `/api/service-calls/${v.service_call_id}`, body: { status: v.status } }),
    summary: (v, l) => `Set ${l.service_call_id} to ${v.status.replace(/_/g, ' ')}`, link: () => '/installation' },
  { key: 'add_service_call_visit', gate: may('Installation', 'installation.service_call.write'), risk: 'create', about: 'Log a technician visit on an existing service call (a complaint already logged, call number 1001…), with what was done.',
    fields: [ref('service_call_id', 'Service call', 'service_call'), today('visit_date', 'Visited on'), field('technician', 'Technician', 'text', { fill: false }), need(field('notes', 'What was done', 'longtext'))],
    request: v => ({ method: 'POST', path: `/api/service-calls/${v.service_call_id}/visits`, body: { visit_date: v.visit_date, technician: v.technician, notes: v.notes } }),
    summary: (v, l) => `Log a visit on ${l.service_call_id}`, link: () => '/installation' },
  ...[['approve_service_expense', 'approve', 'Approve a service expense request (CR-… cash request or service travel claim) from the Service team, waiting for manager or executive approval.'],
    ['reject_service_expense', 'reject', 'Reject a service expense request (CR-… cash request or service travel claim) from the Service team, with a reason.']].map(([key, verb, about]) => ({
    // Step and approvers: server/api/service-expenses/[id] STEPS (manager, then executive; admin either). The record list keeps only the ones this person's role decides.
    key, gate: u => ['manager', 'executive', 'admin'].includes(u.role), risk: verb === 'reject' ? 'delete' : 'change', about,
    fields: [ref('expense_id', 'Expense request', 'service_expense'), reason(verb === 'reject' ? 'Why rejected' : 'Note', verb === 'reject')],
    request: async v => {
      const [r] = await queryAll('SELECT status FROM service_expense_requests WHERE id = ?', [v.expense_id]);
      if (!r) throw new Error('That request no longer exists');
      return { method: 'PATCH', path: `/api/service-expenses/${v.expense_id}`, body: { action: `${r.status === 'pending_manager' ? 'manager' : 'executive'}_${verb}`, note: v.reason || null } };
    },
    summary: (v, l) => `${verb === 'approve' ? 'Approve' : 'Reject'} ${l.expense_id}`, link: () => '/approvals' })),
  { key: 'settle_service_expense', gate: may('Accounts', 'accounts.service_expense.settle'), risk: 'change', about: 'Settle (pay out) an approved service expense request (CR-…) that is with Accounts.',
    fields: [ref('expense_id', 'Expense request', 'accounts_expense'), today('settled_on', 'Settled on')],
    request: v => ({ method: 'PATCH', path: `/api/service-expenses/${v.expense_id}`, body: { action: 'settle', settled_on: v.settled_on } }),
    summary: (v, l) => `Settle ${l.expense_id}`, link: () => '/accounts' },
  ...[['finalize_service_report', 'finalize', 'Finalize a service or commissioning report (it is complete and locked).'], ['share_service_report', 'share', 'Share a finalized service or commissioning report with the customer on their portal.']].map(([key, action, about]) => ({
    key, gate: may('Installation', 'installation.report.write'), risk: 'change', about, fields: [ref('report_id', 'Report', 'install_report')],
    request: v => ({ method: 'PATCH', path: `/api/installation-reports/${v.report_id}`, body: { action } }),
    summary: (v, l) => `${action === 'share' ? 'Share' : 'Finalize'} ${l.report_id}`, link: () => '/installation' })),

  // ---- Safe deletes ----
  { key: 'delete_enquiry', gate: headOf(...S), risk: 'delete', about: 'Delete an enquiry entered by mistake or a duplicate (Sales Head only).',
    fields: [ref('lead_id', 'Enquiry', 'enquiry')],
    request: v => ({ method: 'DELETE', path: `/api/leads/${v.lead_id}` }),
    summary: (v, l) => `Delete enquiry ${l.lead_id}`, link: () => '/sales/leads' },
];
export const ACTION_BY_KEY = Object.fromEntries(ACTIONS.map(a => [a.key, a]));

// The actions this person may do, by the same rules as the screen (each action's gate). Admin: every one.
export async function actionsFor(user) {
  if (!isInternal(user)) return [];
  const ok = await Promise.all(ACTIONS.map(a => Promise.resolve(a.gate(user)).catch(() => false)));
  return ACTIONS.filter((a, i) => ok[i]);
}
const myDepartments = user => (isPM(user) ? DEPARTMENTS : DEPARTMENTS.filter(d => canAccessDepartment(user, d)));
const optionsOf = async (f, user) => {
  const all = typeof f.options === 'function' ? await f.options() : f.options;
  return f.mine && user ? all.filter(o => myDepartments(user).includes(o.value)) : all;
};

// ---------------- filling a card ----------------
async function fillOne(f, q, day, a, user) {
  if (f.type === 'ref') {
    const c = await candidates(f.ref, q, user);
    const win = clearWinner(c);
    return win ? { value: win.id, display: win.label } : { value: null, options: c.slice(0, 3).map(x => ({ value: x.id, label: x.label })) };
  }
  if (f.type === 'date') {
    const ds = datesIn(q, day);
    if (f.range !== undefined) return { value: ds[f.range] ?? (f.range === 1 ? ds[0] : null) ?? null };
    const d = f.when === 'future' ? ds.find(x => x >= day) : ds[0];
    return { value: d || (f.default === 'today' ? day : null) };
  }
  if (f.parse) return { value: f.parse(q) ?? f.default ?? null };
  if (f.fill === false && !['enum', 'date'].includes(f.type)) return { value: f.default ?? null };
  if (f.pick && f.type === 'number') { const m = f.pick.exec(q); return { value: m ? Number(m[0]) : f.default ?? null }; }
  if (f.type === 'money') return { value: money(q) };
  if (f.type === 'number') { const m = /\b(\d+(?:\.\d+)?)\s*(?:x|×|nos|no|pcs|pieces|units|sets|kg|kgs|mtr|mtrs|m|ltr)?\b/i.exec(noCodes(stripDates(q))); return { value: m ? Number(m[1]) : null }; }
  if (f.type === 'phone') return { value: PHONE.exec(q)?.[1]?.replace(/\s+/g, '') || null };
  if (f.type === 'email') return { value: EMAIL.exec(q)?.[0] || null };
  if (f.type === 'enum') {
    const opts = await optionsOf(f, user);
    const tail = /\b(?:to|as|into)\s+(.+)$/i.exec(q)?.[1];
    // The option named first in the text wins; at the same spot the longer phrase ("hot offers" over "hot").
    const best = t => opts.map(o => ({ o, m: o.words.exec(t) })).filter(x => x.m).sort((a, b) => a.m.index - b.m.index || b.m[0].length - a.m[0].length)[0]?.o;
    const hit = f.fill === false ? null : (tail && best(tail)) || best(q);
    return { value: hit?.value || (opts.length === 1 ? opts[0].value : f.default) || null, options: opts.map(o => ({ value: o.value, label: o.label })) };
  }
  if (f.type === 'user') {
    const users = await queryAll("SELECT username, display_name, departments FROM users WHERE active = 1 AND role != 'customer'");
    const pool = users.filter(u => !f.dept || String(u.departments || '').split(',').includes(f.dept));
    const c = rank(q, pool, u => `${u.username.replace(/_/g, ' ')} ${u.display_name || ''}`);
    return { value: clearWinner(c.map(x => ({ ...x, id: x.r.username })))?.id || null, options: pool.slice(0, 30).map(u => ({ value: u.username, label: u.display_name || u.username })) };
  }
  if (f.type === 'supplier_name') { const c = await candidates('supplier', q, user); return { value: clearWinner(c)?.label || null }; }
  if (f.pick) { const m = f.pick.exec(q); return { value: m ? tidy(m[0]) : null }; }
  if (f.fill === false) return { value: f.default ?? null };
  // Free text: the message without its command words, phone, email, money and dates (edited on the card if need be).
  let t = q.replace(/^\s*(hey|please|can you|could you|kindly|ember)[\s,]*/i, '');
  if (a.strip) t = t.replace(a.strip, '');
  t = stripDates(t.replace(PHONE, ' ').replace(EMAIL, ' '));
  if (a.fields.some(x => x.type === 'money')) t = noCodes(t) === t ? t.replace(MONEY, ' ') : t.replace(MONEY, m => (/[a-z]/i.test(m) || /₹|rs/i.test(m) ? ' ' : m));
  if (f.cut) t = t.split(/,|\bwho\b|\bphone\b|\bemail\b|\bmobile\b|\bnumber\b|\bwith\b|\bworth\b|\bvalue\b/i)[0];
  return { value: tidy(t).slice(0, f.type === 'longtext' ? 1000 : 200) || null };
}

const publicField = ({ name, label, type, required, ref: r }) => ({ name, label, type: type === 'user' || type === 'supplier_name' ? 'text' : type, required, ...(r ? { ref: r } : {}) });

// Chat: the message → a card's fields.
export async function fill(key, question, user, day = todayISO()) {
  const a = ACTION_BY_KEY[key];
  const fields = [];
  for (const f of a.fields) fields.push({ ...publicField(f), ...(await fillOne(f, question, day, a, user)) });
  return card(a, fields);
}

// MCP and the card's Save: fields given directly (refs as an id or a name) → checked values, or what is missing.
export async function check(key, given = {}, user = null, day = todayISO()) {
  const a = ACTION_BY_KEY[key];
  if (!a) throw new Error(`Unknown action: ${key}`);
  const fields = [];
  for (const f of a.fields) {
    let v = given[f.name];
    if (v === '' || v === undefined) v = null;
    let out = { value: v };
    if (f.type === 'ref' && v != null) {
      if (/^\d+$/.test(String(v))) {
        const row = (await rowsOf(f.ref, user)).find(r => Number(r.id) === Number(v));
        out = row ? { value: Number(v), display: KINDS[f.ref].label(row) } : { value: null, error: `${f.label}: no matching record (or it can't be acted on now)` };
      } else out = await fillOne(f, String(v), day, a, user);
    } else if (f.type === 'enum' && v != null) {
      const opts = await optionsOf(f, user);
      const o = opts.find(x => x.value === v) || opts.find(x => x.label.toLowerCase() === String(v).toLowerCase() || x.words.test(String(v)));
      out = o ? { value: o.value } : { value: null, error: `${f.label} must be one of: ${opts.map(x => x.value).join(', ')}` };
      out.options = opts.map(x => ({ value: x.value, label: x.label }));
    } else if (v == null && f.default != null) out = { value: f.default === 'today' ? day : f.default };
    else if (f.type === 'date' && v != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) out = { value: null, error: `${f.label} must be a date (YYYY-MM-DD)` };
    else if (['money', 'number'].includes(f.type) && v != null) out = Number.isFinite(Number(v)) && Number(v) > 0 ? { value: Number(v) } : { value: null, error: `${f.label} must be a positive number` };
    else if (v != null) out = { value: String(v).slice(0, f.type === 'longtext' ? 2000 : 300) };
    fields.push({ ...publicField(f), ...out });
  }
  return card(a, fields);
}

function card(a, fields) {
  const values = Object.fromEntries(fields.map(f => [f.name, f.value]));
  const labels = Object.fromEntries(fields.map(f => [f.name, f.type === 'ref' ? f.display || '' : f.value]));
  const missing = fields.filter(f => f.required && (f.value == null || f.value === '')).map(f => f.name);
  const errors = fields.filter(f => f.error).map(f => f.error);
  let summary = a.key;
  try { summary = a.summary(values, labels); } catch { /* fields still missing */ }
  return { action: a.key, risk: a.risk, about: a.about, summary, fields, values, missing, errors, ready: !missing.length && !errors.length };
}

// For the MCP tool schema and the Cue Cards page.
export const describeActions = list => list.map(a => ({ key: a.key, about: a.about, risk: a.risk,
  fields: a.fields.map(f => ({ name: f.name, label: f.label, type: f.type === 'ref' ? `ref:${f.ref} (id or name)` : f.type, required: f.required })) }));
