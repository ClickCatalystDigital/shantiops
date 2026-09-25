// scripts/import-legacy-crm.mjs — one-off import of the old CRM exports (2026-09-25):
//   ProductData.csv          -> sales_products (the Product Master)
//   export_1..N.csv          -> customers (organizations) + their old-CRM summary
//   node scripts/import-legacy-crm.mjs <dir>                 # dry run: prints counts, writes the issues report
//   node scripts/import-legacy-crm.mjs <dir> --apply [--limit N]
//   node scripts/import-legacy-crm.mjs --rollback            # undo using the manifest written by --apply
// Existing customers are matched (same organization code, or same multi-word name ignoring Pvt/Ltd/M/s)
// and only have BLANK fields filled; everything the script changes is recorded in the manifest.
// New rows are tagged (customers.source / sales_products.created_by = TAG).
import fs from 'fs';
import path from 'path';
import { createClient } from '@libsql/client';
import { parseProducts, parseCustomerSummary, groupCustomers } from '../lib/legacy-crm-import.mjs';
import { customerKey } from '../lib/customer-match.mjs';

const TAG = 'import:legacy-crm-2026-09-25';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply'), ROLLBACK = args.includes('--rollback');
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const dir = args.find(a => !a.startsWith('--') && !/^\d+$/.test(a));
const MANIFEST = process.env.IMPORT_MANIFEST || path.resolve('legacy-crm-import-manifest.json');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql, a = []) => (await db.execute({ sql, args: a })).rows.map(r => ({ ...r }));
async function batch(stmts) { for (let i = 0; i < stmts.length; i += 150) await db.batch(stmts.slice(i, i + 150), 'write'); }

if (ROLLBACK) {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  await batch([
    ...m.updated.map(u => ({ sql: 'UPDATE customers SET party_code = ?, city = ?, account_manager = ?, products_of_interest = ?, legacy_crm_json = ? WHERE id = ?',
      args: [u.before.party_code, u.before.city, u.before.account_manager, u.before.products_of_interest, u.before.legacy_crm_json, u.id] })),
    { sql: 'DELETE FROM customers WHERE source = ?', args: [TAG] },
    { sql: 'DELETE FROM sales_products WHERE created_by = ?', args: [TAG] },
  ]);
  console.log(`rolled back: ${m.updated.length} existing customers restored, tagged customers + products deleted`);
  process.exit(0);
}

const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.csv'));
const productFile = files.find(f => /product/i.test(f));
const summaryFiles = files.filter(f => /export_\d+/i.test(f)).sort((a, b) => +a.match(/export_(\d+)/)[1] - +b.match(/export_(\d+)/)[1]);
const { products, issues: pIssues } = parseProducts(fs.readFileSync(path.join(dir, productFile), 'utf8'));
let rows = [], broken = [];
for (const f of summaryFiles) {
  const r = parseCustomerSummary(fs.readFileSync(path.join(dir, f), 'utf8'), f.replace(/^.*?(export_\d+)/, '$1'));
  rows = rows.concat(r.rows); broken = broken.concat(r.broken);
}
// Obvious test records in the old CRM ("Demo", "test for checkining") are not imported; listed in the report.
const TEST_NAME = /^(test|testing|demo|dummy)\b/i;
const testRows = rows.filter(r => TEST_NAME.test(r.name));
rows = rows.filter(r => !TEST_NAME.test(r.name));
const groups = groupCustomers(rows).slice(0, LIMIT);

// Match to existing customers.
const existing = await q("SELECT id, name, party_code, city, account_manager, products_of_interest, legacy_crm_json FROM customers");
const exByCode = new Map(existing.filter(e => e.party_code).map(e => [e.party_code, e]));
const exByKey = new Map(); for (const e of existing) { const k = customerKey(e.name); if (k.includes(' ')) exByKey.set(k, e); }
const usedNames = new Set(existing.map(e => e.name.toLowerCase()));
const inserts = [], updates = [], renamed = [];
for (const g of groups) {
  const code = g.codes[0] || null;
  const hit = (code && exByCode.get(code)) || (g.key.includes(' ') && exByKey.get(g.key));
  const json = JSON.stringify({ ...g.summary, district: g.district, source: 'old CRM customer summary 25/09/2026' });
  const fields = { party_code: code, city: g.district, account_manager: g.managers.join(', ') || null, products_of_interest: g.products.join(', ') || null };
  if (hit && (!code || !hit.party_code || hit.party_code === code)) {
    const set = {}; for (const [k, v] of Object.entries(fields)) if (v && !hit[k]) set[k] = v;
    if (!hit.legacy_crm_json) set.legacy_crm_json = json;
    if (Object.keys(set).length) {
      const orig = hit.orig || (hit.orig = { party_code: hit.party_code, city: hit.city, account_manager: hit.account_manager, products_of_interest: hit.products_of_interest, legacy_crm_json: hit.legacy_crm_json });
      updates.push({ id: hit.id, name: hit.name, set, before: orig });
      Object.assign(hit, set); // claim it: a later organization with a different code must not merge here too
      if (set.party_code) exByCode.set(set.party_code, hit);
    }
    continue;
  }
  let name = g.name;
  if (usedNames.has(name.toLowerCase())) {
    const alt = [code, g.district].filter(Boolean).map(x => `${g.name} (${x})`).find(n => !usedNames.has(n.toLowerCase()));
    let n = 2; name = alt || g.name; while (usedNames.has(name.toLowerCase())) name = `${g.name} (${n++})`;
    renamed.push([g.name, name]);
  }
  usedNames.add(name.toLowerCase());
  inserts.push({ name, ...fields, legacy_crm_json: json });
}

