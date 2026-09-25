// scripts/import-enquiries.mjs — one-off import of the old CRM's sales call list (605 enquiries,
// PDF extracted to CSV, 2026-09-25) into leads (+ lead_products, lead_stage_history).
//   node scripts/import-enquiries.mjs <csv>                    # dry run: counts + review files, writes nothing
//   node scripts/import-enquiries.mjs <csv> --apply [--limit N]
//   node scripts/import-enquiries.mjs --rollback               # undo using the manifest written by --apply
// Rules (lib/enquiry-import.mjs): every enquiry lands at the funnel's first stage (the list has no
// stage); enquiries from the last 12 months stay open, older ones are imported as closed sales calls;
// a customer is linked only on an exact multi-word name match to exactly one customer, and then only
// that customer's BLANK phone/email is filled (recorded in the manifest). Nothing new is created in
// customers or the Product Master. Rows are tagged leads.import_tag = TAG.
import fs from 'fs';
import path from 'path';
import { createClient } from '@libsql/client';
import { parseEnquiries, customerMatcher, isOpenEnquiry } from '../lib/enquiry-import.mjs';

const TAG = 'import:enquiry-calls-2026-09-25';
const STAGE = 'Lead - Cold';
const CUTOFF = '2025-09-25'; // 12 months before the import
const CLOSED_BY = 'old CRM import';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply'), ROLLBACK = args.includes('--rollback');
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity; // for a rollback trial
const file = args.find(a => !a.startsWith('--') && !/^\d+$/.test(a));
const MANIFEST = process.env.IMPORT_MANIFEST || path.resolve('enquiry-import-manifest.json');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql, a = []) => (await db.execute({ sql, args: a })).rows.map(r => ({ ...r }));
async function batch(stmts) { for (let i = 0; i < stmts.length; i += 150) await db.batch(stmts.slice(i, i + 150), 'write'); }

if (ROLLBACK) {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  await batch([
    ...m.customers.map(c => ({ sql: 'UPDATE customers SET phone = ?, email = ? WHERE id = ?', args: [c.before.phone, c.before.email, c.id] })),
    { sql: 'DELETE FROM lead_stage_history WHERE lead_id IN (SELECT id FROM leads WHERE import_tag = ?)', args: [TAG] },
    { sql: 'DELETE FROM lead_products WHERE lead_id IN (SELECT id FROM leads WHERE import_tag = ?)', args: [TAG] },
    { sql: 'DELETE FROM leads WHERE import_tag = ?', args: [TAG] },
  ]);
  console.log(`rolled back: ${m.customers.length} customers' phone/email restored, tagged enquiries deleted`);
  process.exit(0);
}

const parsed = parseEnquiries(fs.readFileSync(file, 'utf8'));
const { bad, duplicates } = parsed;
const rows = parsed.rows.slice(0, LIMIT);
const customers = await q('SELECT id, name, phone, email FROM customers');
const match = customerMatcher(customers);
const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

const enquiries = [], review = [];
const contactFill = new Map(); // customer id -> { before, phone, email } (latest enquiry wins)
for (const r of [...rows].sort((a, b) => a.enquiry_date.localeCompare(b.enquiry_date))) {
  const m = match(r);
  if (!m.customer) review.push({ r, m });
  else {
    const c = m.customer;
    const f = contactFill.get(c.id) || { before: { phone: c.phone ?? null, email: c.email ?? null } };
    if (!c.phone && r.phone) f.phone = r.phone;
    if (!c.email && r.email) f.email = r.email;
    if (f.phone || f.email) contactFill.set(c.id, f);
  }
  enquiries.push({ r, customerId: m.customer?.id || null, open: isOpenEnquiry(r, CUTOFF) });
}

// Review list for the Sales Head: enquiries not linked to a customer, with any name suggestions.
const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
fs.writeFileSync('docs/enquiry-import-review.csv', ['serial,enquiry date,customer as written,why not linked,possible customers (id: name)',
  ...review.map(({ r, m }) => [r.serial, r.enquiry_date, r.name, m.reason, m.similar.map(c => `${c.id}: ${c.name}`).join(' | ')].map(csvCell).join(','))].join('\n') + '\n');

const open = enquiries.filter(e => e.open).length;
const withProducts = enquiries.filter(e => e.r.products).length;
const report = `# Old CRM sales calls — import notes (${now.slice(0, 10)})

Source: the old CRM's sales call list (PDF, 605 rows) extracted to CSV.

- ${rows.length + duplicates.length + bad.length} rows read -> ${enquiries.length} enquiries imported.
- ${duplicates.length} rows were the same enquiry printed twice (same customer, date, products, phone) and were imported once.
- ${bad.length} rows could not be read: ${bad.map(b => `#${b.serial} (${b.reason})`).join('; ') || 'none'}.
- Stage: the list has no stage, so every enquiry is at "${STAGE}". Enquiries dated ${CUTOFF} or later (${open}) are open on the Enquiry tab; the ${enquiries.length - open} older ones are imported as **closed** sales calls ("Closed by ${CLOSED_BY}") — kept as history on the customer, not as open work.
- No A/C manager or value in the list: enquiries are unassigned (the Sales Head sees them all) and have no expected value.
- Products: ${withProducts} enquiries list products. The PDF cut the product names off at the column edge (e.g. "BOILER SPA", "F GAS DUCTI"), so the text is kept exactly as printed, as one product line on the enquiry — it is **not** linked to the Product Master.
- District "ALL" and state "NA" were the old CRM's blanks and are left empty.
- Customers: ${enquiries.length - review.length} enquiries were linked to an existing customer (exact name, one match). ${contactFill.size} of those customers had no phone/email and got the one from their latest enquiry.
- ${review.length} enquiries were **not** linked — the name matched no customer, matched several, or only looked similar. They are listed in \`docs/enquiry-import-review.csv\` with suggestions; link them from the enquiry (Convert to customer) after checking.
- Rollback: \`IMPORT_MANIFEST=scripts/data/enquiry-import-manifest.json node scripts/import-enquiries.mjs --rollback\`.
`;
fs.writeFileSync('docs/enquiry-import-notes.md', report);

