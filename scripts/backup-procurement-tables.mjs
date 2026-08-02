// One-off safety backup before the Phase 0 demo-data reseed (PROCUREMENT-CHANGES.md §7) — dumps
// every table the reseed touches to a timestamped JSON file so the wipe is reversible if needed.
// Not part of the app; run manually with `node --env-file=.env.local scripts/backup-procurement-tables.mjs`.
const url = process.env.TURSO_URL.replace('libsql://', 'https://');
const token = process.env.TURSO_AUTH_TOKEN;

const TABLES = [
  'bom_items', 'bom_imports', 'suppliers', 'supplier_quotes',
  'purchase_orders', 'po_items', 'packing_items', 'tasks',
];

async function dump(table) {
  const r = await fetch(url + '/v2/pipeline', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql: `SELECT * FROM ${table}` } }, { type: 'close' }] }),
  });
  const d = await r.json();
  const res = d.results[0]?.response?.result;
  if (!res) { console.error(`  ${table}: FAILED`, JSON.stringify(d.results[0])); return { table, rows: [] }; }
  const rows = res.rows.map(row => Object.fromEntries(res.cols.map((c, i) => [c.name, row[i].value])));
  console.log(`  ${table}: ${rows.length} rows`);
  return { table, rows };
}

const out = {};
for (const t of TABLES) {
  const { rows } = await dump(t);
  out[t] = rows;
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const path = `/private/tmp/claude-501/-Users-pujan-Developer-shanti-ops/9283a9b5-bfbf-4335-86b1-66d13fa53624/scratchpad/db-backup/backup-${stamp}.json`;
await import('node:fs/promises').then(fs => fs.writeFile(path, JSON.stringify(out, null, 2)));
console.log('Backup written to', path);
