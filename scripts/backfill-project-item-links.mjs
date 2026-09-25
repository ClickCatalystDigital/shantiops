// Backfills item_id/category on an ALREADY-IMPORTED project's real bom_items rows, using the
// exact same matching pipeline (category tiers + matchLine) the import route runs at import time.
// Only fills genuinely missing data — never overwrites an existing item_id, never downgrades an
// existing category. Safe to re-run (idempotent: a row already resolved is simply skipped).
//
// Real gap found and fixed (2026-09-24): this script never called inferCategory() — the regex tier
// parsePmb() runs FIRST, at parse time, on every fresh import (lib/pmb.mjs's buildItem()). An
// already-imported row's category was set once, at its own original import time; when
// inferCategory() later gains a new pattern (e.g. the L x W x T "MM THICK" transposed-description
// fallback added this same round), an existing row never picks it up on its own — only a fresh
// re-import would. Added here as the first tier tried (mirrors buildItem()'s own precedence: the
// regex runs before the fuzzy group/correction fallbacks), so re-running this script after a
// section-shapes.js change actually reaches the real rows that change was written for.
//
// Usage: node --env-file=.env.local scripts/backfill-project-item-links.mjs <project_id> [--apply]
import { createClient } from '@libsql/client';
import { suggestCategoryFromGroups, suggestSpellingCorrection, inferCategory } from '../lib/section-shapes.js';
import { buildCatalogIndex, matchLine, memoryFromRows } from '../lib/item-match.mjs';
import { normalizeWords } from '../lib/match-utils.js';

const apply = process.argv.includes('--apply');
const projectId = Number(process.argv[2]);
if (!projectId) { console.error('Usage: node --env-file=.env.local scripts/backfill-project-item-links.mjs <project_id> [--apply]'); process.exit(1); }

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

const items = (await db.execute({
  sql: 'SELECT id, material_description, moc, size_spec, category, item_id FROM bom_items WHERE project_id = ? AND source = ?',
  args: [projectId, 'bom'],
})).rows;

console.log(apply ? `=== APPLYING to project ${projectId} ===` : `=== DRY RUN for project ${projectId} (nothing written) ===`);
console.log(`${items.length} BOM item(s) with source='bom' checked.\n`);

let itemIdFilled = 0, categoryFilled = 0, unchanged = 0;
const CONFIDENT = new Set(['name', 'memory', 'family', 'attribute']);

for (const row of items) {
  const it = { material_description: row.material_description, moc: row.moc, size_spec: row.size_spec, category: row.category };
  let newCategory = it.category, newItemId = row.item_id;

  if (!row.item_id) {
    const match = catalogByName.get(String(it.material_description || '').trim().toLowerCase().replace(/\s+/g, ' '));
    if (match?.id) {
      newItemId = match.id;
      if (match.bom_category && !newCategory) newCategory = match.bom_category;
    } else {
      if (!newCategory) {
        const guess = inferCategory(it.material_description, it.size_spec);
        if (guess) newCategory = guess;
      }
      if (!newCategory) {
        const f = suggestCategoryFromGroups(it.material_description, groups);
        if (f) newCategory = f;
      }
      const m = matchLine({ ...it, category: newCategory }, index, memory);
      if (CONFIDENT.has(m.level) && m.itemId) newItemId = m.itemId;
    }
  }
  if (!newCategory) {
    for (const w of normalizeWords(it.material_description || '')) {
      const hit = correctionMap.get(w.toUpperCase());
      if (hit) { newCategory = hit; break; }
    }
  }

  if (newItemId !== row.item_id || newCategory !== row.category) {
    const targetName = newItemId ? index.byId.get(newItemId)?.item_name : null;
    console.log(`  #${row.id} "${row.material_description}" | moc="${row.moc}" | size="${row.size_spec}"`);
    if (newItemId !== row.item_id) console.log(`      item_id: ${row.item_id ?? 'NULL'} -> ${newItemId} (${targetName})`);
    if (newCategory !== row.category) console.log(`      category: ${row.category ?? 'NULL'} -> ${newCategory}`);
    if (newItemId) itemIdFilled++;
    if (newCategory && newCategory !== row.category) categoryFilled++;
    if (apply) {
      await db.execute({ sql: 'UPDATE bom_items SET item_id = ?, category = ? WHERE id = ?', args: [newItemId, newCategory, row.id] });
    }
  } else {
    unchanged++;
  }
}

console.log(`\n${itemIdFilled} item_id link(s) ${apply ? 'filled' : 'would be filled'}, ${categoryFilled} categor(y/ies) ${apply ? 'filled' : 'would be filled'}, ${unchanged} row(s) unchanged.`);

if (apply) {
  await db.execute({
    sql: 'INSERT INTO usb_audit (request_id, machine_id, actor, action, detail) VALUES (NULL, NULL, ?, ?, ?)',
    args: ['script:item-master-standardize', 'project_item_links_backfilled', JSON.stringify({ projectId, itemIdFilled, categoryFilled })],
  });
  console.log('Applied and audited.');
}
