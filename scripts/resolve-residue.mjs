// Runs the residue rules (scripts/lib-residue-rules.mjs) over every un-linked source='bom' BOM line, DISTINCT by
// description|moc|size. Dry-run prints every decision + what is still unresolved; --apply creates the new Item Master rows,
// teaches item_link_memory, and writes the link list for scripts/apply-links-via-api.mjs (the same write path the app uses).
//   node --env-file=.env.local scripts/resolve-residue.mjs [--apply] [--only <rule>] [--unresolved] [--validate]
import { writeFileSync } from 'node:fs';
import { db, q, createItem, seedExactMemory, audit, itemByName } from './lib-item-resolve.mjs';
import { RULES } from './lib-residue-rules.mjs';
import { suggestCategoryFromGroups, inferCategory } from '../lib/section-shapes.js';
import { buildCatalogIndex, matchLine, memoryFromRows } from '../lib/item-match.mjs';
import { allThk } from './lib-residue-rules.mjs';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const showUnresolved = args.includes('--unresolved');
const validate = args.includes('--validate');

const catalog = await q('SELECT id, item_name, bom_category, group_name, uom FROM items');
const byName = new Map(catalog.map(r => [r.item_name.trim().toUpperCase(), r]));
const ctx = {
  byName: n => byName.get(String(n).trim().toUpperCase()) || null,
  find: re => catalog.filter(r => re.test(r.item_name)),
};

const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const sql = validate
  ? `SELECT b.id, b.project_id, p.project_no, b.material_description d, b.moc, b.size_spec s, b.category, b.item_id FROM bom_items b JOIN projects p ON p.id=b.project_id WHERE b.source='bom' AND b.item_id IS NOT NULL`
  : `SELECT b.id, b.project_id, p.project_no, b.material_description d, b.moc, b.size_spec s, b.category, b.item_id FROM bom_items b JOIN projects p ON p.id=b.project_id WHERE b.source='bom' AND b.item_id IS NULL AND p.status='active'`;
const rows = await q(sql);
const groups = new Map();
for (const r of rows) {
  const key = `${norm(r.d)}|${norm(r.moc)}|${norm(r.s)}`;
  if (!groups.has(key)) groups.set(key, { key, desc: norm(r.d), moc: norm(r.moc), size: norm(r.s), category: r.category, count: 0, projects: new Set(), rows: [], item_id: r.item_id });
  const g = groups.get(key); g.count++; g.projects.add(r.project_no); g.rows.push({ id: r.id, project_id: r.project_id });
}

