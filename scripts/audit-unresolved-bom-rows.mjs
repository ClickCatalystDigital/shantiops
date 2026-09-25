// Full audit of every currently-unresolved bom_items row (source='bom', item_id IS NULL) across the
// real STF-IBR-0xx projects — read-only, no writes. For each DISTINCT case (memoryKeys()' own
// alias/moc/size grouping — the real granularity the app matches at), runs the exact production
// pipeline in the exact production order:
//   1. classifyConfigRow()          — is this genuinely a spec/datasheet row, not a purchasable item?
//   2. exact catalog name match
//   3. inferCategory() (regex)      — the tier backfill-project-item-links.mjs was missing until today
//   4. suggestCategoryFromGroups()  — fuzzy group fallback
//   5. category_word_corrections    — learned corrections
//   6. matchLine()                  — memory / family / attribute / suggest tiers
// Buckets every case into CONFIG / AUTO (confident match) / SUGGEST (candidates, not confident) /
// NONE (nothing at all) and prints full detail for anything not CONFIG/AUTO, so every remaining case
// can be judged by hand.
//
// Usage: node --env-file=.env.local scripts/audit-unresolved-bom-rows.mjs [--json out.json]
import { createClient } from '@libsql/client';
import { writeFileSync } from 'node:fs';
import { classifyConfigRow } from '../lib/bom-config.mjs';
import { suggestCategoryFromGroups, suggestSpellingCorrection, inferCategory } from '../lib/section-shapes.js';
import { buildCatalogIndex, matchLine, memoryFromRows } from '../lib/item-match.mjs';
import { memoryKeys } from '../lib/item-attributes.mjs';
import { normalizeWords } from '../lib/match-utils.js';

const jsonOut = (() => { const i = process.argv.indexOf('--json'); return i >= 0 ? process.argv[i + 1] : null; })();
const PROJECTS = [248, 249, 250, 281, 282, 283];

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const catalog = (await db.execute('SELECT id, item_name, bom_category, uom FROM items')).rows;
const catalogByName = new Map(catalog.map(c => [c.item_name.trim().toLowerCase().replace(/\s+/g, ' '), c]));
const groupRows = (await db.execute(
  `SELECT group_name, bom_category FROM items WHERE group_name IS NOT NULL AND group_name != '' AND bom_category IS NOT NULL
   GROUP BY group_name HAVING COUNT(DISTINCT bom_category) = 1`)).rows;
const groups = groupRows.map(g => ({ name: g.group_name, category: g.bom_category }));
const corrections = (await db.execute('SELECT word, category FROM category_word_corrections')).rows;
const correctionMap = new Map(corrections.map(c => [c.word.toUpperCase(), c.category]));
const memoryRows = (await db.execute('SELECT kind, alias_key, moc_key, size_key, item_id, approvals, rejections FROM item_link_memory')).rows;
const index = buildCatalogIndex(catalog.map(r => ({ ...r })));
const memory = memoryFromRows(memoryRows.map(r => ({ ...r })));

const rows = (await db.execute({
  sql: `SELECT project_id, id, material_description, moc, size_spec, category, qty_text, pr_ref, po_ref, grn_ref,
        grn_qty_text, pending_qty_text, bqtc_ref, issued_ref, received_ref, remarks, make
        FROM bom_items WHERE project_id IN (${PROJECTS.join(',')}) AND source = 'bom' AND item_id IS NULL
        ORDER BY project_id, material_description`,
})).rows;

// history guard, batched — any of these bom_item ids referenced by vendor_bill_items/material_issues
const ids = rows.map(r => r.id);
const chunks = [];
for (let i = 0; i < ids.length; i += 400) chunks.push(ids.slice(i, i + 400));
const historyIds = new Set();
for (const c of chunks) {
  if (!c.length) continue;
  const ph = c.map(() => '?').join(',');
  for (const t of ['vendor_bill_items', 'material_issues']) {
    const r = (await db.execute({ sql: `SELECT DISTINCT bom_item_id FROM ${t} WHERE bom_item_id IN (${ph})`, args: c })).rows;
    for (const x of r) historyIds.add(x.bom_item_id);
  }
}

function caseKey(r) {
  const k = memoryKeys({ material_description: r.material_description, moc: r.moc, size_spec: r.size_spec });
  return k.exactKey;
}

