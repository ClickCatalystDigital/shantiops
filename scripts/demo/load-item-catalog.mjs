// Public demo: the items workbench's catalogue in the Item Master, with the catalogue code in Part No, which the BOM
// node's 3D view uses to find the item's model (public/models/<in|us>/index.json, made by ../items/sbops_export.py).
// Dry run unless --apply. Never deletes; only fills an empty Part No.
//   India: adds the catalogue's items not already there (item code IM-<id>, like the Item Master screen) and links the
//          seeded starter items to the closest workbench model.
//     TURSO_URL=... TURSO_AUTH_TOKEN=... node scripts/demo/load-item-catalog.mjs ../items/exports/sbops/IN/catalog.json [--apply]
//   US: the items are already there (seed-acme-us.mjs from scripts/demo/us-items.json); links them by name.
//     TURSO_URL=... TURSO_AUTH_TOKEN=... node scripts/demo/load-item-catalog.mjs --us scripts/demo/us-items.json [--apply]
import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { DENY, DENY_WORDS } from './deny-list.mjs';

const apply = process.argv.includes('--apply');
const us = process.argv.includes('--us');
const file = process.argv.filter(a => !a.startsWith('--'))[2];
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN || undefined, intMode: 'number' });
if (!(await db.execute("SELECT 1 FROM sqlite_master WHERE name = 'demo_meta'")).rows.length) throw new Error('Not a demo database');
const run = async stmts => { for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100), 'write'); };

if (us) {
  const rows = JSON.parse(readFileSync(file, 'utf8'));
  const stmts = rows.map(r => ({ sql: "UPDATE items SET part_no = ? WHERE UPPER(item_name) = ? AND COALESCE(part_no, '') = ''",
    args: [`AHROM-US-${r.code.slice(3)}`, r.name] }));
  console.log(`${stmts.length} US items to link by name`);
  if (apply) { await run(stmts); console.log('linked'); }
  process.exit(0);
}

const { items } = JSON.parse(readFileSync(file, 'utf8'));
const category = it => {
  const f = `${it.family} ${it.name}`.toLowerCase();
  if (/plate|sheet/.test(f) && !/flange/.test(f)) return 'plate';
  if (/fin flat|^flat|\bflat\b/.test(f)) return 'flat';
  if (/\bround\b|\bbar\b/.test(f) && !/fin/.test(f)) return 'round';
  if (/^pipe_straight|^pipe |^tube|seamless .*pipe|\btube\b/.test(f) && !/elbow|tee|spool|stack|standpipe/.test(f)) return 'pipe';
  return 'standard';
};
// The seeded starter items, each pointed at the closest workbench model (valves have none: the app draws them).
const STARTERS = { 'MS PIPE 50 NB CLASS B': 'AHROM-IN-PIP-CS-50NB-SCH80-IBR', 'WATER LEVEL GAUGE': 'AHROM-IN-MNT-WATER-COLUMN-ASSY-100NB-IBR' };
const have = new Set((await db.execute("SELECT part_no FROM items WHERE COALESCE(part_no, '') != ''")).rows.map(r => r.part_no));
const deny = new RegExp([...DENY, ...DENY_WORDS].map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
const fresh = items.filter(it => !have.has(it.code));
const bad = fresh.filter(it => deny.test(JSON.stringify(it)));
if (bad.length) throw new Error(`Deny-list hit: ${bad.map(b => b.code).join(', ')}`);
console.log(`${fresh.length} new of ${items.length} (${items.length - fresh.length} already there)`);
if (!apply) { for (const it of fresh.slice(0, 8)) console.log(' ', it.code, '|', category(it), '|', it.name); process.exit(0); }
await run(fresh.map(it => ({
  sql: `INSERT INTO items (part_no, item_name, detail_desc, group_name, uom, hsn_code, material_process_type, item_type, bom_category, default_moc)
        VALUES (?, ?, ?, ?, ?, ?, 'Procured', 'Purchase', ?, ?)`,
  args: [it.code, it.name.slice(0, 200), it.standard || null, it.family || null, it.uom || null, it.hsn || null, category(it), it.moc || null],
})));
await run([
  { sql: "UPDATE items SET item_code = 'IM-' || printf('%06d', id) WHERE item_code IS NULL AND part_no IS NOT NULL", args: [] },
  ...Object.entries(STARTERS).map(([name, code]) => ({ sql: "UPDATE items SET part_no = ? WHERE item_name = ? AND COALESCE(part_no, '') = ''", args: [code, name] })),
]);
console.log(`added ${fresh.length}, linked the starter items`);
