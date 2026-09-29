// scripts/enrich-sales-links.mjs — fills the gaps left after the enquiry import and links records together.
//   node --env-file=.env.local scripts/enrich-sales-links.mjs                 # dry run: plan JSON + docs/sales-links-review.csv
//   node --env-file=.env.local scripts/enrich-sales-links.mjs --apply [--limit N]   # applies exactly that plan
//   node --env-file=.env.local scripts/enrich-sales-links.mjs --rollback
// Everything is fill-blank (COALESCE(NULLIF(col,''),?) or "WHERE col IS NULL") — a value a person typed is
// never overwritten. Before-values go in a manifest so --rollback restores them. Links are made only when
// exactly one record fits; anything unsure goes to the review CSV.
import fs from 'fs';
import path from 'path';
import { createClient } from '@libsql/client';
import { customerMatcher, compactName } from '../lib/enquiry-import.mjs';
import { parseSalesCallDetails } from '../lib/sales-call-details-import.mjs';
import { parseAddress, contactIndex, uniqueEnquiry } from '../lib/sales-links.mjs';
import { classifyActionType } from '../lib/action-types.mjs';

const TAG = 'import:sales-links-2026-09-30', NOTE_TAG = 'import:sales-call-details-2026-09-30';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply'), ROLLBACK = args.includes('--rollback');
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const DATA = path.resolve('scripts/data');
const PLAN = `${DATA}/sales-links-plan.json`, MANIFEST = `${DATA}/sales-links-manifest.json`;
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql, a = []) => (await db.execute({ sql, args: a })).rows.map(r => ({ ...r }));
const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
async function retry(fn) { for (let i = 1; ; i++) { try { return await fn(); } catch (e) { if (i >= 4) throw e; console.log(`  retry ${i}: ${e.message}`); await new Promise(r => setTimeout(r, 2000 * i)); } } }
const batch = s => retry(() => db.batch(s, 'write'));
const blank = v => v == null || v === '';
const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
const setSql = (table, sets) => `UPDATE ${table} SET ${Object.keys(sets).map(k => `${k} = COALESCE(NULLIF(${k}, ''), ?)`).join(', ')} WHERE id = ?`;
const undoSql = (table, changes) => Object.entries(changes).map(([k, [before, after]]) => ({ table, k, before, after }));

// ------------------------------------------------------------------ rollback
if (ROLLBACK) {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const st = [{ sql: 'DELETE FROM contacts WHERE import_tag = ?', args: [TAG] }];
  for (const [table, list] of Object.entries({ leads: m.leadFills, customers: m.custFills, sale_orders: m.orderFills }))
    for (const e of list) for (const [k, [before, after]] of Object.entries(e.changes)) st.push({ sql: `UPDATE ${table} SET ${k} = ? WHERE id = ? AND ${k} IS ?`, args: [before, e.id, after] });
  for (const l of m.leadLinks) st.push({ sql: 'UPDATE leads SET converted_customer_id = NULL WHERE id = ? AND converted_customer_id = ?', args: [l.id, l.customerId] });
  for (const l of m.quotationLinks) st.push({ sql: 'UPDATE quotations SET lead_id = NULL WHERE id = ? AND lead_id = ?', args: [l.id, l.leadId] });
  for (const n of m.noteTypes) st.push({ sql: 'UPDATE crm_notes SET note_type = ?, plan_note_type = ? WHERE id = ?', args: [n.before_type, n.before_plan, n.id] });
  for (const r of m.dupNotes) { const ks = Object.keys(r); st.push({ sql: `INSERT OR IGNORE INTO crm_notes (${ks.join(',')}) VALUES (${ks.map(() => '?').join(',')})`, args: ks.map(k => r[k]) }); }
  for (const part of chunks(st, 150)) await batch(part);
  console.log(`rolled back: ${m.leadFills.length} lead / ${m.custFills.length} customer / ${m.orderFills.length} order fills, ${m.leadLinks.length + m.quotationLinks.length} links, ${m.noteTypes.length} note types, ${m.dupNotes.length} notes restored; contacts by tag deleted.`);
  process.exit(0);
}

