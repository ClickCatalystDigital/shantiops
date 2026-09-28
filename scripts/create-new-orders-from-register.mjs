// scripts/create-new-orders-from-register.mjs — creates real new sale_orders (+ items) for the SOS
// numbers in the Order Register that did NOT match any existing order, after manually classifying
// each of the 61 candidates into "real order" (48) vs "junk/placeholder/ambiguous" (13, listed below,
// never created). No order value/product/date is invented — only what the source literally has.
//
// Usage:
//   node --env-file=.env.local scripts/create-new-orders-from-register.mjs            # dry run
//   node --env-file=.env.local scripts/create-new-orders-from-register.mjs --apply
//   node --env-file=.env.local scripts/create-new-orders-from-register.mjs --rollback
import fs from 'fs';
import path from 'path';
import { createClient } from '@libsql/client';

const TAG = 'order-register-new-orders-2026-09-29';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply'), ROLLBACK = args.includes('--rollback');
const MANIFEST = path.resolve('scripts/data/new-orders-manifest.json');

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql, a = []) => (await db.execute({ sql, args: a })).rows.map(r => ({ ...r }));

if (ROLLBACK) {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  await db.batch([
    { sql: `DELETE FROM sale_order_items WHERE sale_order_id IN (${m.orderIds.map(() => '?').join(',')})`, args: m.orderIds },
    { sql: `DELETE FROM sale_orders WHERE id IN (${m.orderIds.map(() => '?').join(',')})`, args: m.orderIds },
  ], 'write');
  console.log(`rolled back: ${m.orderIds.length} new orders (and their items) deleted`);
  process.exit(0);
}

// Excluded on purpose, not created — reason noted for the record:
// SAS-           R K SEEDS                — incomplete reference, no real number
// SOS MADE       JK LIFE CARE CENTERS     — placeholder text, not a real order number
// 0000           Global Impex             — placeholder
// 1002           Sri Maruthi Builders     — bare 4-digit number, no company-numbering prefix, ambiguous
// SOS-1011       (kept — see below, plausible real)
// 889988         "test 2023"              — junk customer name
// SB             Synthokem Labs           — no number at all
// verbal         S. R Techno Crafts       — placeholder
// mail           Darsh Industries Ltd     — placeholder
// 4558962        "A A"                    — junk customer name, non-standard number
// nibr122        "aaaa"                   — junk customer name
// Email dated... Surya Exports            — placeholder, not a number
// 1589662020     "test for checkining"    — junk customer name
// SB-808 AND SB-809  Nagraj Industries    — combined reference to two orders, ambiguous split

const ORDERS = [
  ['sb-1116', 'SB-1116', 'Shanti Boilers'], ['SAS-507', 'SAS-507', 'Shanti Boilers'],
  ['SAS-492', 'SAS-492', 'Shanti Boilers'], ['SB-1097', 'SB-1097', 'Shanti Boilers'],
  ['SB-027', 'SB-027', 'Shanti Boilers'], ['STF-30', 'STF-30', 'Shanti Techno Fab'],
  ['SB-IBR-033', 'SB-IBR-033', 'Shanti Boilers'], ['STF-IBR-032', 'STF-IBR-032', 'Shanti Techno Fab'],
  ['SB-1083', 'SB-1083', 'Shanti Boilers'], ['STF-IBR-015', 'STF-IBR-015', 'Shanti Techno Fab'],
  ['SB/1056/24-25', 'SB/1056/24-25', 'Shanti Boilers'], ['SAS-1', 'SAS-1', 'Shanti Boilers'],
  ['STF-001', 'STF-001', 'Shanti Techno Fab'], ['SB-1049', 'SB-1049', 'Shanti Boilers'],
  ['SOS-1011', 'SOS-1011', 'Shanti Boilers'], ['SB-849', 'SB-849', 'Shanti Boilers'],
  ['NIBR-175', 'NIBR-175', 'Shanti Boilers'], ['SB-865', 'SB-865', 'Shanti Boilers'],
  ['NIBR-163', 'NIBR-163', 'Shanti Boilers'], ['SB-847', 'SB-847', 'Shanti Boilers'],
  ['SB-843', 'SB-843', 'Shanti Boilers'], ['SAS-25', 'SAS-25', 'Shanti Boilers'],
  ['SB-844', 'SB-844', 'Shanti Boilers'], ['SB-840', 'SB-840', 'Shanti Boilers'],
  ['sb-829', 'SB-829', 'Shanti Boilers'], ['NIBR-159', 'NIBR-159', 'Shanti Boilers'],
  ['SAS-09', 'SAS-09', 'Shanti Boilers'], ['NIBR-158', 'NIBR-158', 'Shanti Boilers'],
  ['SAS-19', 'SAS-19', 'Shanti Boilers'], ['SB-835', 'SB-835', 'Shanti Boilers'],
  ['SB-836', 'SB-836', 'Shanti Boilers'], ['SB-821', 'SB-821', 'Shanti Boilers'],
  ['SB-824', 'SB-824', 'Shanti Boilers'], ['SB-817', 'SB-817', 'Shanti Boilers'],
  ['SB-819', 'SB-819', 'Shanti Boilers'], ['SB - 814', 'SB-814', 'Shanti Boilers'],
  ['SB-813', 'SB-813', 'Shanti Boilers'], ['SB-NIBR-149', 'SB-NIBR-149', 'Shanti Boilers'],
  ['SB-807', 'SB-807', 'Shanti Boilers'], ['SAS-06', 'SAS-06', 'Shanti Boilers'],
  ['SB-804', 'SB-804', 'Shanti Boilers'], ['SB-864', 'SB-864', 'Shanti Boilers'],
  ['SB-842', 'SB-842', 'Shanti Boilers'], ['NIBR', 'NIBR', 'Shanti Boilers'],
  ['SB-816', 'SB-816', 'Shanti Boilers'], ['SB-833', 'SB-833', 'Shanti Boilers'],
  ['SB-815', 'SB-815', 'Shanti Boilers'], ['NIBR-144', 'NIBR-144', 'Shanti Boilers'],
];

