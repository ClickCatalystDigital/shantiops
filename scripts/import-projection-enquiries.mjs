// scripts/import-projection-enquiries.mjs — imports the old CRM's "Sales Projection Enquiry List"
// export (~/Downloads/enquiries.csv, 2,500 real rows, 2020-2026) — a genuinely different, richer
// report than the "sales call list" PDF already imported (598 leads, all defaulted to Lead-Cold/
// unassigned/zero-value/truncated products). This one carries a real funnel stage, a real quote
// price, full product names, and follow-up history on every row.
//
// Stage mapping is a direct, confident 1:1 to the app's own real sales_stages (they read like the
// same taxonomy this export already uses) — no guessing needed. Customer matching reuses the exact
// same conservative matcher (lib/enquiry-import.mjs's customerMatcher) the original enquiry import
// used: only an unambiguous exact-name match links to a real customer; everything else imports
// unlinked rather than guessed. Products are split on "8-digit-HSN-code-dash" boundaries (best
// effort — a handful of entries with no HSN prefix between two real products will merge into one
// line; not worth hand-tuning further for a free-text field with no reliable delimiter).
//
// Usage:
//   node --env-file=.env.local scripts/import-projection-enquiries.mjs            # dry run
//   node --env-file=.env.local scripts/import-projection-enquiries.mjs --apply
//   node --env-file=.env.local scripts/import-projection-enquiries.mjs --rollback
import fs from 'fs';
import path from 'path';
import { createClient } from '@libsql/client';
import { parseCsv, clean } from '../lib/legacy-crm-import.mjs';
import { customerMatcher, isoDate } from '../lib/enquiry-import.mjs';

const TAG = 'import:sales-projection-enquiries-2026-09-29';
const APPLY = process.argv.includes('--apply'), ROLLBACK = process.argv.includes('--rollback');
const MANIFEST = path.resolve('scripts/data/projection-enquiries-manifest.json');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql, a = []) => (await db.execute({ sql, args: a })).rows.map(r => ({ ...r }));

if (ROLLBACK) {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  await db.batch([{ sql: `DELETE FROM leads WHERE id IN (${m.leadIds.map(() => '?').join(',')})`, args: m.leadIds }], 'write');
  console.log(`rolled back: ${m.leadIds.length} leads (and their cascaded stage-history/product rows) deleted`);
  process.exit(0);
}

const STAGE_MAP = {
  'LEAD - COLD': 'Lead - Cold', 'LEAD - HOT': 'Lead - Hot', 'LEAD PROJECT - DROPED': 'Lead Project - Dropped',
  'PROPOSALS': 'Proposals', 'HOT OFFERS': 'Hot Offers', 'ORDER RECEIVED': 'Order Received',
  'ORDER LOST': 'Order Lost', 'FOLLOW UP STAGE': 'Follow up stage', 'OEM FOLLOW UPS MONTHLY': 'OEM Follow Ups Monthly',
};

const stages = await q('SELECT name, is_won, is_lost FROM sales_stages');
const stageByName = new Map(stages.map(s => [s.name, s]));
const stateForStage = name => { const s = stageByName.get(name); return s?.is_won ? 'won' : s?.is_lost ? 'lost' : 'open'; };

const text = fs.readFileSync(process.env.HOME + '/Downloads/enquiries.csv', 'utf8');
const parsed = parseCsv(text);
const hi = parsed.findIndex(r => clean(r[0]) === 'S.N');
const body = parsed.slice(hi + 1).filter(r => r[0] && /^\d+$/.test(clean(r[0])));

