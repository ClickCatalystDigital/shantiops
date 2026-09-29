// scripts/normalize-sales-values.mjs — tidies stored values left by the imports (dry run by default).
//   node --env-file=.env.local scripts/normalize-sales-values.mjs [--apply | --rollback]
// State spellings -> the standard list; phones written "91-9876543210" -> 10 digits; "a@x.com,b@x.com" -> first
// email (the second is kept in the manifest); follow-up "plan for" names -> the user's username.
// Changes only values that differ, and only rows where the value still is what was read (safe to re-run).
import fs from 'fs';
import path from 'path';
import { createClient } from '@libsql/client';
import { canonicalState, emailsOf } from '../lib/sales-links.mjs';
import { normPhone } from '../lib/sales-call-details-import.mjs';
import { personKey } from '../lib/sales-people.mjs';

const APPLY = process.argv.includes('--apply'), ROLLBACK = process.argv.includes('--rollback');
const MANIFEST = path.resolve('scripts/data/normalize-sales-values-manifest.json');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql, a = []) => (await db.execute({ sql, args: a })).rows.map(r => ({ ...r }));
const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const run = async st => { for (const p of chunks(st, 150)) await db.batch(p, 'write'); };

if (ROLLBACK) {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  await run(m.changes.map(c => ({ sql: `UPDATE ${c.table} SET ${c.col} = ? WHERE id = ? AND ${c.col} IS ?`, args: [c.before, c.id, c.after] })));
  console.log(`rolled back ${m.changes.length} values`); process.exit(0);
}

const changes = [];
const add = (table, col, id, before, after) => { if (after != null && after !== before) changes.push({ table, col, id, before, after }); };
for (const [table, col] of [['leads', 'territory'], ['customers', 'state']])
  for (const r of await q(`SELECT id, ${col} v FROM ${table} WHERE ${col} IS NOT NULL AND ${col} != ''`)) add(table, col, r.id, r.v, canonicalState(r.v));
for (const r of await q(`SELECT id, phone v FROM leads WHERE phone IS NOT NULL AND phone != '' AND phone GLOB '*[^0-9]*'`))
  if (/^[\d\s+\-]+$/.test(r.v)) { const d = normPhone(r.v); if (d.length === 10) add('leads', 'phone', r.id, r.v, d); }
for (const r of await q(`SELECT id, email v FROM leads WHERE email LIKE '% %' OR email LIKE '%,%'`)) add('leads', 'email', r.id, r.v, emailsOf(r.v)[0]);
const users = await q('SELECT username, display_name FROM users');
for (const r of await q(`SELECT id, plan_for v FROM crm_notes WHERE plan_for IS NOT NULL AND plan_for != '' AND plan_for NOT IN (SELECT username FROM users)`)) {
  const k = personKey(r.v, users); if (users.some(u => u.username === k)) add('crm_notes', 'plan_for', r.id, r.v, k);
}
const by = {}; for (const c of changes) by[`${c.table}.${c.col}`] = (by[`${c.table}.${c.col}`] || 0) + 1;
console.log(JSON.stringify({ changes: changes.length, by }, null, 1));
if (!APPLY) { console.log('Dry run — pass --apply.'); process.exit(0); }
fs.writeFileSync(MANIFEST, JSON.stringify({ at: new Date().toISOString(), changes }));
await run(changes.map(c => ({ sql: `UPDATE ${c.table} SET ${c.col} = ? WHERE id = ? AND ${c.col} IS ?`, args: [c.after, c.id, c.before] })));
console.log('applied. Manifest:', MANIFEST);