// Issues report (for the client) — committed alongside the script.
const keyCount = new Map(); for (const g of groups) keyCount.set(g.key, (keyCount.get(g.key) || 0) + 1);
const possibleDups = groups.filter(g => g.key && keyCount.get(g.key) > 1);
const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
fs.writeFileSync('docs/legacy-crm-possible-duplicates.csv',
  ['name key,organization,code,district,managers', ...possibleDups.sort((a, b) => a.key.localeCompare(b.key))
    .map(g => [g.key, g.name, g.codes.join(' '), g.district, g.managers.join(' / ')].map(csvCell).join(','))].join('\n') + '\n');
const report = `# Old CRM import — data issues (${new Date().toISOString().slice(0, 10)})

Source: the old CRM's Product Master (\`${productFile}\`) and Customer summary report (${summaryFiles.length} parts).

## Products — ${products.length} rows
- ${pIssues.sharedCodes.length} product codes are used by two different products. The first keeps the code; the others were imported as "CODE (2)" (original code kept in \`legacy_code\`):
${pIssues.sharedCodes.map(s => `  - ${s}`).join('\n')}
- ${pIssues.noCode} products have no code.
- ${pIssues.zeroPrice} products have price 0 — imported with no price.
- ${pIssues.zeroGst} products have GST 0% — imported with GST blank, so quotations use the Default GST % instead of 0%. Confirm which are really exempt.
- Premium / List / AMC price, life span, service frequency, services in warranty and warranty days are 0 for every product — not imported as values.

## Customers — ${rows.length} summary rows -> ${groups.length} organizations
- ${rows.length - groups.length} rows were merged into another row of the same organization (same code, or the same name ignoring Pvt/Ltd/M/s where the codes don't conflict).
- ${updates.length} matched existing customers already in Shanti Ops (only blank fields filled). ${inserts.length} new customers.
- ${renamed.length} organizations share an exact name with a different organization (usually people's first names such as "Anil"); they were kept separate and named "Name (code)" / "Name (district)".
- ${possibleDups.length} organizations share a name but were NOT merged because their codes differ, or the name is a single word. Listed in \`docs/legacy-crm-possible-duplicates.csv\` for review.
- ${broken.length} rows could not be read even after rejoining broken lines, and were skipped:
${broken.map(b => `  - ${b.file}: ${b.text}`).join('\n')}
- ${testRows.length} rows look like test records and were not imported: ${testRows.map(r => r.name).join('; ')}
- The export is a summary per organization (call counts by stage, totals). It has no enquiry dates, contacts or diary notes, so no enquiries were created from it — it is stored on the customer as "Old CRM summary".
`;
fs.writeFileSync('docs/legacy-crm-import-issues.md', report);

console.log(JSON.stringify({ products: products.length, summaryRows: rows.length, broken: broken.length, organizations: groups.length,
  newCustomers: inserts.length, updatedExisting: updates.length, renamed: renamed.length, possibleDups: possibleDups.length, apply: APPLY }, null, 1));

if (!APPLY) process.exit(0);
const already = await q('SELECT (SELECT COUNT(*) FROM customers WHERE source = ?) c, (SELECT COUNT(*) FROM sales_products WHERE created_by = ?) p', [TAG, TAG]);
if (already[0].c || already[0].p) { console.error('Already imported — run --rollback first.'); process.exit(1); }
fs.writeFileSync(MANIFEST, JSON.stringify({ tag: TAG, at: new Date().toISOString(), updated: updates.map(u => ({ id: u.id, before: u.before })) }));
const productRows = LIMIT === Infinity ? products : products.slice(0, LIMIT);
await batch([
  ...productRows.map(p => ({ sql: `INSERT INTO sales_products (product_code, legacy_code, product_name, product_type, category, description, unit, hsn_code, price, cost_price, gst_pct, warranty_days, serviceable, attributes_json, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, args: [p.product_code, p.legacy_code, p.product_name, p.product_type, p.category, p.description, p.unit, p.hsn_code, p.price, p.cost_price, p.gst_pct, p.warranty_days, p.serviceable, p.attributes_json, TAG] })),
  ...inserts.map(c => ({ sql: 'INSERT INTO customers (name, party_code, city, account_manager, products_of_interest, legacy_crm_json, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
    args: [c.name, c.party_code, c.city, c.account_manager, c.products_of_interest, c.legacy_crm_json, TAG] })),
  ...updates.map(u => { const k = Object.keys(u.set); return { sql: `UPDATE customers SET ${k.map(x => `${x} = ?`).join(', ')} WHERE id = ?`, args: [...k.map(x => u.set[x]), u.id] }; }),
]);
console.log(`applied: ${productRows.length} products, ${inserts.length} new customers, ${updates.length} existing updated. Manifest: ${MANIFEST}`);