// ------------------------------------------------------------------ apply
if (APPLY) {
  if (!fs.existsSync(PLAN)) { console.error('No plan file — run the dry run first.'); process.exit(1); }
  if (fs.existsSync(MANIFEST)) { console.error('A manifest exists (already applied?). Run --rollback first.'); process.exit(1); }
  const p = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
  const cut = a => a.slice(0, LIMIT);
  const m = { tag: TAG, at: new Date().toISOString(), leadFills: cut(p.leadFills), custFills: cut(p.custFills), orderFills: cut(p.orderFills), leadLinks: cut(p.leadLinks),
    quotationLinks: cut(p.quotationLinks), noteTypes: cut(p.noteTypes), dupNotes: cut(p.dupNotes), contacts: cut(p.contacts) };
  fs.writeFileSync(MANIFEST, JSON.stringify(m));
  const st = [];
  for (const e of m.leadLinks) st.push({ sql: 'UPDATE leads SET converted_customer_id = ? WHERE id = ? AND converted_customer_id IS NULL', args: [e.customerId, e.id] });
  for (const e of m.leadFills) st.push({ sql: setSql('leads', e.sets), args: [...Object.values(e.sets), e.id] });
  for (const e of m.custFills) st.push({ sql: setSql('customers', e.sets), args: [...Object.values(e.sets), e.id] });
  for (const e of m.orderFills) st.push({ sql: setSql('sale_orders', e.sets), args: [...Object.values(e.sets), e.id] });
  for (const e of m.quotationLinks) st.push({ sql: 'UPDATE quotations SET lead_id = ? WHERE id = ? AND lead_id IS NULL', args: [e.leadId, e.id] });
  for (const n of m.noteTypes) st.push({ sql: 'UPDATE crm_notes SET note_type = ?, plan_note_type = ? WHERE id = ?', args: [n.note_type, n.plan_note_type, n.id] });
  for (const r of m.dupNotes) st.push({ sql: 'DELETE FROM crm_notes WHERE id = ? AND lead_id IS NULL', args: [r.id] });
  for (const c of m.contacts) st.push({ sql: `INSERT INTO contacts (customer_id, name, phone, email, notes, import_tag)
    SELECT ?, ?, ?, ?, 'From historical call records.', ? WHERE NOT EXISTS (SELECT 1 FROM contacts WHERE customer_id = ? AND LOWER(name) = LOWER(?))`,
    args: [c.customerId, c.name, c.phone, c.email, TAG, c.customerId, c.name] });
  let done = 0;
  for (const part of chunks(st, 150)) { await batch(part); done += part.length; console.log(`  ${done}/${st.length} statements`); }
  await db.execute({ sql: 'INSERT INTO usb_audit (actor, action, detail) VALUES (?, ?, ?)', args: [`script:${TAG}`, 'sales_links_enrich', JSON.stringify(Object.fromEntries(Object.entries(m).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])))] });
  console.log('applied. Manifest:', MANIFEST);
  process.exit(0);
}

// ------------------------------------------------------------------ dry run: build the plan
const leads = await q(`SELECT id, lead_name, address, email, phone, pin_code, district, territory, product_type, converted_customer_id, enquiry_date, owner_dept, sales_call_status FROM leads`);
const customers = await q('SELECT id, name, email, phone, city, state, pin_code FROM customers');
const custById = new Map(customers.map(c => [c.id, c]));
const review = [];
const rv = (kind, ref, why) => review.push({ kind, ref, why });

// 1. link unlinked enquiries to a customer by a unique email / phone
const find = contactIndex(customers);
const leadLinks = [];
for (const l of leads) {
  if (l.converted_customer_id || l.owner_dept !== 'Sales') continue;
  const f = find(l.email, l.phone);
  if (f.id) { leadLinks.push({ id: l.id, customerId: f.id, how: f.how }); l.converted_customer_id = f.id; }
  else if (f.why !== 'no match') rv('enquiry-customer', `LD-${l.id} ${l.lead_name}`, f.why);
}

// 2. CSV: product type + contact people, matched to enquiries by name + date (unique only)
const files = [1, 2, 3].map(i => fs.readFileSync(`${process.env.HOME}/Downloads/sales_call_details${i}.csv`, 'utf8'));
const csv = parseSalesCallDetails(files).rows;
const byKey = new Map();
for (const l of leads) { const k = `${compactName(l.lead_name)}|${l.enquiry_date}`; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(l); }
const csvLead = new Map(); // lead id -> csv row
for (const r of csv) { const b = byKey.get(`${compactName(r.name)}|${r.enquiryDate}`) || []; if (b.length === 1 && !csvLead.has(b[0].id)) csvLead.set(b[0].id, r); }

