// Narrow HSN backfill: a product missing hsn_code gets one only when every other product sharing
// its "family" (same name with sizes/dimensions/units stripped — e.g. "AIR LOCK-RAV-100" and
// "AIR LOCK-RAV-125" share the family "AIR LOCK RAV") that DOES have an hsn_code all agree on the
// exact same one. A family whose known members disagree on HSN is skipped, never guessed. A family
// with no known-HSN member at all is left alone (nothing to infer from). Never overwrites an
// existing value. GST is untouched here (see backfill-product-gst-and-relink-customers.mjs) since
// every HSN in this catalog already carries one uniform GST% — filling hsn_code alone is enough.
//
//   node --env-file=.env.local scripts/backfill-hsn-from-sibling-family.mjs           # dry run
//   node --env-file=.env.local scripts/backfill-hsn-from-sibling-family.mjs --apply
import fs from 'fs';
import { createClient } from '@libsql/client';
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql, a = []) => (await db.execute({ sql, args: a })).rows.map(r => ({ ...r }));
const apply = process.argv.includes('--apply');

function familyKey(name) {
  return String(name || '')
    .toUpperCase()
    .replace(/[\d]+(\.\d+)?/g, '')
    .replace(/\b(MM|NB|KG|CM|INCH|IN|LG|THK|NOS?)\b/g, '')
    .replace(/[^A-Z]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const rows = await q(`SELECT id, product_name, hsn_code FROM sales_products`);
const byFamily = new Map();
for (const r of rows) {
  const k = familyKey(r.product_name);
  if (!k) continue;
  if (!byFamily.has(k)) byFamily.set(k, []);
  byFamily.get(k).push(r);
}

const updates = [];
for (const members of byFamily.values()) {
  const withHsn = members.filter(m => m.hsn_code && String(m.hsn_code).trim());
  const withoutHsn = members.filter(m => !m.hsn_code || !String(m.hsn_code).trim());
  if (!withHsn.length || !withoutHsn.length) continue;
  const distinctHsn = new Set(withHsn.map(m => m.hsn_code));
  if (distinctHsn.size > 1) continue; // siblings disagree — don't guess
  const hsn = [...distinctHsn][0];
  for (const m of withoutHsn) updates.push({ id: Number(m.id), hsn, name: m.product_name });
}

console.log(`HSN family backfill: ${updates.length} products will get an hsn_code inferred from an agreeing sibling.`);
if (!apply) { console.log('\nDry run only — pass --apply to write.'); process.exit(0); }

fs.writeFileSync('scripts/data/hsn-family-backfill-backup-2026-09-29.json', JSON.stringify(updates, null, 2));
for (const u of updates) await db.execute({ sql: 'UPDATE sales_products SET hsn_code = ? WHERE id = ?', args: [u.hsn, u.id] });
await db.execute({
  sql: "INSERT INTO usb_audit (request_id, machine_id, actor, action, detail) VALUES (NULL, NULL, 'script:hsn-family-backfill-2026-09-29', 'sales_product_hsn_family_backfill', ?)",
  args: [JSON.stringify({ filled: updates.length })],
});
console.log(`Applied: hsn_code set on ${updates.length} products. Backup: scripts/data/hsn-family-backfill-backup-2026-09-29.json`);
