// lib/assistant-actions.js — what Ember AI may DO, one entry per everyday task. Each action is a plain description of
// an existing API route: the same request the screen sends, so the route's own checks (department, Head-only action
// permissions, Sales visibility, demo rules) decide, and nothing about permissions is written twice.
// lib/assistant-act.js runs them; the chat turns a message into a card (fill), MCP passes fields in (check).
// Every write is confirmed first: a card + Save in chat, propose → confirm in MCP.
// One registry drives: Jev's choices (about), the card's fields, validation, the MCP schema and the eval.
import { queryAll } from './db';
import { isPM, canAccessDepartment } from './auth';
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
    text: r => `${r.lead_name} ${r.company_name || ''}`, label: r => r.company_name && r.company_name !== r.lead_name ? `${r.lead_name} (${r.company_name})` : r.lead_name },
  customer: { sql: 'SELECT id, name FROM customers WHERE COALESCE(active, 1) = 1', text: r => r.name, label: r => r.name },
  quotation: { sql: `SELECT q.id, q.quotation_no, q.status, q.created_by, q.lead_id, c.name AS customer FROM quotations q LEFT JOIN customers c ON c.id = q.customer_id
      WHERE q.status IN ('draft','sent','accepted','rejected')`, scope: 'quotations',
    text: r => `${r.quotation_no} ${r.customer || ''}`, label: r => `${r.quotation_no} · ${r.customer || ''} (${r.status})`, code: r => r.quotation_no },
  sale_order: { sql: `SELECT id, so_no, customer_name, created_by, lead_id, sales_person_override FROM sale_orders WHERE COALESCE(status, '') != 'cancelled'`, scope: 'saleOrders',
    text: r => `${r.so_no} ${r.customer_name || ''}`, label: r => `${r.so_no} · ${r.customer_name || ''}`, code: r => r.so_no },
  project: { sql: "SELECT id, project_no, customer_name FROM projects WHERE is_system = 0 AND status = 'active'",
    text: r => `${r.project_no} ${r.customer_name || ''}`, label: r => `${r.project_no} · ${r.customer_name || ''}`, code: r => r.project_no },
  open_milestone: { sql: `SELECT m.id, m.milestone_label, m.status, p.project_no, p.customer_name FROM milestones m JOIN projects p ON p.id = m.project_id
      WHERE p.is_system = 0 AND m.status != 'done' AND m.actual_end IS NULL`,
    text: r => `${r.milestone_label} ${r.project_no} ${r.customer_name || ''}`, proj: r => r.project_no, label: r => `${r.milestone_label} · ${r.project_no}` },
  done_milestone: { sql: `SELECT m.id, m.milestone_label, p.project_no, p.customer_name FROM milestones m JOIN projects p ON p.id = m.project_id
      WHERE p.is_system = 0 AND (m.status = 'done' OR m.actual_end IS NOT NULL)`,
    text: r => `${r.milestone_label} ${r.project_no} ${r.customer_name || ''}`, proj: r => r.project_no, label: r => `${r.milestone_label} · ${r.project_no}` },
  task: { sql: "SELECT id, title, department FROM tasks WHERE status = 'open'", text: r => r.title, label: r => `${r.title} (${r.department})` },
  supplier: { sql: 'SELECT id, name FROM suppliers WHERE COALESCE(active, 1) = 1', text: r => r.name, label: r => r.name },
  draft_po: { sql: `SELECT po.id, po.po_no, s.name AS supplier FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.status = 'draft'`,
    text: r => `${r.po_no} ${r.supplier}`, label: r => `${r.po_no} · ${r.supplier}`, code: r => r.po_no },
  live_po: { sql: `SELECT po.id, po.po_no, po.status, s.name AS supplier FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.status IN ('draft','issued')`,
    text: r => `${r.po_no} ${r.supplier}`, label: r => `${r.po_no} · ${r.supplier} (${r.status})`, code: r => r.po_no },
  bom_line: { sql: `SELECT b.id, b.material_description, b.size_spec, p.project_no FROM bom_items b JOIN projects p ON p.id = b.project_id
      WHERE COALESCE(b.purchase_status, '') NOT IN ('Cancelled')`,
    text: r => `${r.material_description} ${r.size_spec || ''} ${r.project_no}`, proj: r => r.project_no, label: r => `${r.material_description}${r.size_spec ? ` ${r.size_spec}` : ''} · ${r.project_no}` },
  employee: { sql: 'SELECT id, name, department FROM employees WHERE active = 1', text: r => r.name, label: r => `${r.name}${r.department ? ` (${r.department})` : ''}` },
  qc_record: { sql: `SELECT q.id, q.test_type, q.result, q.reference_no, p.project_no FROM qc_records q JOIN projects p ON p.id = q.project_id`,
    text: r => `${r.test_type} ${r.reference_no || ''} ${r.project_no}`, proj: r => r.project_no, label: r => `${r.test_type} · ${r.project_no} (${r.result})` },
  packing: { sql: `SELECT id, packing_no, customer_name, status FROM packing_lists WHERE status != 'dispatched'`,
    text: r => `${r.packing_no} ${r.customer_name || ''}`, label: r => `${r.packing_no} · ${r.customer_name || ''} (${r.status})`, code: r => r.packing_no },
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
};

