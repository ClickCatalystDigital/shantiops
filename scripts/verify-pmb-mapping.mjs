// End-to-end verification: for the 4 real PMB files, does every genuine item (not configuration)
// resolve to exactly one Item Master row? Replicates the real production pipeline
// (app/api/projects/[id]/bom/import/route.js) exactly — exact-name match -> category tiers ->
// matchLine's memory/family/attribute/suggest tiers — against the LIVE catalog + item_link_memory,
// read-only, no writes.
//
// Usage: node --env-file=.env.local scripts/verify-pmb-mapping.mjs <file1.xlsx> [file2.xlsx ...]
import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parsePmb } from '../lib/pmb.mjs';
import { suggestCategoryFromGroups, suggestSpellingCorrection } from '../lib/section-shapes.js';
import { buildCatalogIndex, matchLine, memoryFromRows } from '../lib/item-match.mjs';
import { normalizeWords } from '../lib/match-utils.js';

const jsonArgIdx = process.argv.indexOf('--json');
const files = process.argv.slice(2).filter((a, i, arr) => a !== '--json' && arr[i - 1] !== '--json');
if (!files.length) { console.error('Usage: node --env-file=.env.local scripts/verify-pmb-mapping.mjs <file1.xlsx> [...]'); process.exit(1); }

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

let totalItems = 0, totalConfigs = 0;
const results = []; // { desc, moc, size, section, sheet, file, level, itemId, itemName, candidates }

for (const file of files) {
  const parsed = parsePmb(readFileSync(file));
  if (parsed.error) { console.log(`${basename(file)}: PARSE ERROR — ${parsed.error}`); continue; }
  for (const sheet of parsed.sheets) {
    totalConfigs += sheet.configs.length;
    for (const it of sheet.items) {
      totalItems++;
      // Category tiers, exactly as the real import route runs them
      const match = catalogByName.get(String(it.material_description || '').trim().toLowerCase().replace(/\s+/g, ' '));
      it.item_id = match?.id || null;
      if (match?.bom_category) it.category = match.bom_category;
      else if (!it.category) { const f = suggestCategoryFromGroups(it.material_description, groups); if (f) it.category = f; }
      if (!it.category) { for (const w of normalizeWords(it.material_description || '')) { const hit = correctionMap.get(w.toUpperCase()); if (hit) { it.category = hit; break; } } }
      if (!it.category) { const s = suggestSpellingCorrection(it.material_description); if (s) it.category_suggestion = s; }

      let level, itemId = it.item_id, itemName = null, candidates = [];
      if (it.item_id) { level = 'name'; itemName = index.byId.get(it.item_id)?.item_name; }
      else {
        const m = matchLine(it, index, memory);
        level = m.level; itemId = m.itemId || null; itemName = itemId ? index.byId.get(itemId)?.item_name : null;
        candidates = (m.candidates || []).map(c => `${c.id}:${c.name}`);
      }
      results.push({
        desc: it.material_description, moc: it.moc, size: it.size_spec, category: it.category,
        section: it.section, sheet: sheet.name, file: basename(file),
        level, itemId, itemName, candidates,
      });
    }
  }
}

const byLevel = {};
for (const r of results) byLevel[r.level] = (byLevel[r.level] || 0) + 1;
console.log(`\n=== ${totalItems} real item(s), ${totalConfigs} configuration row(s) excluded (as expected, never counted here) ===`);
console.log('By resolution level:', JSON.stringify(byLevel, null, 1));

const CONFIDENT = new Set(['name', 'memory', 'family', 'attribute']);
const gaps = results.filter(r => !CONFIDENT.has(r.level));
console.log(`\n=== ${gaps.length} occurrence(s) NOT confidently mapped (level not in name/memory/family/attribute) ===`);

// Dedupe to the real distinct set: same (description, moc, size) repeats verbatim across files —
// classify each real item once, not once per occurrence.
const dedupe = new Map();
for (const g of gaps) {
  const key = `${(g.desc || '').trim().toUpperCase()}|${(g.moc || '').trim().toUpperCase()}|${(g.size || '').trim().toUpperCase()}`;
  if (!dedupe.has(key)) dedupe.set(key, { ...g, key, occurrences: [], count: 0 });
  const d = dedupe.get(key);
  d.count++;
  d.occurrences.push(`${g.file}/${g.sheet}`);
}
const unique = [...dedupe.values()].sort((a, b) => (a.category || '~').localeCompare(b.category || '~') || a.desc.localeCompare(b.desc));
console.log(`=== ${unique.length} DISTINCT item(s) after de-duplication ===\n`);
for (const g of unique) {
  console.log(`[${g.level}] (x${g.count}) "${g.desc}" | moc="${g.moc}" | size="${g.size}" | category=${g.category || '(none)'}`);
  if (g.candidates?.length) console.log(`   candidates: ${g.candidates.join(' | ')}`);
}

// Machine-readable dump for downstream tooling (e.g. scripts/apply-bucket-decisions.mjs) — exact
// text, no hand-transcription risk. --json <path> writes it; otherwise this is a no-op.
if (jsonArgIdx !== -1 && process.argv[jsonArgIdx + 1]) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.argv[jsonArgIdx + 1], JSON.stringify(unique.map(g => ({
    key: g.key, desc: g.desc, moc: g.moc, size: g.size, category: g.category, level: g.level, count: g.count,
  })), null, 1));
  console.log(`\nWrote ${unique.length} distinct unresolved item(s) to ${process.argv[jsonArgIdx + 1]}`);
}
