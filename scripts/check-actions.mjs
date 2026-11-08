// Ember AI actions end to end: for every action, a sentence → the card it fills (no model) → Save through
// /api/assistant/act → the app's own route. Plus refusals (a department that may not, a missing field, a bad record).
// Run against a SCRATCH copy of the demo DB only — it writes. Usage:
//   BASE=http://localhost:3080 PASS=<scratch password> node scripts/check-actions.mjs [only_action_key ...]
const BASE = process.env.BASE || 'http://localhost:3080', PASS = process.env.PASS;
if (!PASS) { console.error('PASS (the scratch copy password) is required'); process.exit(1); }
const only = process.argv.slice(2);
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
  for (const [k, v] of Object.entries(c.fix || {})) fields[k] = v === 'pick' ? (byName[k]?.options?.[0]?.value ?? fields[k]) : v;
  const out = await post(c.as || 'admin', { action: c.action, fields });
  if (c.refuse) { if (out.ok || !c.refuse.test(out.error || '')) problems.push(`should be refused (${c.refuse}), got ${out.ok ? 'ok' : out.error}`); }
  else if (!out.ok) problems.push(`save: ${out.error}`);
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${c.action}${c.as ? ` (${c.as})` : ''}: ${out.summary || card.summary || ''}${problems.length ? `\n      ${problems.join('\n      ')}` : ''}`);
  if (problems.length) fails++;
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