const reasons = {}; for (const { m } of review) reasons[m.reason.replace(/^\d+ /, 'N ')] = (reasons[m.reason.replace(/^\d+ /, 'N ')] || 0) + 1;
console.log(JSON.stringify({ read: rows.length + duplicates.length + bad.length, duplicates: duplicates.length, bad: bad.length,
  enquiries: enquiries.length, open, closed: enquiries.length - open, linked: enquiries.length - review.length, notLinked: review.length,
  notLinkedReasons: reasons, customersContactFilled: contactFill.size, withProducts, apply: APPLY }, null, 1));

if (!APPLY) process.exit(0);
const [{ n }] = await q('SELECT COUNT(*) n FROM leads WHERE import_tag = ?', [TAG]);
if (n && !args.includes('--resume')) { console.error('Already imported — run --rollback first (or --resume to finish an interrupted run).'); process.exit(1); }
const [{ s }] = await q('SELECT COUNT(*) s FROM sales_stages WHERE name = ?', [STAGE]);
if (!s) { console.error(`Stage "${STAGE}" not found.`); process.exit(1); }
if (!n) fs.writeFileSync(MANIFEST, JSON.stringify({ tag: TAG, at: now, customers: [...contactFill].map(([id, f]) => ({ id, before: f.before })) }));

// Every statement is guarded (NOT EXISTS on the enquiry's own row number, carried in notes), so a
// batch that is retried after a lost network response can't create duplicates.
const noteFor = r => [`Imported from the old CRM sales call list (row ${r.serial}).`, r.state ? `State: ${r.state}.` : ''].filter(Boolean).join(' ');
async function retry(fn) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (err) { if (i >= 4) throw err; console.log(`  retry ${i}: ${err.message}`); await new Promise(res => setTimeout(res, 2000 * i)); }
  }
}
const CHUNK = 60;
for (let i = 0; i < enquiries.length; i += CHUNK) {
  await retry(() => db.batch(enquiries.slice(i, i + CHUNK).map(e => {
    const r = e.r, notes = noteFor(r);
    return {
      sql: `INSERT INTO leads (lead_name, company_name, short_name, phone, telephone, email, address, district, enquiry_date, product,
              source, status, owner_dept, notes, converted_customer_id, sales_call_status, sales_call_closed_at, sales_call_closed_by,
              created_by, created_at, updated_at, import_tag)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Old CRM', 'open', 'Sales', ?, ?, ?, ?, ?, NULL, ?, ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM leads WHERE import_tag = ? AND notes = ?)`,
      args: [r.name, r.name, r.short_name, r.phone, r.telephone, r.email, r.address, r.district, r.enquiry_date, r.products,
        notes, e.customerId, STAGE, e.open ? null : now, e.open ? null : CLOSED_BY, `${r.enquiry_date} 00:00:00`, now, TAG, TAG, notes],
    };
  }), 'write'));
  console.log(`  enquiries ${Math.min(i + CHUNK, enquiries.length)}/${enquiries.length}`);
}
const idByNote = new Map((await q('SELECT id, notes FROM leads WHERE import_tag = ?', [TAG])).map(l => [l.notes, Number(l.id)]));
const children = [];
for (const e of enquiries) {
  const id = idByNote.get(noteFor(e.r));
  if (!id) throw new Error(`enquiry row ${e.r.serial} was not inserted`);
  children.push({ sql: `INSERT INTO lead_stage_history (lead_id, from_stage, to_stage, changed_by, changed_at)
    SELECT ?, NULL, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM lead_stage_history WHERE lead_id = ?)`, args: [id, STAGE, CLOSED_BY, `${e.r.enquiry_date} 00:00:00`, id] });
  if (e.r.products) children.push({ sql: `INSERT INTO lead_products (lead_id, product_id, description, sort_order)
    SELECT ?, NULL, ?, 0 WHERE NOT EXISTS (SELECT 1 FROM lead_products WHERE lead_id = ?)`, args: [id, e.r.products, id] });
}
for (let i = 0; i < children.length; i += 150) await retry(() => db.batch(children.slice(i, i + 150), 'write'));
const fills = [...contactFill].map(([id, f]) => {
  const set = Object.entries({ phone: f.phone, email: f.email }).filter(([, v]) => v);
  return { sql: `UPDATE customers SET ${set.map(([k]) => `${k} = COALESCE(NULLIF(${k}, ''), ?)`).join(', ')} WHERE id = ?`, args: [...set.map(([, v]) => v), id] };
});
for (let i = 0; i < fills.length; i += 150) await retry(() => db.batch(fills.slice(i, i + 150), 'write'));
console.log(`applied: ${idByNote.size} enquiries, ${children.length} history/product rows, ${fills.length} customers' contact filled. Manifest: ${MANIFEST}`);