// 3. enquiry fills: address parts, product type, email/phone from the linked customer
const leadFills = [];
for (const l of leads) {
  const a = parseAddress(l.address), c = l.converted_customer_id ? custById.get(l.converted_customer_id) : null, r = csvLead.get(l.id);
  const want = { pin_code: a.pin, territory: a.state, district: a.city, product_type: r?.productType, email: c?.email, phone: c?.phone };
  const sets = {}, changes = {};
  for (const [k, v] of Object.entries(want)) if (!blank(v) && blank(l[k])) { sets[k] = v; changes[k] = [l[k] ?? null, v]; }
  if (Object.keys(sets).length) leadFills.push({ id: l.id, sets, changes });
}

// 4. customer fills from their enquiries (first enquiry that has the value)
const custFills = [];
{
  const by = new Map();
  for (const l of leads) if (l.converted_customer_id) { if (!by.has(l.converted_customer_id)) by.set(l.converted_customer_id, []); by.get(l.converted_customer_id).push(l); }
  for (const [cid, ls] of by) {
    const c = custById.get(cid); if (!c) continue;
    const parsed = ls.map(l => ({ l, a: parseAddress(l.address) }));
    const pick = f => { for (const x of parsed) { const v = f(x); if (!blank(v)) return v; } return null; };
    const want = { pin_code: pick(x => x.a.pin), state: pick(x => x.a.state), city: pick(x => x.a.city), email: pick(x => x.l.email), phone: pick(x => x.l.phone) };
    const sets = {}, changes = {};
    for (const [k, v] of Object.entries(want)) if (v && blank(c[k])) { sets[k] = v; changes[k] = [c[k] ?? null, v]; }
    if (Object.keys(sets).length) custFills.push({ id: cid, sets, changes });
  }
}

// 5. quotations -> enquiry (unique candidate only)
const salesLeadsBy = new Map();
for (const l of leads) if (l.owner_dept === 'Sales' && l.converted_customer_id) { if (!salesLeadsBy.has(l.converted_customer_id)) salesLeadsBy.set(l.converted_customer_id, []); salesLeadsBy.get(l.converted_customer_id).push(l); }
const quotations = await q('SELECT id, quotation_no, customer_id, quotation_date FROM quotations WHERE lead_id IS NULL');
const quotationLinks = [];
for (const qt of quotations) {
  const cands = salesLeadsBy.get(qt.customer_id) || [];
  if (!cands.length || !qt.quotation_date) continue;
  const u = uniqueEnquiry(cands, qt.quotation_date);
  if (u.lead) quotationLinks.push({ id: qt.id, leadId: u.lead.id }); else if (u.why !== 'no enquiry within the window') rv('quotation-enquiry', qt.quotation_no, u.why);
}

// 6. orders: customer by exact name, then enquiry (only Order Received enquiries with no order yet, unique both ways)
const orders = await q('SELECT id, so_no, customer_name, customer_id, order_date, lead_id FROM sale_orders');
const match = customerMatcher(customers);
const orderFills = [];
for (const o of orders) {
  if (o.customer_id || !o.customer_name || /^\d+$/.test(String(o.customer_name).trim())) continue;
  const m = match({ name: o.customer_name });
  if (m.customer) { orderFills.push({ id: o.id, sets: { customer_id: m.customer.id }, changes: { customer_id: [null, m.customer.id] } }); o.customer_id = m.customer.id; }
}
const takenLeads = new Set(orders.filter(o => o.lead_id).map(o => o.lead_id));
const wonCands = new Map(); // order id -> won enquiries that fit
for (const o of orders) {
  if (o.lead_id || !o.customer_id || !o.order_date) continue;
  const cands = (salesLeadsBy.get(o.customer_id) || []).filter(l => l.sales_call_status === 'Order Received' && !takenLeads.has(l.id));
  const u = uniqueEnquiry(cands, o.order_date, { window: 730, slack: 0 });
  if (u.lead) wonCands.set(o.id, u.lead.id);
}
const ordersPerLead = new Map(); for (const lid of wonCands.values()) ordersPerLead.set(lid, (ordersPerLead.get(lid) || 0) + 1);
for (const [oid, lid] of wonCands) {
  if (ordersPerLead.get(lid) !== 1) { rv('order-enquiry', `order ${oid}`, 'several orders fit the same enquiry'); continue; }
  const ex = orderFills.find(f => f.id === oid);
  if (ex) { ex.sets.lead_id = lid; ex.changes.lead_id = [null, lid]; } else orderFills.push({ id: oid, sets: { lead_id: lid }, changes: { lead_id: [null, lid] } });
}

