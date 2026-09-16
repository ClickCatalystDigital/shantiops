// scripts/material-indent-routing-gate-selfcheck.mjs — Material Indent routing-bypass fix
// (POST /api/material-indents). Hand-mirror of the exact server-side guard added to that route:
// a bom_item_id line is only acceptable if SOME row in bom_item_child_routing names it
// routed_to='production' — covering both an ordinary/sibling project's own self-routing
// (child_project_id = the item's own project_id, the only value it can take there) and a
// split-master's per-child routing (several rows per bom_item_id, only some of which may be
// routed to Production). Same in-memory-libsql precedent as inventory-reservations-selfcheck.mjs —
// app/api/material-indents/route.js is only loadable through Next's bundler.
//   node scripts/material-indent-routing-gate-selfcheck.mjs
import assert from 'node:assert';
import { createClient } from '@libsql/client';

const db = createClient({ url: ':memory:' });
async function run(sql, args = []) { return db.execute({ sql, args }); }

await run(`CREATE TABLE bom_items (id INTEGER PRIMARY KEY, material_description TEXT)`);
await run(`CREATE TABLE bom_item_child_routing (
  bom_item_id INTEGER, child_project_id INTEGER, routed_to TEXT,
  PRIMARY KEY (bom_item_id, child_project_id)
)`);

// Exact hand-mirror of the guard added to app/api/material-indents/route.js's POST handler.
async function isRoutedToProduction(bomItemId) {
  const { rows } = await run(
    "SELECT 1 FROM bom_item_child_routing WHERE bom_item_id = ? AND routed_to = 'production'",
    [bomItemId]);
  return rows.length > 0;
}

await run(`INSERT INTO bom_items (id, material_description) VALUES
  (1, 'ORDINARY ROUTED TO PRODUCTION'), (2, 'ORDINARY ROUTED TO DISPATCH'),
  (3, 'NEVER ROUTED'), (4, 'SPLIT MASTER MIXED ROUTING')`);

// --- Case 1: ordinary/sibling project, self-routed to Production — accepted. ---
await run(`INSERT INTO bom_item_child_routing (bom_item_id, child_project_id, routed_to) VALUES (1, 100, 'production')`);
assert.strictEqual(await isRoutedToProduction(1), true, 'a self-routed-to-Production line is accepted');

// --- Case 2: ordinary/sibling project, self-routed to Dispatch — rejected. This is the confirmed
// gap: before this fix, POST /api/material-indents accepted this line unconditionally. ---
await run(`INSERT INTO bom_item_child_routing (bom_item_id, child_project_id, routed_to) VALUES (2, 100, 'dispatch')`);
assert.strictEqual(await isRoutedToProduction(2), false, 'a line routed to Dispatch must be rejected for indent creation');

// --- Case 3: never routed at all — rejected. The other half of the confirmed gap (ProductionBomTab
// could previously indent any Received line regardless of whether Stores had routed it yet). ---
assert.strictEqual(await isRoutedToProduction(3), false, 'an unrouted line must be rejected');

// --- Case 4: split-master, several children — some routed to Production, some to Dispatch. Must
// accept (material_indent_items has no per-child column, so "any cell routed to Production" is the
// correct, documented-limitation-respecting check, not a false rejection of the whole line). ---
await run(`INSERT INTO bom_item_child_routing (bom_item_id, child_project_id, routed_to) VALUES (4, 201, 'dispatch')`);
await run(`INSERT INTO bom_item_child_routing (bom_item_id, child_project_id, routed_to) VALUES (4, 202, 'production')`);
assert.strictEqual(await isRoutedToProduction(4), true, 'a split-master line with at least one child routed to Production is accepted');

// --- Case 5: split-master, every child routed to Dispatch only — rejected. ---
await run(`INSERT INTO bom_items (id, material_description) VALUES (5, 'SPLIT MASTER ALL DISPATCH')`);
await run(`INSERT INTO bom_item_child_routing (bom_item_id, child_project_id, routed_to) VALUES (5, 301, 'dispatch')`);
await run(`INSERT INTO bom_item_child_routing (bom_item_id, child_project_id, routed_to) VALUES (5, 302, 'dispatch')`);
assert.strictEqual(await isRoutedToProduction(5), false, 'a split-master line with no child routed to Production must be rejected');

console.log('material-indent-routing-gate-selfcheck: all assertions passed');
