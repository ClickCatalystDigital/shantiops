// scripts/refresh-customer-summary.mjs — re-pull of the old CRM's "Customer Summary" report
// (same shape as scripts/import-legacy-crm.mjs's export_N.csv, freshly exported 2026-09-29 as
// cust_1_to_2500.csv .. cust_7501_to_9008.csv). Customers only — does NOT touch sales_products
// (the original script blindly re-inserts every product row with no dedup; re-running that against
// a fresh ProductData export would duplicate the whole Product Master, which nothing here asked for).
//
// Same "only fill blank fields" rule as the original import; new orgs not yet in the DB are inserted.
// Usage:
//   node --env-file=.env.local scripts/refresh-customer-summary.mjs            # dry run
//   node --env-file=.env.local scripts/refresh-customer-summary.mjs --apply
//   node --env-file=.env.local scripts/refresh-customer-summary.mjs --rollback
import fs from 'fs';
import path from 'path';
import { createClient } from '@libsql/client';
import { parseCustomerSummary, groupCustomers } from '../lib/legacy-crm-import.mjs';
import { customerKey } from '../lib/customer-match.mjs';

const TAG = 'import:legacy-crm-refresh-2026-09-29';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply'), ROLLBACK = args.includes('--rollback');
const MANIFEST = path.resolve('scripts/data/customer-summary-refresh-manifest.json');
const dir = process.env.HOME + '/Downloads';
const files = ['cust_1_to_2500.csv', 'cust_2501_to_5000.csv', 'cust_5001_to_7500.csv', 'cust_7501_to_9008.csv'];

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql, a = []) => (await db.execute({ sql, args: a })).rows.map(r => ({ ...r }));
async function batch(stmts) { for (let i = 0; i < stmts.length; i += 150) await db.batch(stmts.slice(i, i + 150), 'write'); }

if (ROLLBACK) {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  await batch([
    ...m.updated.map(u => ({ sql: 'UPDATE customers SET party_code = ?, city = ?, account_manager = ?, products_of_interest = ?, legacy_crm_json = ? WHERE id = ?',
      args: [u.before.party_code, u.before.city, u.before.account_manager, u.before.products_of_interest, u.before.legacy_crm_json, u.id] })),
    { sql: 'DELETE FROM customers WHERE source = ?', args: [TAG] },
  ]);
  console.log(`rolled back: ${m.updated.length} existing customers restored, tagged new customers deleted`);
  process.exit(0);
}

let rows = [], broken = [];
for (const f of files) {
  const r = parseCustomerSummary(fs.readFileSync(path.join(dir, f), 'utf8'), f);
  rows = rows.concat(r.rows); broken = broken.concat(r.broken);
}
const TEST_NAME = /^(test|testing|demo|dummy)\b/i;
rows = rows.filter(r => !TEST_NAME.test(r.name));
const groups = groupCustomers(rows);

const existing = await q('SELECT id, name, party_code, city, account_manager, products_of_interest, legacy_crm_json FROM customers');
const exByCode = new Map(existing.filter(e => e.party_code).map(e => [e.party_code, e]));
const exByKey = new Map(); for (const e of existing) { const k = customerKey(e.name); if (k.includes(' ')) exByKey.set(k, e); }
const usedNames = new Set(existing.map(e => e.name.toLowerCase()));

const inserts = [], updates = [];
for (const g of groups) {
  const code = g.codes[0] || null;
  const hit = (code && exByCode.get(code)) || (g.key.includes(' ') && exByKey.get(g.key));
  const json = JSON.stringify({ ...g.summary, district: g.district, source: 'old CRM customer summary refresh 29/09/2026' });
  const fields = { party_code: code, city: g.district, account_manager: g.managers.join(', ') || null, products_of_interest: g.products.join(', ') || null };
  if (hit && (!code || !hit.party_code || hit.party_code === code)) {
    const set = {}; for (const [k, v] of Object.entries(fields)) if (v && !hit[k]) set[k] = v;
    if (!hit.legacy_crm_json) set.legacy_crm_json = json;
    if (Object.keys(set).length) {
      const orig = hit.orig || (hit.orig = { party_code: hit.party_code, city: hit.city, account_manager: hit.account_manager, products_of_interest: hit.products_of_interest, legacy_crm_json: hit.legacy_crm_json });
      updates.push({ id: hit.id, name: hit.name, set, before: orig });
      Object.assign(hit, set);
      if (set.party_code) exByCode.set(set.party_code, hit);
    }
    continue;
  }
  let name = g.name;
  if (usedNames.has(name.toLowerCase())) {
    const alt = [code, g.district].filter(Boolean).map(x => `${g.name} (${x})`).find(n => !usedNames.has(n.toLowerCase()));
    let n = 2; name = alt || g.name; while (usedNames.has(name.toLowerCase())) name = `${g.name} (${n++})`;
  }
  usedNames.add(name.toLowerCase());
  inserts.push({ name, ...fields, legacy_crm_json: json });
}

console.log(JSON.stringify({ parsedRows: rows.length, broken: broken.length, organizations: groups.length, updates: updates.length, inserts: inserts.length }, null, 2));

if (!APPLY) {
  if (args.includes('--sample')) {
    console.log('\nSample of 20 would-be inserts:');
    for (const c of inserts.slice(0, 20)) console.log(`  ${c.name} | code=${c.party_code} | city=${c.city} | products=${(c.products_of_interest||'').slice(0,60)}`);
    const singleWord = inserts.filter(c => !c.name.includes(' '));
    console.log(`\nsingle-word names among inserts: ${singleWord.length} / ${inserts.length}`);
    console.log('sample single-word names:', singleWord.slice(0, 15).map(c => c.name));
  }
  console.log('\nDry run — pass --apply to write.');
  process.exit(0);
}

const before = updates.map(u => ({ id: u.id, before: u.before }));
await batch([
  ...updates.map(u => ({ sql: `UPDATE customers SET ${Object.keys(u.set).map(k => `${k} = ?`).join(', ')} WHERE id = ?`, args: [...Object.values(u.set), u.id] })),
  ...inserts.map(c => ({ sql: 'INSERT INTO customers (name, party_code, city, account_manager, products_of_interest, legacy_crm_json, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
    args: [c.name, c.party_code, c.city, c.account_manager, c.products_of_interest, c.legacy_crm_json, TAG] })),
]);
fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
fs.writeFileSync(MANIFEST, JSON.stringify({ tag: TAG, updated: before }, null, 2));
console.log(`\napplied: ${updates.length} existing customers updated (blank fields filled), ${inserts.length} new customers inserted. Manifest: ${MANIFEST}`);
db.close();
