// scripts/advance-status-selfcheck.mjs — runnable check for Phase 5.1's advancePurchaseStatus
// (V2-CHANGES.md, purchase_status now written forward by real actions instead of only inferred).
// Same precedent as scripts/backfill-5.0-selfcheck.mjs: no JS test framework in this repo, an
// in-memory libsql DB with synthetic fixtures. The rank table + comparison logic below is a
// deliberate copy of lib/procurement.js's advancePurchaseStatus — that file uses ESM `import`
// syntax as a plain .js (only ever run through Next's bundler, same reason lib/bom-fields.mjs is
// a .mjs "so plain node can load it"), so a self-check can't import it directly; keep the two in
// lockstep by hand, same as this repo's other pre-.mjs write-side helpers.
//   node scripts/advance-status-selfcheck.mjs
import assert from 'node:assert';
import { createClient } from '@libsql/client';

const db = createClient({ url: ':memory:' });
async function run(sql, args = []) { return db.execute({ sql, args }); }

await run(`CREATE TABLE bom_items (id INTEGER PRIMARY KEY, purchase_status TEXT)`);
await run(`INSERT INTO bom_items (id, purchase_status) VALUES (1, NULL)`);

const STATUS_RANK = { Enquiry: 0, Comparison: 1, Ordered: 2, Transit: 3, Received: 4 };

async function advancePurchaseStatus(id, target) {
  const targetRank = STATUS_RANK[target];
  if (targetRank == null) return;
  const { rows } = await run('SELECT purchase_status FROM bom_items WHERE id = ?', [id]);
  const current = rows[0].purchase_status;
  const currentRank = STATUS_RANK[current];
  if (current != null && currentRank == null) return; // Cancelled/In-Stock/unrecognized — never touch
  if (currentRank != null && currentRank >= targetRank) return;
  await run('UPDATE bom_items SET purchase_status = ? WHERE id = ?', [target, id]);
}
async function getStatus() {
  const { rows } = await run('SELECT purchase_status FROM bom_items WHERE id = 1');
  return rows[0].purchase_status;
}
async function setStatus(status) { await run('UPDATE bom_items SET purchase_status = ? WHERE id = 1', [status]); }

// Forward moves happen.
await advancePurchaseStatus(1, 'Comparison');
assert.strictEqual(await getStatus(), 'Comparison', 'null -> Comparison should advance');

await advancePurchaseStatus(1, 'Ordered');
assert.strictEqual(await getStatus(), 'Ordered', 'Comparison -> Ordered should advance');

// Never regresses.
await advancePurchaseStatus(1, 'Comparison');
assert.strictEqual(await getStatus(), 'Ordered', 'Ordered should not regress to Comparison');

await advancePurchaseStatus(1, 'Enquiry');
assert.strictEqual(await getStatus(), 'Ordered', 'Ordered should not regress to Enquiry');

// Same-rank is a no-op, not an error.
await advancePurchaseStatus(1, 'Ordered');
assert.strictEqual(await getStatus(), 'Ordered', 'same-rank call should be a no-op');

// Never touches Cancelled/In-Stock (not in the rank table) — as the current status...
await setStatus('Cancelled');
await advancePurchaseStatus(1, 'Comparison');
assert.strictEqual(await getStatus(), 'Cancelled', 'Cancelled must never be overwritten by advancePurchaseStatus');

await setStatus('In-Stock');
await advancePurchaseStatus(1, 'Ordered');
assert.strictEqual(await getStatus(), 'In-Stock', 'In-Stock must never be overwritten by advancePurchaseStatus');

// ...or as the requested target.
await setStatus('Enquiry');
await advancePurchaseStatus(1, 'Cancelled');
assert.strictEqual(await getStatus(), 'Enquiry', 'advancePurchaseStatus should never write Cancelled/In-Stock as a target');

console.log('advance-status-selfcheck: all assertions passed');
