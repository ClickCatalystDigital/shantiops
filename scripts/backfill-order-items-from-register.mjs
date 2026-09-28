// scripts/backfill-order-items-from-register.mjs — backfills real sale_order_items for
// already-existing sale_orders, from two pasted "Order Register" exports (the old CRM's PO-edit
// screen and its Collections screen — same underlying columns: SOS NO, Products[qty], Order Value).
// sale_order_items has never had a single row anywhere in this DB before this — every order the
// Sales Payment Tracker import created was header-only. This is purely additive: it never touches
// a sale_orders header field (status/subtotal/total already came from the tracker import), and it
// only inserts for a matched order that currently has zero items (idempotent, safe to re-run).
//
// A product token resolves to a real sales_products row by exact name, then exact code, both
// case-insensitive; unresolved tokens are still inserted as a free-text line (product_id NULL) so
// the order's real content isn't silently dropped. No per-line price exists in this source (only
// an order-level total, already captured) — qty/uom/hsn_code only.
//
// Usage:
//   node --env-file=.env.local scripts/backfill-order-items-from-register.mjs            # dry run
//   node --env-file=.env.local scripts/backfill-order-items-from-register.mjs --apply
//   node --env-file=.env.local scripts/backfill-order-items-from-register.mjs --rollback
import fs from 'fs';
import path from 'path';
import { createClient } from '@libsql/client';

const TAG = 'order-register-backfill-2026-09-29';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply'), ROLLBACK = args.includes('--rollback');
const MANIFEST = path.resolve('scripts/data/order-items-backfill-manifest.json');

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql, a = []) => (await db.execute({ sql, args: a })).rows.map(r => ({ ...r }));
async function batch(stmts) { for (let i = 0; i < stmts.length; i += 150) await db.batch(stmts.slice(i, i + 150), 'write'); }

if (ROLLBACK) {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  await batch([{ sql: 'DELETE FROM sale_order_items WHERE id IN (' + m.insertedIds.map(() => '?').join(',') + ')', args: m.insertedIds }]);
  console.log(`rolled back: ${m.insertedIds.length} sale_order_items rows deleted`);
  process.exit(0);
}

const normSo = s => s.toUpperCase().replace(/[\s\-\/]/g, '').replace(/\d+/g, d => String(Number(d)));

function parseTsv(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n').filter(l => l.trim());
  const [header, ...body] = lines;
  const cols = header.split('\t');
  const idx = name => cols.indexOf(name);
  return body.map(l => {
    const p = l.split('\t');
    return { sosNo: (p[idx('SOS NO.')] || '').trim(), products: p[idx('Products')] || '' };
  }).filter(r => r.sosNo);
}

const rows = [...parseTsv('scripts/data/order-register-raw.tsv'), ...parseTsv('scripts/data/order-register-collection-raw.tsv')];

const existingOrders = await q('SELECT id, so_no FROM sale_orders');
const soIndex = new Map();
for (const o of existingOrders) soIndex.set(normSo(o.so_no), o);

const existingItemCounts = await q('SELECT sale_order_id, COUNT(*) n FROM sale_order_items GROUP BY sale_order_id');
const hasItems = new Set(existingItemCounts.map(r => r.sale_order_id));

const products = await q('SELECT id, product_code, product_name, hsn_code FROM sales_products');
const byName = new Map(products.map(p => [String(p.product_name || '').toUpperCase().trim(), p]));
const byCode = new Map(products.map(p => [String(p.product_code || '').toUpperCase().trim(), p]));

// One entry per matched sale_order_id, tokens deduped by (name, qty) across any duplicate rows.
const perOrder = new Map();
const productLineRe = /([^\[\]]+)\[([\d.]+)\]/g;
for (const r of rows) {
  const key = normSo(r.sosNo);
  const order = soIndex.get(key);
  if (!order || hasItems.has(order.id)) continue;
  if (!perOrder.has(order.id)) perOrder.set(order.id, new Map());
  const lines = perOrder.get(order.id);
  let m;
  productLineRe.lastIndex = 0;
  while ((m = productLineRe.exec(r.products))) {
    const name = m[1].trim();
    const qty = Number(m[2]);
    if (!name) continue;
    lines.set(`${name.toUpperCase()}::${qty}`, { name, qty });
  }
}

let ordersToFill = 0, linesTotal = 0, linesResolved = 0, linesUnresolved = 0;
const inserts = [];
for (const [orderId, lines] of perOrder) {
  ordersToFill++;
  let sort = 0;
  for (const { name, qty } of lines.values()) {
    linesTotal++;
    const key = name.toUpperCase();
    const p = byName.get(key) || byCode.get(key);
    if (p) linesResolved++; else linesUnresolved++;
    inserts.push({
      sale_order_id: orderId,
      product_id: p ? p.id : null,
      item_description: p ? p.product_name : name,
      hsn_code: p ? p.hsn_code : null,
      qty,
      uom: null,
      rate: null,
      amount: null,
      sort_order: sort++,
    });
  }
}

console.log(JSON.stringify({
  registerRowsParsed: rows.length,
  ordersMatchedToFill: ordersToFill,
  linesTotal, linesResolvedToCatalog: linesResolved, linesUnresolvedFreeText: linesUnresolved,
}, null, 2));

if (!APPLY) { console.log('\nDry run — pass --apply to write.'); process.exit(0); }

const insertedIds = [];
for (let i = 0; i < inserts.length; i += 150) {
  const chunk = inserts.slice(i, i + 150);
  const results = await db.batch(chunk.map(it => ({
    sql: 'INSERT INTO sale_order_items (sale_order_id, product_id, item_description, hsn_code, qty, uom, rate, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    args: [it.sale_order_id, it.product_id, it.item_description, it.hsn_code, it.qty, it.uom, it.rate, it.amount, it.sort_order],
  })), 'write');
  for (const r of results) insertedIds.push(Number(r.lastInsertRowid));
}
fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
fs.writeFileSync(MANIFEST, JSON.stringify({ tag: TAG, insertedIds }, null, 2));
console.log(`\napplied: ${insertedIds.length} sale_order_items rows inserted across ${ordersToFill} orders. Manifest: ${MANIFEST}`);
db.close();
