// Backup/restore for the Item Master standardization pass (SYSTEM.md's Item Master sections).
// There's no staging DB for this project — every one-time backfill in this app (including this
// pass) writes directly to the one shared live Turso instance. This is the safety net: a full
// snapshot before the first real --apply, and a tested, concrete way back if anything looks wrong.
//
// Restore is per-row-by-id (UPDATE every backed-up column back to its snapshot value) — never a
// delete-then-reinsert. A delete-based restore would remove anything created through the app
// between the backup and a real rollback, and `items` never gets a row deleted for any reason in
// this pass (see scripts/generate-item-master-sizes.mjs's own header comment). "Rollback" here
// means "undo the corrections to existing rows," not "undo new rows" — a row this pass generates
// is never removed by this script, by design.
//
// Usage:
//   node --env-file=.env.local scripts/restore-items-backup.mjs --backup items-backup-<ts>.json
//   node --env-file=.env.local scripts/restore-items-backup.mjs --restore items-backup-<ts>.json
//
// Before Phase 1 of the standardization pass starts, prove the round-trip is a no-op:
//   node --env-file=.env.local scripts/restore-items-backup.mjs --backup a.json
//   node --env-file=.env.local scripts/restore-items-backup.mjs --restore a.json
//   node --env-file=.env.local scripts/restore-items-backup.mjs --backup b.json
//   diff a.json b.json   # must be empty
import { createClient } from '@libsql/client';
import { readFileSync, writeFileSync } from 'node:fs';

const mode = process.argv[2];
const file = process.argv[3];
if (!['--backup', '--restore'].includes(mode) || !file) {
  console.error('Usage: node --env-file=.env.local scripts/restore-items-backup.mjs --backup|--restore <file>');
  process.exit(1);
}

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

if (mode === '--backup') {
  const rows = (await db.execute('SELECT * FROM items ORDER BY id')).rows.map(r => ({ ...r }));
  writeFileSync(file, JSON.stringify(rows, null, 1));
  console.log(`Backed up ${rows.length} row(s) from items -> ${file}`);
  process.exit(0);
}

// --restore
const rows = JSON.parse(readFileSync(file, 'utf8'));
if (!Array.isArray(rows) || !rows.length) {
  console.error('Backup file is empty or not an array — refusing to restore.');
  process.exit(1);
}
const columns = Object.keys(rows[0]).filter(c => c !== 'id');
const setClause = columns.map(c => `${c} = ?`).join(', ');

let restored = 0;
for (const row of rows) {
  const { rowsAffected } = await db.execute({
    sql: `UPDATE items SET ${setClause} WHERE id = ?`,
    args: [...columns.map(c => row[c]), row.id],
  });
  restored += rowsAffected;
}
console.log(`Restored ${restored} of ${rows.length} row(s) from ${file} (a row missing today — none expected, since this pass never deletes — would show as 0 affected for its id).`);
