// scripts/merge-exact-duplicate-customers.mjs — merges the SAFE subset of §4's "1,315 possible
// duplicate customers": groups whose name is IDENTICAL once you ignore case/spacing/punctuation
// (e.g. "LINK WELL TELESYSTEMS PVT LTD" == "LINKWELL TELESYSTEMS PVT LTD") — these are the same real
// company written slightly differently, not a genuine ambiguity. The much larger remainder of the
// 1,315 (shared first names like "Anil", or names that are only loosely similar) is deliberately NOT
// touched here — merging those without real evidence risks combining two different companies'
// order/payment/enquiry history into one record, which is exactly the kind of mistake this script
// exists to avoid making elsewhere.
//
// Canonical pick per group: the row with a real party_code wins (if exactly one has one); tie ->
// lowest id (oldest/most-established row). Every FK across every table that references
// customers.id is re-pointed to the canonical id before the duplicate row is deleted — nothing is
// silently orphaned. A duplicate's own portal_user_id (a live Customer Portal login) is preserved by
// moving it onto the canonical row if the canonical doesn't already have one of its own.
//
// Usage:
//   node --env-file=.env.local scripts/merge-exact-duplicate-customers.mjs            # dry run
//   node --env-file=.env.local scripts/merge-exact-duplicate-customers.mjs --apply
//   node --env-file=.env.local scripts/merge-exact-duplicate-customers.mjs --rollback
import fs from 'fs';
import path from 'path';
import { createClient } from '@libsql/client';

const APPLY = process.argv.includes('--apply'), ROLLBACK = process.argv.includes('--rollback');
const MANIFEST = path.resolve('scripts/data/merge-exact-duplicate-customers-manifest.json');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql, a = []) => (await db.execute({ sql, args: a })).rows.map(r => ({ ...r }));

// Every table with a real FK into customers.id, and the column name it uses.
const REF_TABLES = [
  ['opportunities', 'customer_id'], ['leads', 'converted_customer_id'], ['tasks', 'customer_id'],
  ['crm_notes', 'customer_id'], ['contacts', 'customer_id'], ['addresses', 'customer_id'],
  ['quotations', 'customer_id'], ['price_lists', 'customer_id'], ['sale_orders', 'customer_id'],
  ['projects', 'customer_id'], ['customer_competitors', 'customer_id'], ['sales_invoices', 'customer_id'],
];

if (ROLLBACK) {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const stmts = [];
  for (const g of m.groups) {
    // Re-insert the deleted duplicate row with its original id.
    for (const dup of g.deleted) {
      const cols = Object.keys(dup.row);
      stmts.push({ sql: `INSERT INTO customers (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, args: cols.map(c => dup.row[c]) });
    }
    // Undo every FK re-point.
    for (const [table, col] of REF_TABLES) {
      for (const move of g.moved[`${table}.${col}`] || []) {
        stmts.push({ sql: `UPDATE ${table} SET ${col} = ? WHERE id = ?`, args: [move.from, move.rowId] });
      }
    }
    if (g.portalMoved) stmts.push({ sql: 'UPDATE customers SET portal_user_id = NULL WHERE id = ?', args: [g.canonicalId] });
  }
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100), 'write');
  console.log(`rolled back ${m.groups.length} merges`);
  process.exit(0);
}

const customers = await q('SELECT id, name, party_code, portal_user_id FROM customers');
const byNorm = new Map();
for (const c of customers) {
  const norm = c.name.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!byNorm.has(norm)) byNorm.set(norm, []);
  byNorm.get(norm).push(c);
}
const groups = [...byNorm.values()].filter(g => g.length > 1);

const plan = groups.map(members => {
  const withCode = members.filter(m => m.party_code);
  const canonical = withCode.length === 1 ? withCode[0] : [...members].sort((a, b) => a.id - b.id)[0];
  const duplicates = members.filter(m => m.id !== canonical.id);
  return { canonical, duplicates };
});

console.log(`${plan.length} groups to merge, ${plan.reduce((a, p) => a + p.duplicates.length, 0)} duplicate rows to remove`);

if (!APPLY) {
  console.log('\nSample (first 8):');
  for (const p of plan.slice(0, 8)) {
    console.log(`  keep #${p.canonical.id} "${p.canonical.name}" (code=${p.canonical.party_code || 'none'})`);
    for (const d of p.duplicates) console.log(`    <- remove #${d.id} "${d.name}" (code=${d.party_code || 'none'}${d.portal_user_id ? ', HAS A PORTAL LOGIN' : ''})`);
  }
  console.log('\nDry run — pass --apply to write.');
  process.exit(0);
}

const manifestGroups = [];
for (const { canonical, duplicates } of plan) {
  const moved = {};
  for (const [table, col] of REF_TABLES) {
    for (const dup of duplicates) {
      const rows = await q(`SELECT id FROM ${table} WHERE ${col} = ?`, [dup.id]);
      if (!rows.length) continue;
      moved[`${table}.${col}`] = moved[`${table}.${col}`] || [];
      for (const r of rows) moved[`${table}.${col}`].push({ rowId: r.id, from: dup.id });
      await db.execute({ sql: `UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`, args: [canonical.id, dup.id] });
    }
  }
  let portalMoved = false;
  if (!canonical.portal_user_id) {
    const dupWithPortal = duplicates.find(d => d.portal_user_id);
    if (dupWithPortal) {
      await db.execute({ sql: 'UPDATE customers SET portal_user_id = ? WHERE id = ?', args: [dupWithPortal.portal_user_id, canonical.id] });
      portalMoved = true;
    }
  }
  const deleted = [];
  for (const dup of duplicates) {
    const [full] = await q('SELECT * FROM customers WHERE id = ?', [dup.id]);
    deleted.push({ row: full });
    await db.execute({ sql: 'DELETE FROM customers WHERE id = ?', args: [dup.id] });
  }
  manifestGroups.push({ canonicalId: canonical.id, moved, portalMoved, deleted });
}
fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
fs.writeFileSync(MANIFEST, JSON.stringify({ groups: manifestGroups }, null, 2));
console.log(`\napplied: ${plan.length} groups merged, ${plan.reduce((a, p) => a + p.duplicates.length, 0)} duplicate customer rows removed. Manifest: ${MANIFEST}`);
db.close();
