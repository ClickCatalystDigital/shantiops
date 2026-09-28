// scripts/import-quotations.mjs — one-off import of the old CRM's quotation register (2,733 rows
// across two exports — "Open" and "Sent to Customer" status, 2026-09-28) into quotations. Header
// only: no products/price/line items in the source, so every imported row is a shell (subtotal/
// tax/total = 0, zero quotation_items) — real quote-issuance history, not commercial figures.
//   node scripts/import-quotations.mjs <open.tsv> <sent.tsv>          # dry run: counts + review, writes nothing
//   node scripts/import-quotations.mjs <open.tsv> <sent.tsv> --apply [--limit N]
//   node scripts/import-quotations.mjs --rollback
// Rules (lib/quotation-register-import.mjs): test/junk customer rows, blank quotation numbers, and
// a quotation number reused across two different customers are all excluded — never guessed. A
// customer is linked only on an exact name match to exactly one existing customer; anything less
// certain goes to the review CSV. The same number reused by the SAME customer on different dates is
// a real revision chain (parent_quotation_id/revision_no, "<no>-R1", "-R2" ...), this app's own
// existing shape. company is set only when the SB/STF prefix is unambiguous, else left null.
import fs from 'fs';
import path from 'path';
import { createClient } from '@libsql/client';
import { parseTsv, classifyRows, buildQuotationGroups, matcher, companyFromQno } from '../lib/quotation-register-import.mjs';

const TAG = 'import:quotation-register-2026-09-28';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply'), ROLLBACK = args.includes('--rollback');
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const files = args.filter(a => !a.startsWith('--') && !/^\d+$/.test(a));
const MANIFEST = process.env.IMPORT_MANIFEST || path.resolve('scripts/data/quotation-register-import-manifest.json');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql, a = []) => (await db.execute({ sql, args: a })).rows.map(r => ({ ...r }));
async function retry(fn) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (err) { if (i >= 4) throw err; console.log(`  retry ${i}: ${err.message}`); await new Promise(res => setTimeout(res, 2000 * i)); }
  }
}

if (ROLLBACK) {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const [{ n }] = await q('SELECT COUNT(*) n FROM quotations WHERE import_tag = ?', [m.tag]);
  await db.batch([{ sql: 'DELETE FROM quotations WHERE import_tag = ?', args: [m.tag] }], 'write');
  console.log(`rolled back: ${n} quotations deleted (tag ${m.tag}).`);
  process.exit(0);
}

const [openFile, sentFile] = files;
const rows = [
  ...parseTsv(fs.readFileSync(openFile, 'utf8'), 'Open'),
  ...parseTsv(fs.readFileSync(sentFile, 'utf8'), 'Sent to Customer'),
].slice(0, LIMIT === Infinity ? undefined : LIMIT);

const { excluded, candidates } = classifyRows(rows);
const groups = buildQuotationGroups(candidates);

const customers = await q('SELECT id, name FROM customers');
const match = matcher(customers);

const linkedGroups = [], review = [];
for (const g of groups) {
  const m = match(g.customer);
  if (m.customer) linkedGroups.push({ ...g, customerId: m.customer.id });
  else review.push({ ...g, reason: m.reason, similar: m.similar || [] });
}

const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
fs.writeFileSync('docs/quotation-import-review.csv', ['kind,quotation number,customer as written,reason,possible customers (id: name),quotation date,rows in this group',
  ...review.map(g => ['no_customer_match', g.qno, g.customer, g.reason, g.similar.map(c => `${c.id}: ${c.name}`).join(' | '), g.revisions[0].dateIso, g.revisions.length].map(csvCell).join(',')),
  ...excluded.map(r => ['excluded_' + r.reason.replace(/[^a-z]+/gi, '_').toLowerCase().replace(/^_|_$/g, ''), r.qno || '', r.customer, r.reason, '', r.dateIso || '', 1].map(csvCell).join(',')),
].join('\n') + '\n');

