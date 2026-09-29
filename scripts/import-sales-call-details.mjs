// scripts/import-sales-call-details.mjs — enrich + complete the enquiries from the old CRM's
// "Sales Projection Enquiry List" export (~/Downloads/sales_call_details1..3.csv, 5,121 rows).
//   node --env-file=.env.local scripts/import-sales-call-details.mjs                 # dry run: writes the plan + review list
//   node --env-file=.env.local scripts/import-sales-call-details.mjs --apply [--limit N]   # applies the plan file (N of each kind = trial)
//   node --env-file=.env.local scripts/import-sales-call-details.mjs --rollback
// Existing enquiries (matched by full customer name + enquiry date) are ENRICHED, fill-blank only
// (COALESCE(NULLIF(col,''),?) in SQL — a value a person typed is never overwritten). Missing ones are
// inserted. Each enquiry's Action Taken / Plan Of Action becomes a Diary note on the enquiry.
// The dry run writes scripts/data/sales-call-details-plan.json; --apply reads exactly that file.
import fs from 'fs';
import path from 'path';
import { createClient } from '@libsql/client';
import { customerMatcher, compactName } from '../lib/enquiry-import.mjs';
import { personKey } from '../lib/sales-people.mjs';
import { leadStateForStage } from '../lib/lead-stage.mjs';
import { parseSalesCallDetails, dedupeRows } from '../lib/sales-call-details-import.mjs';

const TAG = 'import:sales-call-details-2026-09-30';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply'), ROLLBACK = args.includes('--rollback');
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const DATA = path.resolve('scripts/data');
const PLAN = `${DATA}/sales-call-details-plan.json`, MANIFEST = `${DATA}/sales-call-details-manifest.json`, BACKUP = `${DATA}/sales-call-details-backup.json`;
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql, a = []) => (await db.execute({ sql, args: a })).rows.map(r => ({ ...r }));
const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
async function retry(fn) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (err) { if (i >= 4) throw err; console.log(`  retry ${i}: ${err.message}`); await new Promise(r => setTimeout(r, 2000 * i)); }
  }
}
const batch = stmts => retry(() => db.batch(stmts, 'write'));
const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
const blank = v => v == null || v === '' || v === 0;

// ------------------------------------------------------------------ rollback
if (ROLLBACK) {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const stmts = [
    { sql: 'DELETE FROM crm_notes WHERE import_tag = ?', args: [TAG] },
    { sql: 'DELETE FROM contacts WHERE import_tag = ?', args: [TAG] },
    { sql: 'DELETE FROM lead_stage_history WHERE changed_by = ?', args: [TAG] },
  ];
  for (const id of chunks(m.productLeadIds || [], 200)) stmts.push({ sql: `DELETE FROM lead_products WHERE lead_id IN (${id.map(() => '?').join(',')})`, args: id }); // these leads had none before
  for (const id of chunks(m.insertedLeadIds, 200)) stmts.push({ sql: `DELETE FROM leads WHERE import_tag = ? AND id IN (${id.map(() => '?').join(',')})`, args: [TAG, ...id] });
  for (const e of m.enriched) for (const [f, [before, after]] of Object.entries(e.changes))
    stmts.push({ sql: `UPDATE leads SET ${f} = ? WHERE id = ? AND ${f} IS ?`, args: [before, e.id, after] });
  for (const s of m.stageChanges) stmts.push({ sql: 'UPDATE leads SET sales_call_status = ?, status = ? WHERE id = ? AND sales_call_status = ?', args: [s.from, s.fromStatus, s.id, s.to] });
  for (const c of m.customers) for (const [f, [before, after]] of Object.entries(c.changes))
    stmts.push({ sql: `UPDATE customers SET ${f} = ? WHERE id = ? AND ${f} IS ?`, args: [before, c.id, after] });
  for (const part of chunks(stmts, 150)) await batch(part);
  console.log(`rolled back: ${m.insertedLeadIds.length} leads deleted, ${m.enriched.length} enriched leads / ${m.stageChanges.length} stage changes / ${m.customers.length} customers restored, notes + contacts by tag deleted.`);
  process.exit(0);
}

