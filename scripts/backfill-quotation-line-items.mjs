// scripts/backfill-quotation-line-items.mjs — backfills real quotation_items + header totals for
// the 2,221 header-only quotation shells already imported (scripts/import-quotations.mjs, tag
// import:quotation-register-2026-09-28). Source: scripts/data/quote-extract/quotations.jsonl —
// 2,728 real per-line quotations extracted directly from the live SalesMantra CRM's own rendered
// pages (id, customer, qno, qdate "DD-Mon-YYYY", items[], charges[], subtotal, grandTotal — see
// that file's own header comments in the session transcript for how it was derived; every number
// was cross-checked against the real rendered page before being trusted).
//
// Matching strategy — deliberately reuses the ALREADY-correct customer linkage from the header
// import rather than re-deriving customer matching: quotations.quotation_no is globally UNIQUE, and
// a revision chain's members are `<root_no>` (revision_no=0) and `<root_no>-R{n}` (revision_no=n,
// parent_quotation_id=root.id) — exactly lib/quotation-approval.mjs's revisionNumber() shape. For
// each extracted row: look up the root by exact quotation_no = qno; gather its full family (root +
// every child sharing parent_quotation_id = root.id); pick the family member whose quotation_date
// equals the extracted date. A family of one member with no date match is still used (trusts the
// qno match). Ambiguous (2+ members share the extracted date, or none do and the family has 2+
// members) or missing (qno not found at all) cases are never guessed — written to a review CSV.
//
// Real extracted duplicates (the same live CRM `id` list can contain more than one page for the
// same displayed quotation number + date — a genuine SalesMantra data artifact, not a bug in the
// extraction) are deduped by (qno, date) before matching: the richest one (most line items, ties
// broken by largest subtotal) is kept, the rest are recorded as duplicate_skipped_in_source.
//
// tax_amount is derived as `total - subtotal` (never re-split into CGST/SGST/IGST — this app has no
// reliable state-code history for these old customers/quotations, and guessing a split would
// misrepresent real GST history). tax_pct is set only when the source shows exactly one uniform
// applied rate. A line's own gst_pct/hsn_code are left NULL (not present in this source); product_id
// links via an exact sales_products.product_code match only (never fuzzy).
//
// Usage:
//   node --env-file=.env.local scripts/backfill-quotation-line-items.mjs            # dry run
//   node --env-file=.env.local scripts/backfill-quotation-line-items.mjs --apply
//   node --env-file=.env.local scripts/backfill-quotation-line-items.mjs --rollback
import fs from 'fs';
import path from 'path';
import { createClient } from '@libsql/client';
import { parseDate } from '../lib/quotation-register-import.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply'), ROLLBACK = args.includes('--rollback');
const MANIFEST = path.resolve('scripts/data/quotation-line-items-backfill-manifest.json');
const SOURCE = path.resolve('scripts/data/quote-extract/quotations.jsonl');

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql, a = []) => (await db.execute({ sql, args: a })).rows.map(r => ({ ...r }));
async function batch(stmts) { for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100), 'write'); }
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const normQno = s => String(s || '').trim().replace(/\s+/g, ' ');

if (ROLLBACK) {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  await batch([{ sql: `DELETE FROM quotation_items WHERE id IN (${m.insertedItemIds.map(() => '?').join(',')})`, args: m.insertedItemIds }]);
  await batch(m.touchedQuotations.map(t => ({
    sql: 'UPDATE quotations SET subtotal = ?, tax_pct = ?, tax_amount = ?, total = ? WHERE id = ?',
    args: [t.prevSubtotal, t.prevTaxPct, t.prevTaxAmount, t.prevTotal, t.id],
  })));
  console.log(`rolled back: ${m.insertedItemIds.length} quotation_items deleted, ${m.touchedQuotations.length} quotation headers restored.`);
  process.exit(0);
}