const revisionRows = linkedGroups.reduce((n, g) => n + g.revisions.length, 0);
const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
const report = `# Old CRM quotation register — import notes (${now.slice(0, 10)})

Source: two exports of the old CRM's quotation register — ${rows.filter(r => r.status === 'Open').length}
rows at "Open" status, ${rows.filter(r => r.status === 'Sent to Customer').length} at "Sent to Customer".
No products, price, or line items exist in either export — every imported row is a header-only
quotation shell (subtotal/tax/total = 0, no quotation_items).

- ${rows.length} rows read.
- ${excluded.length} excluded outright (never guessed): test/junk customer names, blank quotation
  numbers, or a quotation number reused across two different customers (a real data error in the
  source — kept in \`docs/quotation-import-review.csv\` since it can't be resolved from the data).
- ${groups.length} distinct quotation numbers remain, covering **${revisionRows + review.reduce((n, g) => n + g.revisions.length, 0)} rows**.
- ${linkedGroups.length} matched exactly one existing customer and were imported as
  **${revisionRows} quotations** (${linkedGroups.filter(g => g.revisions.length > 1).length} of those
  are real revision chains — the same number reused by the same customer on different dates — linked
  via parent_quotation_id/revision_no, "<no>-R1", "-R2" ...).
- ${review.length} were **not** linked (name matched no customer, matched several, or only looked
  similar) — not imported. Listed in \`docs/quotation-import-review.csv\`.
- \`company\` was set from the quotation number's SB/STF prefix only when unambiguous; left blank
  (defaults to Shanti Boilers in the app) for typo'd/legacy-format numbers.
- Rollback: \`node scripts/import-quotations.mjs --rollback\`.
`;
fs.writeFileSync('docs/quotation-import-notes.md', report);

console.log(JSON.stringify({
  rowsRead: rows.length, excluded: excluded.length, distinctQuotationNumbers: groups.length,
  linkedGroups: linkedGroups.length, notLinkedGroups: review.length,
  quotationsToInsert: revisionRows, revisionChains: linkedGroups.filter(g => g.revisions.length > 1).length,
  apply: APPLY,
}, null, 1));

if (!APPLY) process.exit(0);
const [{ n }] = await q('SELECT COUNT(*) n FROM quotations WHERE import_tag = ?', [TAG]);
if (n && !args.includes('--resume')) { console.error('Already imported — run --rollback first (or --resume to finish an interrupted run).'); process.exit(1); }
if (!n) fs.writeFileSync(MANIFEST, JSON.stringify({ tag: TAG, at: now }));

const stmts = [];
for (const g of linkedGroups) {
  for (const r of g.revisions) {
    const sent = r.status === 'Sent to Customer';
    stmts.push({
      sql: `INSERT INTO quotations (quotation_no, customer_id, quotation_date, status, sent_at,
              company, parent_quotation_id, revision_no, created_by, created_at, updated_at, import_tag)
            SELECT ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM quotations WHERE quotation_no = ?)`,
      args: [r.no, g.customerId, r.dateIso, sent ? 'sent' : 'draft', sent ? `${r.dateIso} 00:00:00` : null,
        companyFromQno(r.qno), r.revisionNo, r.preparedBy || null, `${r.dateIso} 00:00:00`, now, TAG, r.no],
    });
  }
}
for (let i = 0; i < stmts.length; i += 100) {
  await retry(() => db.batch(stmts.slice(i, i + 100), 'write'));
  console.log(`  quotations ${Math.min(i + 100, stmts.length)}/${stmts.length}`);
}
// second pass: wire parent_quotation_id for revisions now that root rows have real ids
const idByNo = new Map((await q('SELECT id, quotation_no FROM quotations WHERE import_tag = ?', [TAG])).map(x => [x.quotation_no, Number(x.id)]));
const parentLinks = [];
for (const g of linkedGroups) {
  if (g.revisions.length < 2) continue;
  const rootId = idByNo.get(g.qno);
  for (const r of g.revisions.slice(1)) {
    const revId = idByNo.get(r.no);
    if (rootId && revId) parentLinks.push({ sql: 'UPDATE quotations SET parent_quotation_id = ? WHERE id = ?', args: [rootId, revId] });
  }
}
for (let i = 0; i < parentLinks.length; i += 100) await retry(() => db.batch(parentLinks.slice(i, i + 100), 'write'));

const [{ inserted }] = await q('SELECT COUNT(*) inserted FROM quotations WHERE import_tag = ?', [TAG]);
console.log(`applied: ${inserted} quotations (of ${stmts.length} attempted), ${parentLinks.length} revision links. Manifest: ${MANIFEST}`);