// 7. action types on the imported follow-ups
const notes = await q(`SELECT id, note_type, plan_note_type, action_taken, plan_of_action FROM crm_notes WHERE import_tag = ? AND note_type = 'note'`, [NOTE_TAG]);
const noteTypes = [], dist = {}, unclassified = {};
for (const n of notes) {
  const t = classifyActionType(n.action_taken), pt = n.plan_note_type ? n.plan_note_type : classifyActionType(n.plan_of_action);
  if (!t && !pt) { const w = String(n.action_taken || '').toLowerCase().split(/\s+/).slice(0, 3).join(' '); if (w) unclassified[w] = (unclassified[w] || 0) + 1; continue; }
  noteTypes.push({ id: n.id, note_type: t || 'note', plan_note_type: pt || null, before_type: n.note_type, before_plan: n.plan_note_type ?? null });
  dist[t || 'note'] = (dist[t || 'note'] || 0) + 1;
}

// 8. contact people (from the CSV) for enquiries linked to a customer
const haveContact = new Set((await q('SELECT customer_id, LOWER(name) n FROM contacts')).map(c => `${c.customer_id}|${c.n}`));
const contacts = [];
for (const [lid, r] of csvLead) {
  const lead = leads.find(l => l.id === lid); const cid = lead?.converted_customer_id; if (!cid) continue;
  for (const name of new Set([r.contactCellName, r.contactName].filter(Boolean))) {
    const k = `${cid}|${name.toLowerCase()}`; if (haveContact.has(k)) continue;
    haveContact.add(k);
    contacts.push({ customerId: cid, name, phone: r.contactPhone || r.phone || null, email: r.contactEmail || r.email || null });
  }
}

// 9. customer-only notes that repeat an enquiry note (same customer, text and date)
const dupNotes = await q(`SELECT a.* FROM crm_notes a WHERE a.lead_id IS NULL AND a.customer_id IS NOT NULL AND a.opportunity_id IS NULL
   AND EXISTS (SELECT 1 FROM crm_notes b WHERE b.lead_id IS NOT NULL AND b.customer_id = a.customer_id AND b.content = a.content AND b.visit_date IS a.visit_date AND b.next_plan_date IS a.next_plan_date)`);

const plan = { tag: TAG, at: new Date().toISOString(), leadFills, custFills, orderFills, leadLinks, quotationLinks, noteTypes, dupNotes, contacts };
fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(PLAN, JSON.stringify(plan));
fs.writeFileSync('docs/sales-links-review.csv', ['kind,record,reason', ...review.map(r => [r.kind, r.ref, r.why].map(csvCell).join(','))].join('\n') + '\n');
const cnt = (list, k) => list.filter(e => e.sets?.[k] != null).length;
console.log(JSON.stringify({
  enquiriesLinkedToCustomer: leadLinks.length, leadFills: leadFills.length,
  leadFillBy: Object.fromEntries(['pin_code', 'territory', 'district', 'product_type', 'email', 'phone'].map(k => [k, cnt(leadFills, k)])),
  customerFills: custFills.length, customerFillBy: Object.fromEntries(['pin_code', 'state', 'city', 'email', 'phone'].map(k => [k, cnt(custFills, k)])),
  quotationsLinkedToEnquiry: quotationLinks.length, ordersCustomerFilled: cnt(orderFills, 'customer_id'), ordersLinkedToEnquiry: cnt(orderFills, 'lead_id'),
  notesClassified: noteTypes.length, classifiedAs: dist, unclassifiedNotes: notes.length - noteTypes.length,
  topUnclassified: Object.entries(unclassified).sort((a, b) => b[1] - a[1]).slice(0, 12),
  contactsToAdd: contacts.length, duplicateCustomerNotesToRemove: dupNotes.length, reviewRows: review.length,
}, null, 1));
console.log(`plan: ${PLAN}\nreview: docs/sales-links-review.csv\nDry run only — nothing written.`);
db.close();
