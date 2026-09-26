// READ-ONLY. Per-project report of BOM lines (source='bom') that still have no Item Master link, run through the same
// tiers the import / backfill use (exact name, inferCategory, group fallback, matchLine). Writes nothing to the DB.
//   node --env-file=.env.local scripts/report-unlinked-bom-lines.mjs [--json out.json] [--project <id>]
import { createClient } from '@libsql/client';
import { writeFileSync } from 'node:fs';
import { suggestCategoryFromGroups, inferCategory } from '../lib/section-shapes.js';
import { buildCatalogIndex, matchLine, memoryFromRows } from '../lib/item-match.mjs';
import { keyDim, DIMENSIONAL } from '../lib/item-attributes.mjs';

const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const onlyProject = args.includes('--project') ? Number(args[args.indexOf('--project') + 1]) : null;

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const catalog = (await db.execute('SELECT id, item_name, bom_category, uom FROM items')).rows.map(r => ({ ...r }));
const catalogByName = new Map(catalog.map(c => [c.item_name.trim().toLowerCase().replace(/\s+/g, ' '), c]));
const groups = (await db.execute(
  `SELECT group_name, bom_category FROM items WHERE group_name IS NOT NULL AND group_name != '' AND bom_category IS NOT NULL
   GROUP BY group_name HAVING COUNT(DISTINCT bom_category) = 1`)).rows.map(g => ({ name: g.group_name, category: g.bom_category }));
const index = buildCatalogIndex(catalog);
const memory = memoryFromRows((await db.execute('SELECT kind, alias_key, moc_key, size_key, item_id, approvals, rejections FROM item_link_memory')).rows.map(r => ({ ...r })));

const rows = (await db.execute(`
  SELECT b.id, b.project_id, p.project_no, p.status AS project_status, p.master_project_id,
         b.material_description, b.moc, b.size_spec, b.category, b.qty_text, b.purchase_status, b.pending_review,
         (SELECT 1 FROM milestones m WHERE m.project_id = p.id AND m.milestone_key = 'release_bom' AND m.status = 'done') AS released
  FROM bom_items b JOIN projects p ON p.id = b.project_id
  WHERE b.source = 'bom' AND b.item_id IS NULL AND p.status = 'active'
  ${onlyProject ? `AND b.project_id = ${Number(onlyProject)}` : ''}
  ORDER BY p.project_no, b.id`)).rows.map(r => ({ ...r }));

const CONFIDENT = new Set(['memory', 'family', 'attribute']);
const out = [];
for (const r of rows) {
  let category = r.category, how = null, target = null, candidates = [], reason = '';
  const byName = catalogByName.get(String(r.material_description || '').trim().toLowerCase().replace(/\s+/g, ' '));
  if (byName) { how = 'name'; target = byName; }
  else {
    if (!category) category = inferCategory(r.material_description, r.size_spec) || suggestCategoryFromGroups(r.material_description, groups) || null;
    const m = matchLine({ material_description: r.material_description, moc: r.moc, size_spec: r.size_spec, category }, index, memory);
    if (CONFIDENT.has(m.level)) { how = m.level; target = index.byId.get(m.itemId); }
    else { how = m.level; candidates = m.candidates; reason = m.reason; }
  }
  let why = '';
  if (how === 'none' || how === 'suggest') {
    if (!category) why = 'no category';
    else if (!DIMENSIONAL.includes(category)) why = `category '${category}' is not size-matched`;
    else if (!keyDim(category, r.size_spec, 'line') && !keyDim(category, r.material_description, 'line')) why = 'size text not readable';
    else why = reason || 'no catalog row at this size';
  }
  out.push({ ...r, resolved_category: category, how, target: target ? { id: target.id, name: target.item_name } : null, candidates, why });
}

const byProject = new Map();
for (const o of out) { if (!byProject.has(o.project_no)) byProject.set(o.project_no, []); byProject.get(o.project_no).push(o); }
console.log(`Un-linked source='bom' lines on active projects: ${out.length} across ${byProject.size} project(s)\n`);
console.log('project'.padEnd(22), 'rel'.padEnd(4), 'total'.padStart(5), 'name'.padStart(5), 'mem'.padStart(4), 'fam'.padStart(4), 'attr'.padStart(5), 'sugg'.padStart(5), 'none'.padStart(5));
for (const [pn, list] of byProject) {
  const c = k => list.filter(x => x.how === k).length;
  console.log(pn.padEnd(22), (list[0].released ? 'yes' : 'no').padEnd(4), String(list.length).padStart(5), String(c('name')).padStart(5), String(c('memory')).padStart(4),
    String(c('family')).padStart(4), String(c('attribute')).padStart(5), String(c('suggest')).padStart(5), String(c('none')).padStart(5));
}
const tot = k => out.filter(x => x.how === k).length;
console.log(`\nTOTAL confident (would link): ${tot('name') + tot('memory') + tot('family') + tot('attribute')} | suggest: ${tot('suggest')} | none: ${tot('none')}`);

// Residue, deduped across projects
const residue = new Map();
for (const o of out.filter(x => x.how === 'suggest' || x.how === 'none')) {
  const key = `${(o.material_description || '').trim()}|${(o.moc || '').trim()}|${(o.size_spec || '').trim()}`;
  if (!residue.has(key)) residue.set(key, { desc: o.material_description, moc: o.moc, size: o.size_spec, category: o.resolved_category, why: o.why, count: 0, projects: new Set(), candidates: o.candidates });
  const e = residue.get(key); e.count++; e.projects.add(o.project_no);
}
console.log(`\nRESIDUE: ${residue.size} distinct lines (${out.filter(x => x.how === 'suggest' || x.how === 'none').length} rows)`);
const byWhy = new Map();
for (const e of residue.values()) byWhy.set(e.why.split(':')[0], (byWhy.get(e.why.split(':')[0]) || 0) + 1);
for (const [w, n] of byWhy) console.log(`  ${String(n).padStart(4)}  ${w}`);

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ rows: out, residue: [...residue.values()].map(e => ({ ...e, projects: [...e.projects] })) }, null, 1));
  console.log(`\nWrote ${jsonOut}`);
}
process.exit(0);