async function rowsOf(kind, user) {
  const k = KINDS[kind];
  const rows = await queryAll(k.sql);
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
const NOTE_TYPES = [opt('call', 'Call', /\bcall(ed)?|phoned|rang|spoke\b/i), opt('meeting', 'Meeting', /\bmet|meeting|visit(ed)?\b/i),
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

const S = ['Sales', 'Marketing'];
export const ACTIONS = [
  // ---- Sales / CRM ----
  { key: 'add_enquiry', dept: S, risk: 'create', about: 'Add a new enquiry (sales lead) from a person or company, with a phone or email if given.',
    strip: /^(please )?(add|create|log|new|enter)( an?)?( new)? (enquiry|inquiry|lead)( from| for| called| named)?/i,
    fields: [need(field('lead_name', 'Name', 'text', { cut: true })), field('phone', 'Phone', 'phone'), field('email', 'Email', 'email'), field('expected_value', 'Expected value (₹)', 'money')],
    request: v => ({ method: 'POST', path: '/api/leads', body: { lead_name: v.lead_name, phone: v.phone, email: v.email, expected_value: v.expected_value, source: 'Ember AI' } }),
    summary: v => `Add enquiry ${v.lead_name}`, link: r => `/sales/leads?highlight=LD-${r.id}` },
  { key: 'log_followup', dept: S, risk: 'create', about: "Log a call, meeting, visit or email with a customer or enquiry, and what they said, in the enquiry's Diary (for example 'met Kaveri Pharma today, they want…', 'spoke to Metro Hospital…').",
    strip: /^(please )?(log|note|record|add)( a)? (call|follow[- ]?up|meeting|note|diary entry)( with| on| for)?/i,
    fields: [ref('lead_id', 'Enquiry', 'enquiry'), need(field('note_type', 'Type', 'enum', { options: NOTE_TYPES, default: 'call' })), need(field('content', 'What was said', 'longtext')), today('visit_date', 'Date')],
    request: v => ({ method: 'POST', path: '/api/crm-notes', body: { lead_id: v.lead_id, note_type: v.note_type, content: v.content, visit_date: v.visit_date } }),
    summary: (v, l) => `Log a ${v.note_type} with ${l.lead_id}`, link: (r, v) => `/sales/leads?highlight=LD-${v.lead_id}` },
  { key: 'set_enquiry_stage', dept: S, risk: 'change', about: 'Move an enquiry to another funnel stage (cold, hot, proposal, hot offer, dropped, follow up…).',
    fields: [ref('lead_id', 'Enquiry', 'enquiry'), need(field('sales_call_status', 'New stage', 'enum', { options: stageOptions }))],
    request: v => ({ method: 'PATCH', path: `/api/leads/${v.lead_id}`, body: { sales_call_status: v.sales_call_status } }),
    summary: (v, l) => `Move ${l.lead_id} to ${v.sales_call_status}`, link: (r, v) => `/sales/leads?highlight=LD-${v.lead_id}` },
  { key: 'assign_enquiry', dept: S, risk: 'change', about: 'Assign or give an enquiry (lead) to a salesperson, who will follow it up.',
    fields: [ref('lead_id', 'Enquiry', 'enquiry'), need(field('assigned_to', 'Assign to (username)', 'user', { dept: 'Sales' }))],
    request: v => ({ method: 'PATCH', path: `/api/leads/${v.lead_id}`, body: { assigned_to: v.assigned_to } }),
    summary: (v, l) => `Assign ${l.lead_id} to ${v.assigned_to}`, link: (r, v) => `/sales/leads?highlight=LD-${v.lead_id}` },
  { key: 'set_enquiry_value', dept: S, risk: 'change', about: 'Set or change the expected order value of an enquiry.',
    fields: [ref('lead_id', 'Enquiry', 'enquiry'), need(field('expected_value', 'Expected value (₹)', 'money'))],
    request: v => ({ method: 'PATCH', path: `/api/leads/${v.lead_id}`, body: { expected_value: v.expected_value } }),
    summary: (v, l) => `Set ${l.lead_id}'s expected value to ₹${Number(v.expected_value).toLocaleString('en-IN')}`, link: (r, v) => `/sales/leads?highlight=LD-${v.lead_id}` },
  { key: 'add_customer', dept: S, risk: 'create', about: 'Add a new customer (company) to the customer master, with phone, email or GST number if given.',
    strip: /^(please )?(add|create|new)( an?)?( new)? (customer|client)( called| named)?/i,
    fields: [need(field('name', 'Name', 'text', { cut: true })), field('phone', 'Phone', 'phone'), field('email', 'Email', 'email'), field('gst_no', 'GST number', 'text', { pick: /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/i })],
    request: v => ({ method: 'POST', path: '/api/customers', body: { name: v.name, phone: v.phone, email: v.email, gst_no: v.gst_no } }),
    summary: v => `Add customer ${v.name}`, link: () => '/sales/customers' },
  ...[['quotation_sent', 'sent', 'Mark a quotation (commercial offer) as sent to the customer.', 'Mark sent'],
    ['quotation_accepted', 'accepted', 'Mark a quotation (commercial offer) accepted: the customer agreed, the deal is won.', 'Accept'],
    ['quotation_rejected', 'rejected', 'Mark a quotation (commercial offer) rejected: the customer said no or the order was lost.', 'Reject']].map(([key, status, about, verb]) => ({
    key, dept: S, risk: 'change', about, fields: [ref('quotation_id', 'Quotation', 'quotation')],
    request: v => ({ method: 'PATCH', path: `/api/quotations/${v.quotation_id}`, body: { status } }),
    summary: (v, l) => `${verb} quotation ${l.quotation_id}`, link: () => '/sales/quotations' })),
  { key: 'record_order_payment', dept: ['Sales', 'Accounts'], risk: 'create', about: 'Record a payment received from a customer against a sale order (advance or balance).',
    fields: [ref('sale_order_id', 'Sale order', 'sale_order'), need(field('amount', 'Amount (₹)', 'money')), today('received_on', 'Received on'), field('mode', 'Mode', 'enum', { options: PAY_MODES })],
    request: v => ({ method: 'POST', path: '/api/sale-order-payments', body: { sale_order_id: v.sale_order_id, amount: v.amount, received_on: v.received_on, mode: v.mode } }),
    summary: (v, l) => `Record ₹${Number(v.amount).toLocaleString('en-IN')} received on ${l.sale_order_id}`, link: () => '/sales/payment-orders' },

  // ---- Projects and milestones ----
  { key: 'start_milestone', dept: null, risk: 'change', about: 'Start a milestone on a project (AB-…) milestone tracker: that stage of the project (design, cutting, welding, box up, hydro test, packing…) has begun.',
    fields: [ref('milestone_id', 'Milestone', 'open_milestone'), today('actual_start', 'Started on')],
    request: v => ({ method: 'PATCH', path: `/api/milestones/${v.milestone_id}`, body: { status: 'in_progress', actual_start: v.actual_start } }),
    summary: (v, l) => `Start ${l.milestone_id}`, link: () => '/projects' },
  { key: 'close_milestone', dept: null, risk: 'change', about: "Close a milestone on a project (AB-…) milestone tracker: that stage of the project (shell welding, box up, design…) is done or finished.",
    fields: [ref('milestone_id', 'Milestone', 'open_milestone'), today('actual_end', 'Finished on'), field('delay_reason', 'Delay reason (if late)', 'longtext', { fill: false })],
    request: v => ({ method: 'PATCH', path: `/api/milestones/${v.milestone_id}`, body: { status: 'done', actual_end: v.actual_end, ...(v.delay_reason ? { delay_reason: v.delay_reason } : null) } }),
    summary: (v, l) => `Close ${l.milestone_id}`, link: () => '/projects' },
  { key: 'send_back_milestone', dept: null, risk: 'change', about: 'Send a closed milestone back to its department for rework (reopen it), with a reason.',
    fields: [ref('milestone_id', 'Milestone', 'done_milestone'), need(reason('Reason'))],
    request: v => ({ method: 'POST', path: `/api/milestones/${v.milestone_id}/reopen`, body: { reason: v.reason } }),
    summary: (v, l) => `Send ${l.milestone_id} back for rework`, link: () => '/projects' },

  // ---- Tasks ----
  { key: 'add_task', dept: null, risk: 'create', about: "Add a to-do on my own department's task board, with a due date.",
    strip: /^(please )?(add|create)( a)?( new)? (task|to-?do)( to| for)?/i,
    fields: [need(field('title', 'Task')), field('due_date', 'Due', 'date', { when: 'future', default: 'today', required: true }), need(field('department', 'Department', 'enum', { options: DEPT_OPTIONS, mine: true }))],
    // A manager holds no department, so the route takes their task as a raise "from" that department.
    request: (v, user) => ({ method: 'POST', path: '/api/production/tasks', body: { title: v.title, due_date: v.due_date, department: v.department, ...(isPM(user) ? { from_department: v.department } : null) } }),
    summary: v => `Add task “${v.title}” for ${v.department}`, link: () => '/' },
  { key: 'raise_request', dept: null, risk: 'create', about: 'Ask another department to do something (raise a request or incident for them), optionally about a project.',
    strip: /^(please )?(ask|tell|request|raise( a)?( request)?( for| to)?)\s+(the\s+)?(\w+)(\s+(team|department|dept))?\s+(to\s+)?/i,
    fields: [need(field('department', 'To department', 'enum', { options: DEPT_OPTIONS })), need(field('title', 'What is needed')), field('due_date', 'Due', 'date', { when: 'future', default: 'today', required: true }),
      need(field('from_department', 'From (my department)', 'enum', { options: DEPT_OPTIONS, mine: true, fill: false })), ref('project_id', 'Project', 'project', false)],
    request: v => ({ method: 'POST', path: '/api/production/tasks', body: { department: v.department, from_department: v.from_department, title: v.title, due_date: v.due_date, project_id: v.project_id || null } }),
    summary: v => `Ask ${v.department}: “${v.title}”`, link: () => '/ops' },
  { key: 'complete_task', dept: null, risk: 'change', about: 'Mark an open task (a to-do or a request from another department) as done.',
    fields: [ref('task_id', 'Task', 'task')],
    request: v => ({ method: 'PATCH', path: `/api/production/tasks/${v.task_id}`, body: { status: 'done' } }),
    summary: (v, l) => `Mark “${l.task_id}” done`, link: () => '/' },

  // ---- Procurement ----
  { key: 'add_supplier', dept: ['Procurement'], risk: 'create', about: 'Add a new supplier (vendor) to the supplier roster, with phone, email or GST if given.',
    strip: /^(please )?(add|create|new)( a)?( new)? (supplier|vendor)( called| named)?/i,
    fields: [need(field('name', 'Name', 'text', { cut: true })), field('phone', 'Phone', 'phone'), field('email', 'Email', 'email'), field('contact_person', 'Contact person', 'text', { fill: false })],
    request: v => ({ method: 'POST', path: '/api/suppliers', body: { name: v.name, phone: v.phone, email: v.email, contact_person: v.contact_person } }),
    summary: v => `Add supplier ${v.name}`, link: () => '/procurement/suppliers-roster' },
  { key: 'record_supplier_quote', dept: ['Procurement'], risk: 'create', about: "Record a supplier's quoted price for a BOM material line (a quote received by phone, email or visit).",
    fields: [ref('supplier_id', 'Supplier', 'supplier'), ref('bom_item_id', 'Material line', 'bom_line'), need(field('unit_price', 'Unit price (₹)', 'money')), field('uom', 'Per (unit)', 'text', { pick: /\b(kg|kgs|nos|no|mtr|mtrs|meter|set|ltr|pair)\b/i }), field('expected_delivery_date', 'Delivery by', 'date', { when: 'future' })],
    request: v => ({ method: 'POST', path: '/api/supplier-quotes', body: { supplier_id: v.supplier_id, items: [{ bom_item_id: v.bom_item_id, unit_price: v.unit_price, uom: v.uom || null }], expected_delivery_date: v.expected_delivery_date || null, quote_source: 'phone' } }),
    summary: (v, l) => `Record ${l.supplier_id}'s quote of ₹${v.unit_price} for ${l.bom_item_id}`, link: () => '/procurement/selection' },
  { key: 'issue_po', dept: ['Procurement'], risk: 'change', about: 'Issue a draft purchase order to its supplier (the PO is final and sent).',
    fields: [ref('po_id', 'Purchase order', 'draft_po')],
    request: v => ({ method: 'PATCH', path: `/api/purchase-orders/${v.po_id}`, body: { action: 'issue' } }),
    summary: (v, l) => `Issue purchase order ${l.po_id}`, link: () => '/procurement/orders' },
  { key: 'cancel_po', dept: ['Procurement'], risk: 'delete', about: 'Cancel a purchase order (draft or issued) that is no longer needed, with a reason.',
    fields: [ref('po_id', 'Purchase order', 'live_po'), reason('Reason')],
    request: v => ({ method: 'PATCH', path: `/api/purchase-orders/${v.po_id}`, body: { action: 'cancel', reason: v.reason || null } }),
    summary: (v, l) => `Cancel purchase order ${l.po_id}`, link: () => '/procurement/orders' },

  // ---- Stores ----
  { key: 'log_gate_entry', dept: ['Stores'], risk: 'create', about: 'Log a vehicle arriving at the gate with material (a gate inward receipt, GIR): vehicle number, supplier, driver.',
    fields: [field('vehicle_no', 'Vehicle no.', 'text', { pick: /\b[A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{0,3}[\s-]?\d{3,4}\b/i }), field('supplier_name', 'Supplier', 'supplier_name'), field('driver_name', 'Driver', 'text', { fill: false }), field('material_ref', 'Material / DC ref', 'text', { fill: false })],
    request: v => ({ method: 'POST', path: '/api/gate-inward-receipts', body: { vehicle_no: v.vehicle_no, supplier_name: v.supplier_name, driver_name: v.driver_name, material_ref: v.material_ref } }),
    summary: v => `Log gate entry${v.vehicle_no ? ` ${v.vehicle_no}` : ''}${v.supplier_name ? ` from ${v.supplier_name}` : ''}`, link: () => '/stores/gir' },
  { key: 'issue_material', dept: ['Stores'], risk: 'create', about: 'Issue material from Stores to production (work in progress) against a BOM line, with a quantity.',
    fields: [ref('bom_item_id', 'Material line', 'bom_line'), need(field('qty', 'Quantity', 'number')), field('notes', 'Note', 'text', { fill: false })],
    request: v => ({ method: 'POST', path: '/api/material-issues', body: { bom_item_id: v.bom_item_id, qty: v.qty, notes: v.notes } }),
    summary: (v, l) => `Issue ${v.qty} of ${l.bom_item_id} to production`, link: () => '/stores/issued' },

  // ---- QC ----
  ...[['approve_inward', 'approved', 'Approve material just received from a supplier that is waiting for QC inward review, so it becomes usable stock.'],
    ['reject_inward', 'rejected', 'Reject material just received from a supplier that is waiting for QC inward review (it is damaged, bent, wrong or failed).']].map(([key, decision, about]) => ({
    key, dept: ['QC'], risk: decision === 'rejected' ? 'delete' : 'change', about,
    fields: [ref('approval_id', 'Material awaiting review', 'inward'), reason(decision === 'rejected' ? 'Why rejected' : 'Note')],
    request: v => ({ method: 'POST', path: `/api/inward-approvals/${v.approval_id}/decide`, body: { decision, reason: v.reason || null } }),
    summary: (v, l) => `${decision === 'approved' ? 'Approve' : 'Reject'} ${l.approval_id} on inward review`, link: () => '/qc/approvals-inward' })),
  { key: 'add_qc_record', dept: ['QC', 'Production'], risk: 'create', about: 'Record a QC test or inspection on a project (hydro test, radiography/NDE, dimensional, material test) with its result.',
    fields: [ref('project_id', 'Project', 'project'), need(field('test_type', 'Test', 'text', { pick: /\b(hydro(static)?( test)?|radiograph(y|ic)( test)?|nde|ndt|dye penetrant|dp test|ultrasonic( test)?|ut|dimensional( inspection)?|visual( inspection)?|material test|mtc)\b/i })),
      need(field('result', 'Result', 'enum', { options: QC_RESULT, default: 'pending' })), field('inspector', 'Inspector', 'text', { fill: false }), today('tested_on', 'Tested on'), field('notes', 'Notes', 'longtext', { fill: false })],
    request: v => ({ method: 'POST', path: '/api/qc-records', body: { project_id: v.project_id, test_type: v.test_type, result: v.result, inspector: v.inspector, tested_on: v.tested_on, notes: v.notes } }),
    summary: (v, l) => `Record ${v.test_type} on ${l.project_id}: ${v.result}`, link: () => '/qc' },
  { key: 'set_qc_result', dept: ['QC', 'Production'], risk: 'change', about: 'Change the result of a QC test or inspection already recorded on a project (an incoming inspection, hydro test, radiography record) to pass, fail or pending.',
    fields: [ref('record_id', 'QC record', 'qc_record'), need(field('result', 'Result', 'enum', { options: QC_RESULT }))],
    request: v => ({ method: 'PATCH', path: `/api/qc-records/${v.record_id}`, body: { result: v.result } }),
    summary: (v, l) => `Set ${l.record_id} to ${v.result}`, link: () => '/qc' },
  { key: 'raise_ncr', dept: ['QC', 'Production'], risk: 'create', about: 'Raise a non-conformance report (NCR) on a project: a defect or deviation found.',
    fields: [ref('project_id', 'Project', 'project'), need(field('description', 'What is wrong', 'longtext')), need(field('severity', 'Severity', 'enum', { options: SEVERITY, default: 'minor' }))],
    request: v => ({ method: 'POST', path: '/api/ncrs', body: { project_id: v.project_id, description: v.description, severity: v.severity } }),
    summary: (v, l) => `Raise a ${v.severity} NCR on ${l.project_id}`, link: () => '/qc/ncr' },
  { key: 'decide_predispatch', dept: ['QC', 'Production'], risk: 'change', about: "Approve or reject a packing list in pre-dispatch review (QC's or Production's sign-off before it ships).",
    fields: [ref('approval_id', 'Packing list in review', 'predispatch'), need(field('decision', 'Decision', 'enum', { options: DECISION })), reason('Note')],
    request: v => ({ method: 'POST', path: `/api/pre-dispatch-approvals/${v.approval_id}/decide`, body: { decision: v.decision, reason: v.reason || null } }),
    summary: (v, l) => `${v.decision === 'rejected' ? 'Reject' : 'Approve'} ${l.approval_id} for dispatch`, link: () => '/qc/approvals-predispatch' },
  { key: 'delete_qc_record', dept: ['QC', 'Production'], risk: 'delete', about: 'Delete a QC test record entered by mistake.',
    fields: [ref('record_id', 'QC record', 'qc_record')],
    request: v => ({ method: 'DELETE', path: `/api/qc-records/${v.record_id}` }),
    summary: (v, l) => `Delete QC record ${l.record_id}`, link: () => '/qc' },

  // ---- Production ----
  ...[['start_jobcard_stage', 'start', 'Start a stage on a shop-floor job card (JC-…), usually naming the fitter or welder doing it.'],
    ['finish_jobcard_stage', 'finish', 'Finish a stage on a shop-floor job card (JC-…): that step on the job card is complete.']].map(([key, action, about]) => ({
    key, dept: ['Production'], risk: 'change', about,
    fields: [ref('stage_id', 'Job card stage', 'stage'), ref('fitter_employee_id', 'Fitter / welder', 'employee', false), today('date', 'Date')],
    request: async v => {
      const [st] = await queryAll('SELECT sheet_id FROM job_sheet_stages WHERE id = ?', [v.stage_id]);
      if (!st) throw new Error('That job card stage no longer exists');
      return { method: 'PATCH', path: `/api/job-sheets/${st.sheet_id}/stages/${v.stage_id}`, body: { action, date: v.date, ...(v.fitter_employee_id ? { fitter_employee_id: v.fitter_employee_id } : null) } };
    },
    summary: (v, l) => `${action === 'start' ? 'Start' : 'Finish'} ${l.stage_id}`, link: () => '/production/shop/jobcards' })),

  // ---- Dispatch ----
  { key: 'set_packing_status', dept: ['Dispatch'], risk: 'change', about: 'Change a packing list status: packed (ready), dispatched (shipped), or back to draft.',
    fields: [ref('packing_id', 'Packing list', 'packing'), need(field('status', 'New status', 'enum', { options: PACKING_STATUS }))],
    request: v => ({ method: 'PATCH', path: `/api/packing/${v.packing_id}`, body: { status: v.status } }),
    summary: (v, l) => `Set ${l.packing_id} to ${v.status}`, link: r => '/dispatch' },
  { key: 'submit_packing_approval', dept: ['Dispatch'], risk: 'change', about: 'Submit a packed packing list for pre-dispatch approval by QC and Production.',
    fields: [ref('packing_id', 'Packing list', 'packing')],
    request: v => ({ method: 'POST', path: `/api/packing/${v.packing_id}/submit-for-approval`, body: {} }),
    summary: (v, l) => `Submit ${l.packing_id} for dispatch approval`, link: () => '/dispatch/approvals' },
  { key: 'delete_packing_list', dept: ['Dispatch'], risk: 'delete', about: 'Delete a draft packing list made by mistake.',
    fields: [ref('packing_id', 'Draft packing list', 'draft_packing')],
    request: v => ({ method: 'DELETE', path: `/api/packing/${v.packing_id}` }),
    summary: (v, l) => `Delete packing list ${l.packing_id}`, link: () => '/dispatch' },

  // ---- HR ----
  { key: 'mark_attendance', dept: ['HR'], risk: 'change', about: 'Mark an employee present, absent, half day or on leave for a day.',
    fields: [ref('employee_id', 'Employee', 'employee'), need(field('status', 'Attendance', 'enum', { options: ATTENDANCE })), today()],
    request: v => ({ method: 'POST', path: '/api/attendance', body: { employee_id: v.employee_id, date: v.date, status: v.status } }),
    summary: (v, l) => `Mark ${l.employee_id} ${ATTENDANCE.find(o => o.value === v.status)?.label.toLowerCase() || v.status} on ${v.date}`, link: () => '/hr' },
  { key: 'apply_leave', dept: ['HR'], risk: 'create', about: 'Apply for leave for an employee: the type of leave and from which date to which date.',
    fields: [ref('employee_id', 'Employee', 'employee'), ref('leave_type_id', 'Leave type', 'leave_type'), field('from_date', 'From', 'date', { range: 0, required: true }), field('to_date', 'To', 'date', { range: 1, required: true }), reason('Reason')],
    request: v => ({ method: 'POST', path: '/api/leave-requests', body: { employee_id: v.employee_id, leave_type_id: v.leave_type_id, from_date: v.from_date, to_date: v.to_date, reason: v.reason || null } }),
    summary: (v, l) => `${l.leave_type_id} for ${l.employee_id}, ${v.from_date} to ${v.to_date}`, link: () => '/hr' },

  // ---- Service ----
  { key: 'log_service_visit', dept: ['Installation'], risk: 'create', about: "Plan or log a service visit to a customer's site for a project (installation, commissioning, breakdown).",
    fields: [ref('project_id', 'Project', 'project'), need(field('description', 'Purpose of visit', 'text')), field('visit_date', 'Visit date', 'date', { default: 'today', required: true }),
      need(field('status', 'Status', 'enum', { options: [opt('planned', 'Planned', /\bplan(ned)?|schedule[d]?|will|going|next\b/i), opt('done', 'Done', /\bdone|visited|completed|went|finished\b/i)], default: 'planned' }))],
    request: v => ({ method: 'POST', path: '/api/installation-visits', body: { project_id: v.project_id, description: v.description, visit_date: v.visit_date, status: v.status } }),
    summary: (v, l) => `${v.status === 'done' ? 'Log' : 'Plan'} a service visit to ${l.project_id} on ${v.visit_date}`, link: () => '/installation' },

  // ---- Safe deletes ----
  { key: 'delete_enquiry', dept: S, risk: 'delete', about: 'Delete an enquiry entered by mistake or a duplicate (Sales Head only).',
    fields: [ref('lead_id', 'Enquiry', 'enquiry')],
    request: v => ({ method: 'DELETE', path: `/api/leads/${v.lead_id}` }),
    summary: (v, l) => `Delete enquiry ${l.lead_id}`, link: () => '/sales/leads' },
];
export const ACTION_BY_KEY = Object.fromEntries(ACTIONS.map(a => [a.key, a]));

// The actions a person's departments could ever do (the route still decides on Save). Admin/managers: all.
export const actionsFor = user => ACTIONS.filter(a => !a.dept || isPM(user) || a.dept.some(d => canAccessDepartment(user, d)));
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
  if (f.type === 'money') return { value: money(q) };
  if (f.type === 'number') { const m = /\b(\d+(?:\.\d+)?)\s*(?:x|×|nos|no|pcs|pieces|units|sets|kg|kgs|mtr|mtrs|m|ltr)?\b/i.exec(noCodes(stripDates(q))); return { value: m ? Number(m[1]) : null }; }
  if (f.type === 'phone') return { value: PHONE.exec(q)?.[1]?.replace(/\s+/g, '') || null };
  if (f.type === 'email') return { value: EMAIL.exec(q)?.[0] || null };
  if (f.type === 'enum') {
    const opts = await optionsOf(f, user);
    const tail = /\b(?:to|as|into)\s+(.+)$/i.exec(q)?.[1];
    const hit = f.fill === false ? null : (tail && opts.find(o => o.words.test(tail))) || opts.find(o => o.words.test(q));
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