// --- load extracted source, drop blank-qno/error rows ---
const raw = fs.readFileSync(SOURCE, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
const noQno = raw.filter(r => !normQno(r.qno));
const withError = raw.filter(r => r.error);
const usable = raw.filter(r => !r.error && normQno(r.qno));

// --- dedupe by (qno, dateIso): keep the richest (most items, tie -> largest subtotal) ---
const groups = new Map();
for (const r of usable) {
  const dateIso = parseDate(r.qdate);
  const key = `${normQno(r.qno)}||${dateIso || r.qdate}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push({ ...r, dateIso });
}
let duplicatesInSource = 0;
const deduped = [];
for (const [, members] of groups) {
  if (members.length > 1) {
    members.sort((a, b) => (b.items.length - a.items.length) || (b.subtotal - a.subtotal) || (b.id - a.id));
    duplicatesInSource += members.length - 1;
  }
  deduped.push(members[0]);
}

// --- existing DB state ---
const allQuotations = await q('SELECT id, quotation_no, customer_id, quotation_date, parent_quotation_id, revision_no, subtotal, tax_pct, tax_amount, total FROM quotations');
const byNo = new Map(allQuotations.map(r => [normQno(r.quotation_no), r]));
const childrenByParent = new Map();
for (const r of allQuotations) {
  if (r.parent_quotation_id) {
    if (!childrenByParent.has(r.parent_quotation_id)) childrenByParent.set(r.parent_quotation_id, []);
    childrenByParent.get(r.parent_quotation_id).push(r);
  }
}
const itemCounts = await q('SELECT quotation_id, COUNT(*) n FROM quotation_items GROUP BY quotation_id');
const hasItems = new Set(itemCounts.map(r => r.quotation_id));
const products = await q('SELECT id, product_code FROM sales_products WHERE product_code IS NOT NULL');
const byCode = new Map(products.map(p => [String(p.product_code).trim().toUpperCase(), p.id]));

const notFound = [], ambiguous = [], alreadyHasItems = [], usedTargetIds = new Set();
const ready = []; // { target, extracted }

for (const r of deduped) {
  const root = byNo.get(normQno(r.qno));
  if (!root) { notFound.push(r); continue; }
  const family = [root, ...(childrenByParent.get(root.id) || [])];
  const dateMatches = family.filter(m => m.quotation_date === r.dateIso);
  const target = dateMatches.length === 1 ? dateMatches[0] : (family.length === 1 ? root : null);
  if (!target) { ambiguous.push({ r, family }); continue; }
  if (usedTargetIds.has(target.id)) { ambiguous.push({ r, family, reason: 'target already claimed by another extracted qno spelling' }); continue; }
  if (hasItems.has(target.id)) { alreadyHasItems.push({ r, target }); continue; }
  usedTargetIds.add(target.id);
  ready.push({ target, r });
}

// --- compute per-quotation totals + line inserts ---
let linesTotal = 0, linesLinkedToCatalog = 0;
const plan = ready.map(({ target, r }) => {
  const subtotal = round2(r.subtotal);
  const total = round2(r.grandTotal);
  const taxAmount = round2(total - subtotal);
  const gstCharges = (r.charges || []).filter(c => c.isGst && c.ratePct != null);
  const uniformRates = [...new Set(gstCharges.map(c => c.ratePct))];
  const taxPct = uniformRates.length === 1 ? uniformRates[0] : 0;
  const items = r.items.map((it, i) => {
    linesTotal++;
    const productId = it.pc ? byCode.get(String(it.pc).trim().toUpperCase()) || null : null;
    if (productId) linesLinkedToCatalog++;
    const uom = it.u && it.u !== '[Select Unit]' ? it.u : null;
    return {
      quotation_id: target.id,
      item_description: it.pn || '(no description)',
      hsn_code: null,
      qty: it.q ?? null,
      uom,
      rate: it.r ?? null,
      discount_pct: it.d || 0,
      gst_pct: null,
      product_id: productId,
      amount: it.amt ?? null,
      sort_order: i,
    };
  });
  return { targetId: target.id, subtotal, taxPct, taxAmount, total, prev: target, items };
});

console.log(JSON.stringify({
  sourceRowsRead: raw.length,
  droppedNoQno: noQno.length,
  droppedError: withError.length,
  usable: usable.length,
  distinctAfterDedupe: deduped.length,
  duplicatesInSource,
  matchedReady: ready.length,
  notFoundInDb: notFound.length,
  ambiguous: ambiguous.length,
  alreadyHasItems: alreadyHasItems.length,
  quotationLinesTotal: linesTotal,
  quotationLinesLinkedToCatalog: linesLinkedToCatalog,
  totalExtractedValue: round2(plan.reduce((a, p) => a + p.total, 0)),
}, null, 2));

// --- review CSV (never silently dropped) ---
const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
const reviewRows = [
  ...notFound.map(r => ({ kind: 'not_found_in_db', qno: r.qno, customer: r.customer, qdate: r.qdate, subtotal: r.subtotal, grandTotal: r.grandTotal, detail: '' })),
  ...ambiguous.map(({ r, family, reason }) => ({ kind: 'ambiguous', qno: r.qno, customer: r.customer, qdate: r.qdate, subtotal: r.subtotal, grandTotal: r.grandTotal, detail: reason || `family dates: ${family.map(f => `${f.id}:${f.quotation_date}`).join(' | ')}` })),
  ...alreadyHasItems.map(({ r, target }) => ({ kind: 'already_has_items', qno: r.qno, customer: r.customer, qdate: r.qdate, subtotal: r.subtotal, grandTotal: r.grandTotal, detail: `target quotation id ${target.id}` })),
  ...withError.map(r => ({ kind: 'source_had_error', qno: r.qno || '', customer: r.customer || '', qdate: r.qdate || '', subtotal: '', grandTotal: '', detail: r.error })),
];
fs.writeFileSync('docs/quotation-line-items-review.csv', ['kind,quotation number,customer,quotation date,subtotal,grand total,detail',
  ...reviewRows.map(x => [x.kind, x.qno, x.customer, x.qdate, x.subtotal, x.grandTotal, x.detail].map(csvCell).join(',')),
].join('\n') + '\n');

if (!APPLY) { console.log('\nDry run — review written to docs/quotation-line-items-review.csv. Pass --apply to write.'); process.exit(0); }

const insertedItemIds = [];
const touchedQuotations = [];
for (const p of plan) {
  touchedQuotations.push({ id: p.targetId, prevSubtotal: p.prev.subtotal, prevTaxPct: p.prev.tax_pct, prevTaxAmount: p.prev.tax_amount, prevTotal: p.prev.total });
}
await batch(plan.map(p => ({
  sql: 'UPDATE quotations SET subtotal = ?, tax_pct = ?, tax_amount = ?, total = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
  args: [p.subtotal, p.taxPct, p.taxAmount, p.total, p.targetId],
})));
const allItemInserts = plan.flatMap(p => p.items);
for (let i = 0; i < allItemInserts.length; i += 150) {
  const chunk = allItemInserts.slice(i, i + 150);
  const results = await db.batch(chunk.map(it => ({
    sql: `INSERT INTO quotation_items (quotation_id, item_description, hsn_code, qty, uom, rate, discount_pct, gst_pct, product_id, amount, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [it.quotation_id, it.item_description, it.hsn_code, it.qty, it.uom, it.rate, it.discount_pct, it.gst_pct, it.product_id, it.amount, it.sort_order],
  })), 'write');
  for (const r of results) insertedItemIds.push(Number(r.lastInsertRowid));
}

fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
fs.writeFileSync(MANIFEST, JSON.stringify({ insertedItemIds, touchedQuotations }, null, 2));
console.log(`\napplied: ${plan.length} quotation headers updated, ${insertedItemIds.length} quotation_items inserted. Manifest: ${MANIFEST}`);
db.close();
