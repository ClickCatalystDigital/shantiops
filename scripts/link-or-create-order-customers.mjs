// Sale orders with only a typed customer name (no customer_id): link or create (2026-10-05).
//  - Name matches exactly one customer once spacing/punctuation/M/s/Pvt/Ltd are ignored
//    (compactName, same rule the enquiry import used) -> link the order.
//  - No customer with that name at all -> create ONE customer per distinct name (tagged in
//    customers.source) and link all its orders. Different spellings of one name share one customer.
//  - Several customers share the name, or only a *similar* name exists ("ASK PHARMA" vs "ASK PHARMA
//    INDIA PRIVATE LIMITED") -> left alone and written to docs/order-customers-review.csv with the
//    candidates. A wrong link is worse than an unlinked order; pick these with "Link customer".
//   node --env-file=.env.local scripts/link-or-create-order-customers.mjs            # dry run
//   node --env-file=.env.local scripts/link-or-create-order-customers.mjs --apply
//   node --env-file=.env.local scripts/link-or-create-order-customers.mjs --rollback
import fs from 'fs';
import { createClient } from '@libsql/client';
import { compactName, customerMatcher } from '../lib/enquiry-import.mjs';

const TAG = 'import:order-customers-2026-10-05';
const MANIFEST = 'scripts/data/order-customers-manifest.json';
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql, args = []) => (await db.execute({ sql, args })).rows.map(r => ({ ...r }));
const arg = f => process.argv.includes(f);
const ids = a => a.map(() => '?').join(',');

if (arg('--rollback')) {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  for (let i = 0; i < m.orderIds.length; i += 200) {
    const part = m.orderIds.slice(i, i + 200);
    await db.execute({ sql: `UPDATE sale_orders SET customer_id = NULL WHERE id IN (${ids(part)}) AND customer_id IN (${ids(m.customerIds.concat(m.linkedCustomerIds))})`, args: [...part, ...m.customerIds, ...m.linkedCustomerIds] });
  }
  let removed = 0;
  for (const id of m.customerIds) {
    const [{ n }] = await q(`SELECT (SELECT COUNT(*) FROM sale_orders WHERE customer_id=?) + (SELECT COUNT(*) FROM leads WHERE converted_customer_id=?) + (SELECT COUNT(*) FROM quotations WHERE customer_id=?) + (SELECT COUNT(*) FROM projects WHERE customer_id=?) AS n`, [id, id, id, id]);
    if (n === 0) { await db.execute({ sql: 'DELETE FROM customers WHERE id = ? AND source = ?', args: [id, TAG] }); removed++; }
    else console.log(`customer ${id} is now used elsewhere — kept`);
  }
  console.log(`Rolled back: ${m.orderIds.length} orders unlinked, ${removed} customers removed.`);
  process.exit(0);
}

const customers = await q('SELECT id, name FROM customers');
const match = customerMatcher(customers);
const orders = await q("SELECT id, customer_name FROM sale_orders WHERE customer_id IS NULL AND customer_name IS NOT NULL AND TRIM(customer_name) != ''");
const link = [], create = new Map(), review = [];
for (const o of orders) {
  const name = o.customer_name.replace(/\s+/g, ' ').trim();
  const r = match({ name });
  if (r.customer) link.push({ orderId: Number(o.id), customerId: Number(r.customer.id) });
  else if (r.reason === 'no customer with this name') {
    const k = compactName(name);
    if (!k) { review.push({ order: o.id, name, why: 'name has no usable letters', candidates: '' }); continue; }
    if (!create.has(k)) create.set(k, { spellings: new Map(), orderIds: [] });
    const c = create.get(k); c.orderIds.push(Number(o.id)); c.spellings.set(name, (c.spellings.get(name) || 0) + 1);
  } else review.push({ order: o.id, name, why: r.reason, candidates: (r.similar || []).map(c => `${c.name} [#${c.id}]`).join(' | ') });
}
const newCustomers = [...create.values()].map(c => ({ name: [...c.spellings].sort((a, b) => b[1] - a[1])[0][0], orderIds: c.orderIds }));
console.log(`Orders without a customer: ${orders.length}`);
console.log(`  link to an existing customer: ${link.length}`);
console.log(`  new customers to create: ${newCustomers.length} (covering ${newCustomers.reduce((s, c) => s + c.orderIds.length, 0)} orders)`);
console.log(`  left for a person to choose: ${review.length}`);

const csv = ['order_id,name,why,candidates', ...review.map(r => [r.order, r.name, r.why, r.candidates].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
fs.writeFileSync('docs/order-customers-review.csv', csv + '\n');
if (!arg('--apply')) { console.log('\nDry run only — pass --apply. Review list: docs/order-customers-review.csv'); process.exit(0); }

const orderIds = [], customerIds = [], linkedCustomerIds = [...new Set(link.map(l => l.customerId))];
for (const l of link) { await db.execute({ sql: 'UPDATE sale_orders SET customer_id = ? WHERE id = ? AND customer_id IS NULL', args: [l.customerId, l.orderId] }); orderIds.push(l.orderId); }
for (const c of newCustomers) {
  const ins = await db.execute({ sql: 'INSERT INTO customers (name, source) VALUES (?, ?)', args: [c.name, TAG] });
  const cid = Number(ins.lastInsertRowid); customerIds.push(cid);
  for (const oid of c.orderIds) { await db.execute({ sql: 'UPDATE sale_orders SET customer_id = ? WHERE id = ? AND customer_id IS NULL', args: [cid, oid] }); orderIds.push(oid); }
}
fs.writeFileSync(MANIFEST, JSON.stringify({ orderIds, customerIds, linkedCustomerIds }, null, 2));
await db.execute({ sql: "INSERT INTO usb_audit (request_id, machine_id, actor, action, detail) VALUES (NULL, NULL, 'script:order-customers-2026-10-05', 'order_customers_link_or_create', ?)", args: [JSON.stringify({ linked: link.length, created: customerIds.length, review: review.length })] });
console.log(`Applied: ${link.length} linked, ${customerIds.length} customers created, ${review.length} left. Manifest: ${MANIFEST}`);