const wantedSos = new Set(ORDERS.map(o => o[0]));

function parseTsv(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n').filter(l => l.trim());
  const [header, ...body] = lines;
  const cols = header.split('\t');
  const idx = name => cols.indexOf(name);
  return body.map(l => {
    const p = l.split('\t');
    return {
      orderDate: p[idx('Order Date')], sosNo: (p[idx('SOS NO.')] || '').trim(), products: p[idx('Products')] || '',
      customerCode: (p[idx('Customer Code')] || '').trim(), customer: (p[idx('Customer')] || '').trim(),
      acManager: (p[idx('A/c Manager')] || '').trim(), orderValue: (p[idx('Order Value')] || '').trim(),
    };
  }).filter(r => r.sosNo);
}
const rows = [...parseTsv('scripts/data/order-register-raw.tsv'), ...parseTsv('scripts/data/order-register-collection-raw.tsv')];
const bySos = new Map();
for (const r of rows) if (wantedSos.has(r.sosNo) && !bySos.has(r.sosNo)) bySos.set(r.sosNo, r);

const isoDate = d => { const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` : null; };
const parseNum = s => Number(String(s).replace(/,/g, '')) || 0;

const customers = await q('SELECT id, name, party_code FROM customers');
const byCode = new Map(customers.filter(c => c.party_code).map(c => [c.party_code, c]));
const byExactName = new Map(customers.map(c => [c.name.toUpperCase().trim(), c]));

const products = await q('SELECT id, product_code, product_name, hsn_code FROM sales_products');
const byProdName = new Map(products.map(p => [String(p.product_name || '').toUpperCase().trim(), p]));
const byProdCode = new Map(products.map(p => [String(p.product_code || '').toUpperCase().trim(), p]));

const productLineRe = /([^\[\]]+)\[([\d.]+)\]/g;

const toInsert = [];
for (const [rawSos, soNo, company] of ORDERS) {
  const r = bySos.get(rawSos);
  if (!r) { console.log('MISSING SOURCE ROW for', rawSos); continue; }
  let customer = r.customerCode ? byCode.get(r.customerCode) : null;
  if (!customer) customer = byExactName.get(r.customer.toUpperCase().trim()) || null;
  const total = parseNum(r.orderValue);
  const lines = [];
  let m; productLineRe.lastIndex = 0;
  while ((m = productLineRe.exec(r.products))) {
    const name = m[1].trim();
    if (name.length <= 1) continue; // filters the "o" junk token seen in a couple of source rows
    const qty = Number(m[2]);
    const p = byProdName.get(name.toUpperCase()) || byProdCode.get(name.toUpperCase());
    lines.push({ product_id: p ? p.id : null, item_description: p ? p.product_name : name, hsn_code: p ? p.hsn_code : null, qty });
  }
  toInsert.push({ soNo, company, customerId: customer ? customer.id : null, customerName: r.customer, total, orderDate: isoDate(r.orderDate), salesPerson: r.acManager, lines });
}

console.log(JSON.stringify({
  ordersToCreate: toInsert.length,
  withLinkedCustomer: toInsert.filter(o => o.customerId).length,
  totalLines: toInsert.reduce((a, o) => a + o.lines.length, 0),
  linesLinkedToProduct: toInsert.reduce((a, o) => a + o.lines.filter(l => l.product_id).length, 0),
  totalValue: toInsert.reduce((a, o) => a + o.total, 0),
}, null, 2));

if (!APPLY) {
  console.log('\nSample (first 5):');
  for (const o of toInsert.slice(0, 5)) console.log(' ', o.soNo, o.company, o.customerName, o.customerId ? `(linked #${o.customerId})` : '(unlinked)', o.total, o.lines.length, 'lines');
  console.log('\nDry run — pass --apply to write.');
  process.exit(0);
}

const orderIds = [];
for (const o of toInsert) {
  const res = await db.execute({
    sql: `INSERT INTO sale_orders (so_no, customer_name, customer_id, company, total, subtotal, order_date, sales_person_override, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [o.soNo, o.customerName, o.customerId, o.company, o.total, o.total, o.orderDate, o.salesPerson, TAG, o.orderDate ? `${o.orderDate} 00:00:00` : null],
  });
  const orderId = Number(res.lastInsertRowid);
  orderIds.push(orderId);
  let sort = 0;
  for (const l of o.lines) {
    await db.execute({
      sql: `INSERT INTO sale_order_items (sale_order_id, product_id, item_description, hsn_code, qty, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [orderId, l.product_id, l.item_description, l.hsn_code, l.qty, sort++],
    });
  }
}
fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
fs.writeFileSync(MANIFEST, JSON.stringify({ tag: TAG, orderIds }, null, 2));
console.log(`\napplied: ${orderIds.length} new sale_orders created. Manifest: ${MANIFEST}`);
db.close();
