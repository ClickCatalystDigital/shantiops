// Two independent, additive-only fixes found while investigating data gaps (2026-09-29):
//
// 1. GST% backfill on sales_products: every populated GST value anywhere in the system (843
//    sales_products + 2,773 Item Master rows) is 18%, zero exceptions — safe universal default
//    for the ~983 rows currently NULL. Never overwrites an existing value.
//
// 2. Customer re-link on sale_orders: the 2026-09-25 order import's own matcher (cnorm — case/
//    punctuation-insensitive exact match, identical logic reused here) ran BEFORE that same day's
//    8,728-row old-CRM customer import landed, so ~136 orders whose customer now exists (same-day
//    sequencing, not a matcher bug) were left unlinked. Plus 1 genuine miss found by comparison
//    (customer existed before the order import ran but didn't match — worth a look, linked anyway
//    since the name is an exact normalized match). Only linked when the match is unambiguous
//    (exactly one customer) — never guessed. Never touches a row that already has customer_id set.
//
//   node --env-file=.env.local scripts/backfill-product-gst-and-relink-customers.mjs           # dry run
//   node --env-file=.env.local scripts/backfill-product-gst-and-relink-customers.mjs --apply
import fs from 'fs';
import { createClient } from '@libsql/client';
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql, a = []) => (await db.execute({ sql, args: a })).rows.map(r => ({ ...r }));
const apply = process.argv.includes('--apply');

// --- 1. GST backfill ---
const gstMissing = await q(`SELECT id, product_code, product_name FROM sales_products WHERE gst_pct IS NULL`);
console.log(`GST backfill: ${gstMissing.length} products will get gst_pct=18 (currently NULL).`);

// --- 2. customer re-link ---
const cnorm = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const custs = await q('SELECT id, name FROM customers');
const cmap = new Map();
for (const c of custs) { const k = cnorm(c.name); if (!cmap.has(k)) cmap.set(k, []); cmap.get(k).push(c); }
const unlinked = await q(`SELECT id, customer_name FROM sale_orders WHERE customer_id IS NULL AND customer_name IS NOT NULL AND TRIM(customer_name) != ''`);
const relinks = [];
for (const o of unlinked) {
  const hits = cmap.get(cnorm(o.customer_name)) || [];
  if (hits.length === 1) relinks.push({ orderId: Number(o.id), customerId: Number(hits[0].id), name: o.customer_name });
}
console.log(`Customer re-link: ${relinks.length} orders will get customer_id set (exact normalized-name match, unambiguous).`);

if (!apply) { console.log('\nDry run only — pass --apply to write.'); process.exit(0); }

fs.writeFileSync('scripts/data/product-gst-relink-backfill-backup-2026-09-29.json', JSON.stringify({
  gstMissingIds: gstMissing.map(r => r.id),
  relinks,
}, null, 2));

await db.execute(`UPDATE sales_products SET gst_pct = 18 WHERE gst_pct IS NULL`);
for (const r of relinks) await db.execute({ sql: 'UPDATE sale_orders SET customer_id = ? WHERE id = ?', args: [r.customerId, r.orderId] });
await db.execute({
  sql: "INSERT INTO usb_audit (request_id, machine_id, actor, action, detail) VALUES (NULL, NULL, 'script:product-gst-relink-2026-09-29', 'product_gst_and_customer_relink_backfill', ?)",
  args: [JSON.stringify({ gstFilled: gstMissing.length, ordersRelinked: relinks.length })],
});
console.log(`Applied: gst_pct set on ${gstMissing.length} products, customer_id set on ${relinks.length} orders. Backup: scripts/data/product-gst-relink-backfill-backup-2026-09-29.json`);
