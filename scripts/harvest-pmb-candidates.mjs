// Harvest genuine Item Master candidates from real PMB Excel files — read-only, no writes, no
// project/bom_items touched at all. Replicates the exact same pipeline
// app/api/projects/[id]/bom/import/route.js already uses (parsePmb -> exact-name match -> regex
// category -> fuzzy group match -> learned corrections -> spelling suggestion -> Item Master
// memory/family/attribute matching), so a candidate reported here is genuinely not already
// resolvable by the real app, not an artifact of a simpler/weaker check.
//
// Configuration rows (datasheet fields like FLOW/SET PRESSURE/OPERATING TEMP) are excluded at the
// source: parsePmb() already separates every sheet into `items` and `configs` via
// lib/bom-config.mjs's classifyConfigRow() — this script only ever reads `sheet.items`, `configs`
// is counted (to prove the exclusion) and otherwise ignored entirely.
//
// Usage: node --env-file=.env.local scripts/harvest-pmb-candidates.mjs <file1.xlsx> [file2.xlsx ...]
import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parsePmb } from '../lib/pmb.mjs';
import { suggestCategoryFromGroups, suggestSpellingCorrection } from '../lib/section-shapes.js';
import { buildCatalogIndex, matchLine, memoryFromRows } from '../lib/item-match.mjs';
import { normalizeWords, normalizeMaterial } from '../lib/match-utils.js';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node --env-file=.env.local scripts/harvest-pmb-candidates.mjs <file1.xlsx> [file2.xlsx ...]');
  process.exit(1);
}

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

// --- 1. Parse every file, keep items[] only, tag each with its source ---
const allItems = [];
let totalConfigsExcluded = 0, totalItemsSeen = 0, totalSkipped = 0;
console.log('=== Parsing ===');
for (const file of files) {
  const buffer = readFileSync(file);
  const parsed = parsePmb(buffer);
  if (parsed.error) { console.log(`  ${basename(file)}: PARSE ERROR — ${parsed.error}`); continue; }
  let fileItems = 0, fileConfigs = 0, fileSkipped = 0;
  for (const sheet of parsed.sheets) {
    for (const it of sheet.items) allItems.push({ ...it, _file: basename(file), _sheet: sheet.name });
    fileItems += sheet.items.length;
    fileConfigs += sheet.configs?.length || 0;
    fileSkipped += sheet.skipped?.length || 0;
  }
  console.log(`  ${basename(file)}: ${fileItems} item(s), ${fileConfigs} configuration row(s) excluded, ${fileSkipped} row(s) skipped (blank/repeated-header)`);
  totalItemsSeen += fileItems; totalConfigsExcluded += fileConfigs; totalSkipped += fileSkipped;
}
console.log(`\nTotal: ${totalItemsSeen} real item(s) across ${files.length} file(s). ${totalConfigsExcluded} configuration row(s) excluded (never candidates). ${totalSkipped} row(s) skipped.\n`);

// --- 2. Same categorization pipeline as the real import route, tiers in the same order ---
const catalog = (await db.execute('SELECT id, item_name, bom_category, uom, default_moc, default_category_fields_json FROM items')).rows;
const catalogByName = new Map(catalog.map(c => [c.item_name.trim().toLowerCase().replace(/\s+/g, ' '), c]));
const groupRows = (await db.execute(
  `SELECT group_name, bom_category FROM items
   WHERE group_name IS NOT NULL AND group_name != '' AND bom_category IS NOT NULL
   GROUP BY group_name HAVING COUNT(DISTINCT bom_category) = 1`)).rows;
const groups = groupRows.map(g => ({ name: g.group_name, category: g.bom_category }));
const corrections = (await db.execute('SELECT word, category FROM category_word_corrections')).rows;
const correctionMap = new Map(corrections.map(c => [c.word.toUpperCase(), c.category]));

for (const it of allItems) {
  const match = catalogByName.get(String(it.material_description || '').trim().toLowerCase().replace(/\s+/g, ' '));
  it.item_id = match?.id || null;
  if (match?.bom_category) it.category = match.bom_category;
  else if (!it.category) {
    const fuzzy = suggestCategoryFromGroups(it.material_description, groups);
    if (fuzzy) it.category = fuzzy;
  }
  if (!it.category) {
    for (const w of normalizeWords(it.material_description || '')) {
      const hit = correctionMap.get(w.toUpperCase());
      if (hit) { it.category = hit; break; }
    }
  }
  if (!it.category) {
    const suggestion = suggestSpellingCorrection(it.material_description);
    if (suggestion) it.category_suggestion = suggestion;
  }
}

