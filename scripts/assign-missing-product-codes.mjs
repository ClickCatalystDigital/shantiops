// scripts/assign-missing-product-codes.mjs — gives the 34 product-master rows with no code a real
// one, via the exact same atomic counter (`counters` table, `sales_product_code`) the live app's own
// POST /api/sales-products route already uses for a manually-created product with no code typed in —
// not a separate numbering scheme, so future app-created codes continue the same sequence with zero
// collision risk. Purely additive: never touches a row that already has a code.
// Usage: node --env-file=.env.local scripts/assign-missing-product-codes.mjs [--apply]
import { createClient } from '@libsql/client';
const APPLY = process.argv.includes('--apply');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql, a = []) => (await db.execute({ sql, args: a })).rows.map(r => ({ ...r }));

async function nextCounterValue(counterName, startAt = 1000) {
  const r = await db.execute({
    sql: `INSERT INTO counters (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value`,
    args: [counterName, startAt + 1],
  });
  return r.rows[0].value;
}

const rows = await q('SELECT id, product_name FROM sales_products WHERE product_code IS NULL');
console.log(`${rows.length} products with no code`);
if (!APPLY) { console.log('Dry run — pass --apply.'); process.exit(0); }

for (const r of rows) {
  const code = `PRD-${await nextCounterValue('sales_product_code')}`;
  await db.execute({ sql: 'UPDATE sales_products SET product_code = ? WHERE id = ?', args: [code, r.id] });
}
console.log(`assigned ${rows.length} new codes`);
db.close();