const cases = new Map();
for (const r of rows) {
  const k = caseKey(r);
  if (!cases.has(k)) cases.set(k, []);
  cases.get(k).push(r);
}

const buckets = { config: [], auto: [], suggest: [], none: [] };
const CONFIDENT = new Set(['memory', 'family', 'attribute']);

for (const [key, group] of cases) {
  const rep = group[0]; // representative row — all rows in a case share desc/moc/size by construction
  const projects = [...new Set(group.map(g => g.project_id))];
  const withHistory = group.filter(g => historyIds.has(g.id)).map(g => g.id);

  // 1. config?
  const cfg = classifyConfigRow(rep);
  if (cfg) {
    buckets.config.push({ key, group, cfg });
    continue;
  }

  // 2. exact catalog name
  const nameMatch = catalogByName.get(String(rep.material_description || '').trim().toLowerCase().replace(/\s+/g, ' '));
  if (nameMatch) {
    buckets.auto.push({ key, group, level: 'name', itemId: nameMatch.id, itemName: nameMatch.item_name, reason: 'exact catalog name match', withHistory });
    continue;
  }

  // 3-5. category tiers
  let category = rep.category || null;
  if (!category) category = inferCategory(rep.material_description, rep.size_spec);
  if (!category) category = suggestCategoryFromGroups(rep.material_description, groups);
  if (!category) {
    for (const w of normalizeWords(rep.material_description || '')) {
      const hit = correctionMap.get(w.toUpperCase());
      if (hit) { category = hit; break; }
    }
  }
  const spellSuggestion = !category ? suggestSpellingCorrection(rep.material_description) : null;

  // 6. matchLine
  const m = matchLine({ ...rep, category }, index, memory);
  if (CONFIDENT.has(m.level) && m.itemId) {
    buckets.auto.push({ key, group, level: m.level, itemId: m.itemId, itemName: index.byId.get(m.itemId)?.item_name, reason: m.reason, category, withHistory });
  } else if (m.level === 'suggest' && m.candidates?.length) {
    buckets.suggest.push({ key, group, category, candidates: m.candidates, reason: m.reason, spellSuggestion, withHistory });
  } else {
    buckets.none.push({ key, group, category, spellSuggestion, withHistory });
  }
}

function rowCount(b) { return b.reduce((a, x) => a + x.group.length, 0); }
console.log(`\n=== Cases: ${cases.size} distinct, ${rows.length} raw rows ===`);
console.log(`CONFIG:  ${buckets.config.length} cases / ${rowCount(buckets.config)} rows`);
console.log(`AUTO:    ${buckets.auto.length} cases / ${rowCount(buckets.auto)} rows`);
console.log(`SUGGEST: ${buckets.suggest.length} cases / ${rowCount(buckets.suggest)} rows`);
console.log(`NONE:    ${buckets.none.length} cases / ${rowCount(buckets.none)} rows`);
if (historyIds.size) console.log(`\n${historyIds.size} row(s) across all cases have vendor-bill/material-issue history.`);

function printCase(c, tag) {
  const r = c.group[0];
  console.log(`  [${tag}] "${r.material_description}" | moc="${r.moc}" | size="${String(r.size_spec || '').replace(/\s+/g, ' ').slice(0, 90)}"`);
  console.log(`        rows: ${c.group.length} (projects ${[...new Set(c.group.map(g => g.project_id))].join(',')}, ids ${c.group.map(g => g.id).join(',')})`);
}

console.log('\n--- SUGGEST cases ---');
for (const c of buckets.suggest) {
  printCase(c, 'SUGGEST');
  console.log(`        category=${c.category || 'null'} candidates: ${c.candidates.map(x => `${x.id}:${x.name}`).join(' | ')}`);
  if (c.withHistory.length) console.log(`        HAS HISTORY: ids ${c.withHistory.join(',')}`);
}

console.log('\n--- NONE cases ---');
for (const c of buckets.none) {
  printCase(c, 'NONE');
  console.log(`        category=${c.category || 'null'}${c.spellSuggestion ? ` spellSuggestion=${JSON.stringify(c.spellSuggestion)}` : ''}`);
  if (c.withHistory.length) console.log(`        HAS HISTORY: ids ${c.withHistory.join(',')}`);
}

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ buckets, historyIdsCount: historyIds.size }, (k, v) => v, 2));
  console.log(`\nWritten: ${jsonOut}`);
}
