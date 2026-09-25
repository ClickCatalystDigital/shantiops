// Item Master fix — the pre-existing "MS PLATE" (singular, 2 rows) vs "MS PLATES" (plural, 20 rows)
// naming split (flagged, not touched, in the original Item Master standardization plan) was found to
// be actively harming matching confidence: stemOf() strips size but not a trailing "s", so the two
// spellings compute DIFFERENT stems ("ms plate" vs "ms plates"). Real production family-memory data
// (item_link_memory, populated by real human use) confirmed the damage directly: alias="plate",
// moc="ms" has two competing family entries — one per stem — each repeatedly rejected by the other
// whenever a human picks the opposite spelling, both stuck below the 0.6 trust threshold
// (0.37 / 0.38) despite real, correct human confirmations on both sides.
//
// Fix: rename the 2 singular rows to match the dominant plural convention. Checked first: neither
// target name already exists (no collision). This does not touch any existing exact-tier memory row
// referencing these ids (exact matching is by item_id, not by name/stem) — only future stem
// computation is affected, unifying all 22 rows under one stem going forward.
//
// Usage: node --env-file=.env.local scripts/fix-ms-plate-stem-split.mjs [--apply]
import { createClient } from '@libsql/client';
const apply = process.argv.includes('--apply');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const RENAMES = [
  { id: 2034, from: 'MS PLATE 5 MM', to: 'MS PLATES 5 MM' },
  { id: 2048, from: 'MS PLATE 32 MM', to: 'MS PLATES 32 MM' },
];

console.log(apply ? '=== Applying ===\n' : '=== DRY RUN (nothing written) ===\n');
for (const r of RENAMES) {
  const existing = (await db.execute({ sql: 'SELECT id FROM items WHERE item_name = ?', args: [r.to] })).rows;
  if (existing.length) { console.log(`  SKIP id ${r.id} -> "${r.to}" — a row with that name already exists (id ${existing[0].id})`); continue; }
  const real = (await db.execute({ sql: 'SELECT item_name FROM items WHERE id = ?', args: [r.id] })).rows[0];
  if (!real || real.item_name !== r.from) { console.log(`  SKIP id ${r.id} — expected "${r.from}", found ${JSON.stringify(real)}`); continue; }
  console.log(`  RENAME id ${r.id}: "${r.from}" -> "${r.to}"`);
  if (apply) await db.execute({ sql: 'UPDATE items SET item_name = ? WHERE id = ?', args: [r.to, r.id] });
}
if (apply) {
  await db.execute({
    sql: 'INSERT INTO usb_audit (request_id, machine_id, actor, action, detail) VALUES (NULL, NULL, ?, ?, ?)',
    args: ['script:item-master-standardize', 'item_master_rename', JSON.stringify({ renames: RENAMES, reason: 'unify MS PLATE/PLATES stem split, PMB harvest round' })],
  });
  console.log('\nApplied.');
}
