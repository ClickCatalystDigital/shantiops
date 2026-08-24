// One-off schema migration for BOM line <-> Item Master linking (see
// /Users/pujan/.claude/plans/build-a-system-suggests-sleepy-matsumoto.md). vendor_bill_items has no
// indexes at all today; the new link-item endpoint's history guard queries it by bom_item_id on
// every write, so add the missing index while touching this exact query path. Re-runnable
// (CREATE INDEX IF NOT EXISTS), applied directly against the live Turso DB, same idiom as
// scripts/migrate-tc-match.mjs.
//
// Run: node --env-file=.env.local scripts/migrate-bom-item-link.mjs
import { createClient } from '@libsql/client';
const client = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

await client.execute('CREATE INDEX IF NOT EXISTS idx_vendor_bill_items_bom_item_id ON vendor_bill_items(bom_item_id)');
console.log('OK: idx_vendor_bill_items_bom_item_id');