const catIndex = buildCatalogIndex(catalog.map(r => ({ ...r })));
const memory = memoryFromRows(await q('SELECT kind, alias_key, moc_key, size_key, item_id, approvals, rejections FROM item_link_memory'));
const catGroups = (await q(`SELECT group_name, bom_category FROM items WHERE group_name IS NOT NULL AND group_name != '' AND bom_category IS NOT NULL GROUP BY group_name HAVING COUNT(DISTINCT bom_category) = 1`)).map(g => ({ name: g.group_name, category: g.bom_category }));
const decisions = [];
const unresolved = [];
for (const g of groups.values()) {
  let dec = null, by = null;
  for (const rule of RULES) {
    if (only && rule.name !== only) continue;
    if (!rule.test(g)) continue;
    const out = rule.do(g, ctx);
    if (out) { dec = out; by = rule.name; break; }
  }
  if (!dec && !only) {
    // fallback: what the app's own matcher is confident about (remembered link, known family, one catalog row at that size),
    // but never for a line that names several sizes/thicknesses in one cell
    if (allThk(`${g.size} ${g.desc}`).length <= 1 && (g.size.match(/"/g) || []).length <= 2) {
      const cat = g.category || inferCategory(g.desc, g.size) || suggestCategoryFromGroups(g.desc, catGroups) || null;
      const m = matchLine({ material_description: g.desc, moc: g.moc, size_spec: g.size, category: cat }, catIndex, memory);
      if (['memory', 'family', 'attribute'].includes(m.level) && m.itemId) { dec = { link: catIndex.byId.get(m.itemId).item_name }; by = `app-match:${m.level}`; }
    }
  }
  // reviewed by hand: rule targets that are not the same physical item -> leave for a person
  const DENY = [[/^REDUCER/i, /PLATES?\b/i], [/CROSS HEADER/i, /PIPE/i], [/SG BOLT FLANGE/i, /PLATES/i], [/CONDENSATE RECOVERY/i, /SAVOMAX/i], [/MDC CONES/i, /CI CONES/i], [/CHIMNEY FOUNDATION/i, /FOUNDATION BOLTS/i], [/FOUNDATION BOLT & NUT/i, /^BOLTS/i]];
  if (dec?.link && DENY.some(([a, b]) => a.test(g.desc) && b.test(dec.link))) dec = { leave: 'engineered/fabricated part; catalog row is a different item - needs a person' };
  if (!dec) { unresolved.push(g); continue; }
  if (dec.link && !ctx.byName(dec.link)) { console.log(`!! rule ${by}: catalog has no "${dec.link}" (line: ${g.key})`); unresolved.push(g); continue; }
  decisions.push({ g, dec, by });
}

const label = g => `${g.count}x ${[g.desc, g.moc, g.size].map(s => s.slice(0, 40)).join(' | ')}`;
if (validate) {
  let agree = 0, differ = 0;
  for (const { g, dec, by } of decisions) {
    if (!dec.link) continue;
    const target = ctx.byName(dec.link);
    if (target.id === g.item_id) agree++; else { differ++; console.log(`DIFFERS [${by}] ${label(g)}\n    rule: ${dec.link}\n    actual: ${catalog.find(r => r.id === g.item_id)?.item_name}`); }
  }
  console.log(`\nvalidate: ${agree} agree, ${differ} differ (of ${decisions.length} decided)`);
  process.exit(0);
}

import { writeFileSync as _w } from 'node:fs';
let report = '';
const byRule = new Map();
for (const d of decisions) { if (!byRule.has(d.by)) byRule.set(d.by, []); byRule.get(d.by).push(d); }
for (const [name, list] of byRule) {
  const head = `\n=== ${name} (${list.length} distinct, ${list.reduce((n, d) => n + d.g.count, 0)} rows)`;
  report += head + '\n';
  if (!args.includes('--brief')) console.log(head);
  for (const { g, dec } of list) {
    const what = dec.link ? `LINK   ${dec.link}` : dec.create ? `CREATE ${dec.create.name}` : dec.config ? 'CONFIG' : `LEAVE  ${dec.leave}`;
    const line = `  ${label(g)}  =>  ${what}`;
    report += line + '\n';
    if (!args.includes('--brief') && (!only || only === name) && (!args.includes('--skip-config') || !dec.config)) console.log(line);
  }
}
_w('scripts/.tmp/residue-report.txt', report);
const n = k => decisions.filter(d => (k === 'link' ? d.dec.link : k === 'create' ? d.dec.create : k === 'config' ? d.dec.config : d.dec.leave)).length;
console.log(`\nDECIDED ${decisions.length} of ${groups.size} distinct lines: link ${n('link')}, create ${n('create')}, config ${n('config')}, leave ${n('leave')}; UNRESOLVED ${unresolved.length} (${unresolved.reduce((s, g) => s + g.count, 0)} rows)`);
if (showUnresolved) for (const g of unresolved) console.log(`  ? ${label(g)} [${g.category || '-'}]`);

if (apply) {
  const links = [];
  const created = [];
  for (const { g, dec } of decisions) {
    let itemId = null;
    if (dec.link) itemId = ctx.byName(dec.link).id;
    else if (dec.create) {
      const r = await createItem(dec.create);
      itemId = r.id; if (r.created) created.push({ id: r.id, name: dec.create.name });
    }
    if (itemId) {
      await seedExactMemory({ material_description: g.desc, moc: g.moc, size_spec: g.size }, itemId);
      for (const row of g.rows) links.push({ project_id: row.project_id, bom_item_id: row.id, item_id: itemId });
    }
  }
  writeFileSync('scripts/.tmp/links.json', JSON.stringify(links));
  await audit('item_residue_resolved', { created: created.length, links: links.length, distinctLines: decisions.length });
  console.log(`\nApplied: ${created.length} item(s) created, memory seeded, ${links.length} link(s) written to scripts/.tmp/links.json`);
}
process.exit(0);