// ------------------------------------------------------------------ apply (reads the plan file)
if (APPLY) {
  if (!fs.existsSync(PLAN)) { console.error('No plan file — run the dry run first.'); process.exit(1); }
  if (fs.existsSync(MANIFEST) && !args.includes('--resume')) { console.error('A manifest exists (already applied?). Run --rollback first, or --resume.'); process.exit(1); }
  const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
  const enrich = plan.enrich.slice(0, LIMIT), inserts = plan.inserts.slice(0, LIMIT);
  let nextId = (await q('SELECT COALESCE(MAX(id), 0) + 1 n FROM leads'))[0].n;
  if (fs.existsSync(MANIFEST)) nextId = 0; // resume: ids were already assigned in the manifest
  const prior = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : null;
  const ids = prior ? prior.insertedLeadIds : inserts.map((_, i) => nextId + i);
  const touchedLeads = enrich.map(e => e.leadId), touchedCust = plan.customerFills.map(c => c.id);

  if (!prior) {
    const inList = a => a.map(() => '?').join(',');
    fs.writeFileSync(BACKUP, JSON.stringify({
      leads: touchedLeads.length ? await q(`SELECT * FROM leads WHERE id IN (${inList(touchedLeads)})`, touchedLeads) : [],
      customers: touchedCust.length ? (await Promise.all(chunks(touchedCust, 400).map(c => q(`SELECT * FROM customers WHERE id IN (${inList(c)})`, c)))).flat() : [],
    }));
    fs.writeFileSync(MANIFEST, JSON.stringify({
      tag: TAG, at: new Date().toISOString(), insertedLeadIds: ids,
      enriched: enrich.filter(e => Object.keys(e.changes).length).map(e => ({ id: e.leadId, changes: e.changes })),
      productLeadIds: enrich.filter(e => e.products?.length).map(e => e.leadId),
      stageChanges: enrich.filter(e => e.stage).map(e => ({ id: e.leadId, ...e.stage })),
      customers: plan.customerFills.map(c => ({ id: c.id, changes: c.changes })),
    }));
  }

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const noteStmt = (leadId, n) => ({
    sql: `INSERT INTO crm_notes (lead_id, customer_id, note_type, content, visit_date, action_taken, next_plan_date, plan_of_action,
            plan_for, created_by, created_at, import_tag)
          SELECT ?, ?, 'note', ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM crm_notes WHERE lead_id = ? AND content = ? AND visit_date IS ?)`,
    args: [leadId, n.customerId, n.content, n.visitDate, n.action, n.nextDate, n.plan, n.planFor, n.createdBy, n.createdAt, TAG, leadId, n.content, n.visitDate],
  });
  const productStmts = (leadId, lines) => lines.map((l, i) => ({
    sql: `INSERT INTO lead_products (lead_id, product_id, description, sort_order) SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM lead_products WHERE lead_id = ? AND sort_order = ?)`,
    args: [leadId, l.product_id, l.description, i, leadId, i],
  }));

  // 1. enrich existing enquiries
  let done = 0;
  for (const part of chunks(enrich, 60)) {
    const stmts = [];
    for (const e of part) {
      const cols = Object.entries(e.sets);
      if (cols.length || e.bumpUpdatedAt) stmts.push({
        sql: `UPDATE leads SET ${[...cols.map(([k]) => `${k} = COALESCE(NULLIF(${k}, ''), ?)`),
          ...(e.bumpUpdatedAt ? ['updated_at = CASE WHEN updated_at < ? THEN ? ELSE updated_at END'] : [])].join(', ')} WHERE id = ?`,
        args: [...cols.map(([, v]) => v), ...(e.bumpUpdatedAt ? [e.bumpUpdatedAt, e.bumpUpdatedAt] : []), e.leadId],
      });
      if (e.stage) {
        stmts.push({ sql: 'UPDATE leads SET sales_call_status = ?, status = ? WHERE id = ? AND sales_call_status = ?', args: [e.stage.to, e.stage.toStatus, e.leadId, e.stage.from] });
        stmts.push({ sql: `INSERT INTO lead_stage_history (lead_id, from_stage, to_stage, changed_by) SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM lead_stage_history WHERE lead_id = ? AND changed_by = ?)`, args: [e.leadId, e.stage.from, e.stage.to, TAG, e.leadId, TAG] });
      }
      if (e.customerLink) stmts.push({ sql: `UPDATE leads SET converted_customer_id = COALESCE(converted_customer_id, ?) WHERE id = ?`, args: [e.customerLink, e.leadId] });
      if (e.products?.length) stmts.push(...productStmts(e.leadId, e.products)); // planned only for leads with no product lines
      if (e.note) stmts.push(noteStmt(e.leadId, e.note));
    }
    await batch(stmts); done += part.length; console.log(`  enriched ${done}/${enrich.length}`);
  }

  // 2. insert the missing enquiries: lead + stage history + products + Diary note in one atomic chunk
  done = 0;
  for (const part of chunks(inserts.map((r, i) => ({ r, id: ids[i] })), 40)) {
    const stmts = [];
    for (const { r, id } of part) {
      stmts.push({
        sql: `INSERT OR IGNORE INTO leads (id, lead_name, company_name, short_name, address, phone, telephone, email, enquiry_date, territory,
                account_manager, assigned_to, initiated_by, expected_value, expected_order_date, sales_call_status, status, owner_dept,
                converted_customer_id, sales_call_closed_at, sales_call_closed_by, product, product_id, created_by, created_at, updated_at, import_tag)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Sales', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [id, r.name, r.name, r.shortName, r.address, r.phone, r.telephone, r.email, r.enquiryDate, r.state,
          r.managerKey, r.managerKey, r.managerKey, r.value, r.expectedDate, r.stage, r.status, r.customerId,
          r.closed ? now : null, r.closed ? 'historical import' : null, r.products[0]?.description ?? null, r.products[0]?.product_id ?? null,
          TAG, `${r.enquiryDate} 00:00:00`, r.updatedAt, TAG],
      });
      stmts.push({ sql: `INSERT INTO lead_stage_history (lead_id, from_stage, to_stage, changed_by, changed_at) SELECT ?, NULL, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM lead_stage_history WHERE lead_id = ?)`, args: [id, r.stage, TAG, `${r.enquiryDate} 00:00:00`, id] });
      stmts.push(...productStmts(id, r.products));
      if (r.note) stmts.push(noteStmt(id, r.note));
    }
    await batch(stmts); done += part.length; console.log(`  inserted ${done}/${inserts.length}`);
  }

  // 3. customers + contacts
  for (const part of chunks(plan.customerFills, 150)) await batch(part.map(c => {
    const cols = Object.entries(c.sets);
    return { sql: `UPDATE customers SET ${cols.map(([k]) => `${k} = COALESCE(NULLIF(${k}, ''), ?)`).join(', ')} WHERE id = ?`, args: [...cols.map(([, v]) => v), c.id] };
  }));
  for (const part of chunks(plan.contacts, 150)) await batch(part.map(c => ({
    sql: `INSERT INTO contacts (customer_id, name, phone, email, notes, import_tag)
          SELECT ?, ?, ?, ?, 'From historical call records.', ? WHERE NOT EXISTS (SELECT 1 FROM contacts WHERE customer_id = ? AND LOWER(name) = LOWER(?))`,
    args: [c.customerId, c.name, c.phone, c.email, TAG, c.customerId, c.name],
  })));
  await db.execute({ sql: 'INSERT INTO usb_audit (actor, action, detail) VALUES (?, ?, ?)', args: [`script:${TAG}`, 'sales_call_details_import', JSON.stringify({ enriched: enrich.length, inserted: inserts.length, customers: plan.customerFills.length, contacts: plan.contacts.length })] });
  const [c] = await q('SELECT COUNT(*) leads FROM leads'), [n] = await q('SELECT COUNT(*) n FROM crm_notes WHERE import_tag = ?', [TAG]);
  console.log(`applied: ${enrich.length} enriched, ${inserts.length} inserted, ${plan.customerFills.length} customers filled, ${plan.contacts.length} contacts, ${n.n} Diary notes. Leads total ${c.leads}. Manifest: ${MANIFEST}`);
  process.exit(0);
}

// ------------------------------------------------------------------ dry run: build the plan
const files = [1, 2, 3].map(i => fs.readFileSync(`${process.env.HOME}/Downloads/sales_call_details${i}.csv`, 'utf8'));
const parsed = parseSalesCallDetails(files);
const TEST = /^(test|testing|demo|dummy)\b/i;
const keyOf = compactName;
const { rows, dups } = dedupeRows(parsed.rows.filter(r => !TEST.test(r.name)), keyOf);

const users = await q('SELECT username, display_name FROM users');
const stages = await q('SELECT name, is_won, is_lost FROM sales_stages');
const stageNames = new Set(stages.map(s => s.name));
const problems = [];
for (const r of rows) {
  if (!r.stage) problems.push(`row ${r.serial}: unknown stage "${r.stageRaw}"`);
  else if (!stageNames.has(r.stage)) problems.push(`row ${r.serial}: stage "${r.stage}" not in sales_stages`);
  if (r.manager) { r.managerKey = personKey(r.manager, users); if (!users.some(u => u.username === r.managerKey)) problems.push(`manager "${r.manager}" is not a user`); }
  else r.managerKey = null;
}
if (problems.length) { console.error([...new Set(problems)].slice(0, 20).join('\n')); process.exit(1); }

const leads = await q(`SELECT id, lead_name, enquiry_date, email, expected_value, converted_customer_id, import_tag, sales_call_status, status, updated_at,
  account_manager, assigned_to, initiated_by, phone, telephone, territory, expected_order_date, short_name FROM leads`);
const hist = new Map((await q(`SELECT lead_id, COUNT(*) n, SUM(changed_by LIKE 'import:%' OR changed_by IN ('historical import','old CRM import')) imp FROM lead_stage_history GROUP BY lead_id`)).map(h => [h.lead_id, h]));
const hasProducts = new Set((await q('SELECT DISTINCT lead_id FROM lead_products')).map(r => r.lead_id));
const notes = await q('SELECT lead_id, customer_id, content, visit_date FROM crm_notes');
const noteSet = new Set(notes.flatMap(n => [`L${n.lead_id}|${n.content}|${n.visit_date}`, `C${n.customer_id}|${n.content}|${n.visit_date}`]));
const customers = await q('SELECT id, name, email, phone FROM customers');
const custById = new Map(customers.map(c => [c.id, c]));
const match = customerMatcher(customers);
const catalog = await q('SELECT id, product_code, product_name FROM sales_products');
const prodByName = new Map(catalog.flatMap(p => [[String(p.product_name || '').toUpperCase().trim(), p], [String(p.product_code || '').toUpperCase().trim(), p]]));
const productLines = names => names.map(n => { const p = prodByName.get(n.toUpperCase()); return { product_id: p ? p.id : null, description: p ? p.product_name : n }; });

const byKey = new Map();
for (const l of leads) { const k = `${keyOf(l.lead_name)}|${l.enquiry_date}`; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(l); }
const used = new Set();
const cutoff = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
const stateOf = name => leadStateForStage(stages, name);

const enrich = [], inserts = [], review = [];
const custFill = new Map(), contacts = new Map();
const add = (id, r) => {
  const c = custById.get(id); if (!c) return;
  const f = custFill.get(id) || { id, sets: {}, changes: {} };
  if (blank(c.email) && r.email && !f.sets.email) { f.sets.email = r.email; f.changes.email = [c.email ?? null, r.email]; }
  if (blank(c.phone) && r.phone && !f.sets.phone) { f.sets.phone = r.phone; f.changes.phone = [c.phone ?? null, r.phone]; }
  if (Object.keys(f.sets).length) custFill.set(id, f);
  const cn = r.contactName;
  if (cn && cn.length > 2 && !/\d{4}/.test(cn) && compactName(cn) !== compactName(r.name) && !contacts.has(`${id}|${cn.toLowerCase()}`))
    contacts.set(`${id}|${cn.toLowerCase()}`, { customerId: id, name: cn, phone: r.contactPhone, email: r.contactEmail });
};
const noteFor = (r, customerId) => {
  if (!r.action && !r.plan) return null;
  const content = r.action || 'Follow-up planned';
  const key = `${content}|${r.followupDate}`;
  return { content, visitDate: r.followupDate, action: r.action, plan: r.plan, nextDate: r.nextDate, planFor: r.managerKey, createdBy: r.manager,
    createdAt: `${r.followupDate || r.enquiryDate} 00:00:00`, customerId: customerId || null, _key: key };
};

for (const r of rows) {
  const bucket = (byKey.get(`${keyOf(r.name)}|${r.enquiryDate}`) || []).filter(l => !used.has(l.id));
  let lead = null;
  if (bucket.length === 1) lead = bucket[0];
  else if (bucket.length > 1) {
    const pick = bucket.filter(l => (r.email && l.email && l.email.toLowerCase() === r.email) || (r.value && l.expected_value === r.value));
    if (pick.length === 1) lead = pick[0];
    else { review.push({ r, why: `${bucket.length} enquiries with this name and date — can't tell which` }); continue; }
  }
  const state = stateOf(r.stage);
  if (lead) {
    used.add(lead.id);
    const m = lead.converted_customer_id ? null : match({ name: r.name });
    const customerId = lead.converted_customer_id || m?.customer?.id || null;
    const want = { account_manager: r.managerKey, assigned_to: r.managerKey, initiated_by: r.managerKey, email: r.email, phone: r.phone,
      telephone: r.telephone, territory: r.state, expected_order_date: r.expectedDate, expected_value: r.value, short_name: r.shortName };
    const sets = {}, changes = {};
    for (const [k, v] of Object.entries(want)) if (v != null && blank(lead[k])) { sets[k] = v; changes[k] = [lead[k] ?? null, v]; }
    if (!lead.converted_customer_id && customerId) changes.converted_customer_id = [null, customerId];
    const h = hist.get(lead.id);
    const stage = r.stage && lead.import_tag && (!h || h.n === h.imp) && lead.sales_call_status !== r.stage
      ? { from: lead.sales_call_status, to: r.stage, fromStatus: lead.status, toStatus: state } : null;
    let note = noteFor(r, customerId);
    if (note && (noteSet.has(`L${lead.id}|${note._key}`) || (customerId && noteSet.has(`C${customerId}|${note._key}`)))) note = null;
    const bump = note && r.followupDate && `${r.followupDate} 00:00:00` > lead.updated_at ? `${r.followupDate} 00:00:00` : null;
    if (bump) changes.updated_at = [lead.updated_at, bump];
    const lines = !hasProducts.has(lead.id) && r.products.length ? productLines(r.products) : null;
    if (Object.keys(sets).length || stage || note || lines || (!lead.converted_customer_id && customerId)) {
      enrich.push({ leadId: lead.id, sets, changes, stage, note, bumpUpdatedAt: bump, products: lines, customerLink: !lead.converted_customer_id ? customerId : null });
    }
    if (customerId) add(customerId, r);
  } else {
    const m = match({ name: r.name });
    const customerId = m.customer?.id || null;
    const closed = state === 'open' && r.enquiryDate < cutoff;
    const note = noteFor(r, customerId);
    const lines = productLines(r.products);
    inserts.push({ ...r, customerId, closed, status: state, products: lines, note,
      updatedAt: note && r.followupDate && r.followupDate > r.enquiryDate ? `${r.followupDate} 00:00:00` : `${r.enquiryDate} 00:00:00` });
    if (customerId) add(customerId, r);
  }
}
for (const b of parsed.bad) review.push({ r: b, why: b.reason });
for (const r of rows) if (r.extraEmails.length) review.push({ r, why: `extra email(s) not stored: ${r.extraEmails.join(', ')}` });

const plan = { tag: TAG, at: new Date().toISOString(), enrich, inserts, customerFills: [...custFill.values()], contacts: [...contacts.values()] };
fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(PLAN, JSON.stringify(plan));
fs.writeFileSync('docs/sales-call-details-review.csv', ['serial,customer,reason', ...review.map(({ r, why }) => [r.serial, r.name, why].map(csvCell).join(','))].join('\n') + '\n');

const count = (a, f) => a.filter(f).length;
console.log(JSON.stringify({
  sourceRows: parsed.rows.length + parsed.bad.length, unreadable: parsed.bad.length, exactDuplicates: dups.length, review: review.length,
  existingEnquiriesMatched: used.size, enrich: enrich.length,
  enrichWith: { manager: count(enrich, e => e.sets.account_manager), email: count(enrich, e => e.sets.email), phone: count(enrich, e => e.sets.phone),
    state: count(enrich, e => e.sets.territory), stageChange: count(enrich, e => e.stage), note: count(enrich, e => e.note), products: count(enrich, e => e.products), newCustomerLink: count(enrich, e => e.customerLink) },
  inserts: inserts.length, insertsClosedAsHistory: count(inserts, i => i.closed), insertsLinkedToCustomer: count(inserts, i => i.customerId),
  diaryNotes: count(enrich, e => e.note) + count(inserts, i => i.note),
  overdueNextDates: [...enrich.map(e => e.note), ...inserts.map(i => i.note)].filter(n => n?.nextDate && n.nextDate < new Date().toISOString().slice(0, 10)).length,
  customersToFill: custFill.size, contactsToAdd: contacts.size,
  stageFlags: stages.map(s => `${s.name}:${s.is_won ? 'won' : s.is_lost ? 'lost' : 'open'}`),
}, null, 1));
console.log(`plan: ${PLAN}\nreview: docs/sales-call-details-review.csv\nDry run only — nothing written. Re-run with --apply.`);
db.close();
