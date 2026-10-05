// Second pass for the 195 sale orders left by link-or-create-order-customers.mjs (2026-10-05).
// Each distinct name was judged by hand (scripts/data/order-customers-decisions.json):
//   {"id": N}  -> link the orders to that existing customer (same company, shorter/variant spelling)
//   {"new": X} -> create customer X (tagged in customers.source) and link; names that clearly
//                 differ from every candidate ("BR BOARDS" vs "K A BOARDS") are created, not linked.
// Doubtful cases were created rather than linked: a duplicate customer is easy to merge, a wrong link is not.
//   node --env-file=.env.local scripts/link-order-customers-curated.mjs [--apply | --rollback]
import fs from 'fs';
import { createClient } from '@libsql/client';

const TAG = 'import:order-customers-curated-2026-10-05';
const MANIFEST = 'scripts/data/order-customers-curated-manifest.json';
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql, args = []) => (await db.execute({ sql, args })).rows.map(r => ({ ...r }));
const arg = f => process.argv.includes(f);
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

if (arg('--rollback')) {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  for (const oid of m.orderIds) await db.execute({ sql: 'UPDATE sale_orders SET customer_id = NULL WHERE id = ?', args: [oid] });
  let removed = 0;
  for (const id of m.customerIds) {
    const [{ n }] = await q(`SELECT (SELECT COUNT(*) FROM sale_orders WHERE customer_id=?) + (SELECT COUNT(*) FROM leads WHERE converted_customer_id=?) + (SELECT COUNT(*) FROM quotations WHERE customer_id=?) + (SELECT COUNT(*) FROM projects WHERE customer_id=?) AS n`, [id, id, id, id]);
    if (n === 0) { await db.execute({ sql: 'DELETE FROM customers WHERE id = ? AND source = ?', args: [id, TAG] }); removed++; }
  }
  console.log(`Rolled back: ${m.orderIds.length} orders unlinked, ${removed} customers removed.`); process.exit(0);
}

const decisions = JSON.parse(fs.readFileSync('scripts/data/order-customers-decisions.json', 'utf8'));
const existing = new Map((await q('SELECT id, name FROM customers')).map(c => [Number(c.id), c.name]));
const byName = new Map([...existing].map(([id, n]) => [n, id]));
const orders = await q("SELECT id, customer_name FROM sale_orders WHERE customer_id IS NULL AND TRIM(COALESCE(customer_name,'')) != ''");
const plan = new Map(); // key -> {customerId | newName, orderIds}
let skipped = 0;
for (const o of orders) {
  const name = clean(o.customer_name), d = decisions[name];
  if (!d) { skipped++; continue; }
  if (d.id && !existing.has(d.id)) throw new Error(`customer #${d.id} for "${name}" does not exist`);
  const key = d.id ? `id:${d.id}` : `new:${d.new}`;
  if (!plan.has(key)) plan.set(key, { ...d, orderIds: [] });
  plan.get(key).orderIds.push(Number(o.id));
}
const links = [...plan.values()].filter(p => p.id), news = [...plan.values()].filter(p => p.new);
console.log(`Unlinked orders with a name: ${orders.length}; decided: ${orders.length - skipped}, no decision: ${skipped}`);
console.log(`  link to existing: ${links.length} customers (${links.reduce((s, p) => s + p.orderIds.length, 0)} orders)`);
console.log(`  new customers: ${news.length} (${news.reduce((s, p) => s + p.orderIds.length, 0)} orders)`);
if (!arg('--apply')) { console.log('Dry run only — pass --apply.'); process.exit(0); }

const orderIds = [], customerIds = [];
for (const p of plan.values()) {
  let cid = p.id;
  if (p.new) {
    if (byName.has(p.new)) cid = byName.get(p.new); // a customer with this exact name appeared since — reuse it
    else { cid = Number((await db.execute({ sql: 'INSERT INTO customers (name, source) VALUES (?, ?)', args: [p.new, TAG] })).lastInsertRowid); customerIds.push(cid); byName.set(p.new, cid); }
  }
  for (const oid of p.orderIds) { await db.execute({ sql: 'UPDATE sale_orders SET customer_id = ? WHERE id = ? AND customer_id IS NULL', args: [cid, oid] }); orderIds.push(oid); }
}
fs.writeFileSync(MANIFEST, JSON.stringify({ orderIds, customerIds }, null, 2));
await db.execute({ sql: "INSERT INTO usb_audit (request_id, machine_id, actor, action, detail) VALUES (NULL, NULL, 'script:order-customers-curated-2026-10-05', 'order_customers_curated_link', ?)", args: [JSON.stringify({ orders: orderIds.length, created: customerIds.length })] });
console.log(`Applied: ${orderIds.length} orders linked, ${customerIds.length} customers created.`);
