// One-off cleanup — real leftover test/junk data found in the live DB while investigating the
// user's "remove all test data from quotation" request. Nothing in the `quotations` table itself
// was test data (all 2,221 rows share one legitimate import tag) — this is the actual junk: 2
// leftover automated-test customers (never cleaned up after an earlier E2E test run) and 5 test/junk
// rows that rode in with the legacy-CRM customer import. All 7 have zero real business activity
// (no orders/quotations/projects/notes) — confirmed by direct query before writing this script.
// Two of them (lead 3694 "Steel Testing" -> customer 17240) are linked to each other and must be
// deleted lead-first, since leads.converted_customer_id references customers with no cascade.
//
// Usage: node --env-file=.env.local scripts/delete-test-records-2026-09-29.mjs            # dry run
//        node --env-file=.env.local scripts/delete-test-records-2026-09-29.mjs --apply
import fs from 'fs';
import { createClient } from '@libsql/client';

const APPLY = process.argv.includes('--apply');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const CUSTOMER_IDS = [360, 361, 11468, 16865, 17240, 17670, 18864];
const LEAD_IDS = [1617, 3694];

const customers = (await db.execute({
  sql: `SELECT * FROM customers WHERE id IN (${CUSTOMER_IDS.map(() => '?').join(',')})`, args: CUSTOMER_IDS,
})).rows;
const leads = (await db.execute({
  sql: `SELECT * FROM leads WHERE id IN (${LEAD_IDS.map(() => '?').join(',')})`, args: LEAD_IDS,
})).rows;

console.log(`Would delete ${leads.length} leads and ${customers.length} customers:`);
for (const l of leads) console.log(`  lead #${l.id}: ${l.lead_name}${l.converted_customer_id ? ` (converted -> customer #${l.converted_customer_id})` : ''}`);
for (const c of customers) console.log(`  customer #${c.id}: ${c.name} (source: ${c.source || 'n/a'})`);

if (!APPLY) { console.log('\nDry run — pass --apply to delete.'); process.exit(0); }

fs.mkdirSync('scripts/data', { recursive: true });
fs.writeFileSync('scripts/data/deleted-test-records-2026-09-29.json', JSON.stringify({ customers, leads }, null, 2));

// Leads first — a lead's own converted_customer_id references customers with no cascade, so the
// referencing row has to go before the customer it points at.
for (const id of LEAD_IDS) await db.execute({ sql: 'DELETE FROM leads WHERE id = ?', args: [id] });
for (const id of CUSTOMER_IDS) await db.execute({ sql: 'DELETE FROM customers WHERE id = ?', args: [id] });

console.log(`\nDeleted ${leads.length} leads and ${customers.length} customers. Backup: scripts/data/deleted-test-records-2026-09-29.json`);
db.close();