// --- 3. Item Master matching (memory -> family -> attribute -> suggest), same as the real route ---
const memoryRows = (await db.execute('SELECT kind, alias_key, moc_key, size_key, item_id, approvals, rejections FROM item_link_memory')).rows;
const index = buildCatalogIndex(catalog.map(c => ({ ...c })));
const memory = memoryFromRows(memoryRows);
const unlinked = allItems.filter(it => !it.item_id);
for (const it of unlinked) {
  const m = matchLine(it, index, memory);
  it.matchLevel = m.level; it.matchReason = m.reason; it.matchCandidates = m.candidates;
  if (m.itemId) {
    it.item_id = m.itemId;
    if (!it.category) it.category = index.byId.get(m.itemId)?.bom_category || it.category;
  }
}
for (const it of allItems) if (it.item_id && !it.matchLevel) it.matchLevel = 'name'; // exact catalog-name match, tier 1

// --- 4. Bucket, then de-duplicate the real "not in the catalog at all" bucket across every file ---
const buckets = { name: [], memory: [], family: [], attribute: [], suggest: [], none: [] };
for (const it of allItems) buckets[it.matchLevel || 'none'].push(it);

console.log('=== Resolution summary (across all files, before de-duplication) ===');
console.log(`  Already an exact catalog name match: ${buckets.name.length}`);
console.log(`  Resolved via remembered link (memory): ${buckets.memory.length}`);
console.log(`  Resolved via remembered family: ${buckets.family.length}`);
console.log(`  Resolved via shape+size+grade (attribute, single confident match): ${buckets.attribute.length}`);
console.log(`  Ambiguous — candidates exist but need a human pick (suggest): ${buckets.suggest.length}`);
console.log(`  Genuinely not in the catalog at all (none): ${buckets.none.length}\n`);

// Real "not in catalog" candidates only ever come from the 'none' bucket — 'suggest' means the
// catalog likely already has something close, a human should pick rather than a new row being
// generated blind.
const identityOf = it => `${normalizeMaterial(it.material_description)}|${normalizeMaterial(it.moc)}|${normalizeMaterial(it.size_spec)}`;
const uniqueCandidates = new Map();
for (const it of buckets.none) {
  const key = identityOf(it);
  if (!uniqueCandidates.has(key)) uniqueCandidates.set(key, { ...it, _files: new Set() });
  uniqueCandidates.get(key)._files.add(`${it._file}/${it._sheet}`);
}

console.log(`=== Genuine new-item candidates: ${uniqueCandidates.size} unique (from ${buckets.none.length} raw "none" rows across all files) ===\n`);
const byCategory = new Map();
for (const c of uniqueCandidates.values()) {
  const cat = c.category || '(uncategorized)';
  if (!byCategory.has(cat)) byCategory.set(cat, []);
  byCategory.get(cat).push(c);
}
for (const [cat, list] of [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`--- ${cat} (${list.length}) ---`);
  for (const c of list.sort((a, b) => (a.material_description || '').localeCompare(b.material_description || ''))) {
    const suggestion = c.category_suggestion ? ` [did you mean ${c.category_suggestion.suggestedWord}?]` : '';
    console.log(`  "${c.material_description}" | moc="${c.moc || ''}" | size="${c.size_spec || ''}" | qty="${c.qty_text || ''}"${suggestion}`);
    console.log(`      seen in: ${[...c._files].join(', ')}`);
  }
  console.log();
}

console.log('=== Ambiguous — needs a human pick, NOT a new row (suggest-level, top candidates shown) ===\n');
const suggestByDesc = new Map();
for (const it of buckets.suggest) {
  const key = normalizeMaterial(it.material_description);
  if (!suggestByDesc.has(key)) suggestByDesc.set(key, it);
}
for (const it of suggestByDesc.values()) {
  console.log(`  "${it.material_description}" (${it.moc || 'no moc'}, ${it.size_spec || 'no size'}) — ${it.matchReason}`);
  for (const cand of it.matchCandidates.slice(0, 3)) console.log(`      candidate: ${cand.name} (${cand.why})`);
}