const parseNum = s => { const n = Number(String(s || '').replace(/,/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
const TEST_NAME = /^(test|testing|demo|dummy)\b/i;

function splitProducts(raw) {
  const s = clean(raw);
  if (!s) return [];
  const marks = [...s.matchAll(/(\d{8})-/g)].map(m => m.index);
  if (!marks.length) return s.split(',').map(clean).filter(Boolean);
  const out = [];
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i] + 9; // past "NNNNNNNN-"
    const end = i + 1 < marks.length ? marks[i + 1] : s.length;
    const seg = clean(s.slice(start, end)).replace(/,+$/, '').trim();
    if (seg) out.push(seg);
  }
  return out;
}

const rows = body.map(r => ({
  name: clean(r[1]), shortName: clean(r[2]) || null, address: clean(r[3]) || null,
  enquiryDate: isoDate(clean(r[4])), email: clean(r[12]) || null,
  productsRaw: r[14] || '', stageRaw: clean(r[15]).toUpperCase(),
  quotePrice: parseNum(r[16]),
})).filter(r => r.name && !TEST_NAME.test(r.name));

// Dedupe exact literal repeats within the source itself (same org + date + price).
const seen = new Set();
const uniqueRows = rows.filter(r => {
  const key = `${r.name.toLowerCase()}|${r.enquiryDate}|${r.quotePrice}`;
  if (seen.has(key)) return false;
  seen.add(key); return true;
});

const customers = await q('SELECT id, name FROM customers');
const match = customerMatcher(customers);

const products = await q('SELECT id, product_code, product_name FROM sales_products');
const byProdName = new Map(products.map(p => [String(p.product_name || '').toUpperCase().trim(), p]));
const byProdCode = new Map(products.map(p => [String(p.product_code || '').toUpperCase().trim(), p]));

let matchedCustomer = 0, unrecognizedStage = 0;
const plan = uniqueRows.map(r => {
  const { customer } = match({ name: r.name });
  if (customer) matchedCustomer++;
  const stageName = STAGE_MAP[r.stageRaw] || 'Lead - Cold';
  if (!STAGE_MAP[r.stageRaw]) unrecognizedStage++;
  const lines = splitProducts(r.productsRaw).map(name => {
    const p = byProdName.get(name.toUpperCase()) || byProdCode.get(name.toUpperCase());
    return { product_id: p ? p.id : null, description: p ? p.product_name : name };
  });
  return { ...r, customerId: customer ? customer.id : null, stageName, lines };
});

console.log(JSON.stringify({
  sourceRows: body.length, afterFilterAndDedupe: uniqueRows.length,
  matchedToCustomer: matchedCustomer, unrecognizedStage,
  totalProductLines: plan.reduce((a, p) => a + p.lines.length, 0),
  linkedToCatalog: plan.reduce((a, p) => a + p.lines.filter(l => l.product_id).length, 0),
  totalExpectedValue: plan.reduce((a, p) => a + (p.quotePrice || 0), 0),
}, null, 2));

if (!APPLY) {
  console.log('\nSample (first 5):');
  for (const p of plan.slice(0, 5)) console.log(` `, p.name, '|', p.stageName, '|', p.customerId ? `customer #${p.customerId}` : 'unlinked', '|', p.quotePrice, '|', p.lines.length, 'lines');
  console.log('\nDry run — pass --apply to write.');
  process.exit(0);
}

const leadIds = [];
for (const p of plan) {
  const createdAt = p.enquiryDate ? `${p.enquiryDate} 00:00:00` : null;
  const res = await db.execute({
    sql: `INSERT INTO leads (lead_name, company_name, short_name, address, email, enquiry_date, sales_call_status, status,
            expected_value, converted_customer_id, owner_dept, import_tag, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Sales', ?, ?, ?, ?)`,
    args: [p.name, p.name, p.shortName, p.address, p.email, p.enquiryDate, p.stageName, stateForStage(p.stageName),
      p.quotePrice, p.customerId, TAG, TAG, createdAt, createdAt],
  });
  const leadId = Number(res.lastInsertRowid);
  leadIds.push(leadId);
  await db.execute({ sql: 'INSERT INTO lead_stage_history (lead_id, from_stage, to_stage, changed_by) VALUES (?, NULL, ?, ?)', args: [leadId, p.stageName, TAG] });
  let sort = 0;
  for (const l of p.lines) {
    await db.execute({ sql: 'INSERT INTO lead_products (lead_id, product_id, description, sort_order) VALUES (?, ?, ?, ?)', args: [leadId, l.product_id, l.description, sort++] });
  }
  if (p.lines.length) {
    await db.execute({ sql: 'UPDATE leads SET product = ?, product_id = ? WHERE id = ?', args: [p.lines[0].description, p.lines[0].product_id, leadId] });
  }
}
fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
fs.writeFileSync(MANIFEST, JSON.stringify({ tag: TAG, leadIds }, null, 2));
console.log(`\napplied: ${leadIds.length} leads created. Manifest: ${MANIFEST}`);
db.close();
