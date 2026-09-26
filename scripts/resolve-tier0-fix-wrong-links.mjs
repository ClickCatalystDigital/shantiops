// Tier 0: undo the wrong links an earlier round left (cable ties -> cable tray; 2.5 / 4 sq mm lugs -> 1.5 sq mm lug) and
// their memory, create the cable-tie items the catalog never had, re-key the blank-size memory rows the digit fix orphaned.
//   node --env-file=.env.local scripts/resolve-tier0-fix-wrong-links.mjs [--apply]
import { db, q, createItem, seedExactMemory, audit, itemByName } from './lib-item-resolve.mjs';
import { memoryKeys } from '../lib/item-attributes.mjs';
const apply = process.argv.includes('--apply');
const log = (...a) => console.log(...a);
log(apply ? '=== APPLY ===' : '=== DRY RUN ===');

const LUG = { '1.5': 'LUGS PIN TYPE 1.5 SQMM', '2.5': 'LUGS PIN TYPE 2.5 SQMM', '4': 'LUGS PIN TYPE 4 SQMM' };
const TIES = [
  { name: 'CABLE TIES 100 MM', desc: 'CABLE TIES 100 MM' },
  { name: 'CABLE TIES 150 MM', desc: 'CABLE TIES 150 MM' },
  { name: 'CABLE TIES 2.5 MM X 4 MM THK', desc: 'CABLE TIES -2.5 mm X 4MM THK' },
];

// 1. items the catalog never had
const tieIds = {};
for (const t of TIES) {
  const ex = await itemByName(t.name);
  log(`${ex ? 'exists' : 'CREATE'} item "${t.name}"`);
  if (apply) tieIds[t.desc] = (await createItem({ name: t.name, group: 'ELECTRICAL', bom_category: 'other', uom: 'Nos', mfg: 0, detail: 'Nylon cable tie (was wrongly linked to CABLE TRAY in an earlier pass).' })).id;
  else tieIds[t.desc] = ex?.id ?? null;
}

// 2. wrong memory rows
const badMem = await q(`SELECT id, alias_key, item_id FROM item_link_memory WHERE alias_key IN ('cable ties 100 mm','cable ties 150 mm','insulated lugs sq mm pin type','turn buckles nos clamps 12 nos')`);
log(`delete ${badMem.length} wrong memory row(s): ${badMem.map(r => r.id).join(',')}`);
if (apply && badMem.length) await db.execute(`DELETE FROM item_link_memory WHERE id IN (${badMem.map(r => r.id).join(',')})`);

// 3. memory under the new keys
for (const [sz, name] of Object.entries(LUG)) {
  const it = await itemByName(name);
  const line = { material_description: `INSULATED LUGS ${sz} SQ MM PIN TYPE`, moc: '', size_spec: '' };
  log(`memory ${memoryKeys(line).exactKey} -> ${it.id} ${name}`);
  if (apply) await seedExactMemory(line, it.id);
}
for (const t of TIES) {
  const line = { material_description: t.desc, moc: '', size_spec: '' };
  log(`memory ${memoryKeys(line).exactKey} -> ${tieIds[t.desc] ?? '(new item)'} ${t.name}`);
  if (apply) await seedExactMemory(line, tieIds[t.desc]);
}
// blank-size rows the digit fix re-keyed (only when the old row pointed to ONE item): volt meter, terminal clips, LED lamps, ...
const descs = (await q(`SELECT DISTINCT material_description d, moc FROM bom_items WHERE source='bom'`));
const legacyAlias = d => String(d ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 2).join(' ');
const mem = await q(`SELECT alias_key, moc_key, size_key, item_id FROM item_link_memory WHERE kind='exact' AND size_key=''`);
for (const { d, moc } of descs) {
  const k = memoryKeys({ material_description: d, moc, size_spec: '' });
  if (!k.size.startsWith('#') || /LUGS|CABLE TIES|TURN BUCKLES/i.test(d)) continue;
  const old = mem.filter(m => m.alias_key === legacyAlias(d) && m.moc_key === k.moc);
  if (new Set(old.map(o => o.item_id)).size !== 1) continue;
  log(`re-key ${JSON.stringify(d)} -> item ${old[0].item_id}`);
  if (apply) await seedExactMemory({ material_description: d, moc, size_spec: '' }, old[0].item_id);
}

// 4. the wrong links themselves
const wrong = await q(`SELECT b.id, b.material_description d, b.item_id, b.project_id FROM bom_items b
  WHERE (b.material_description LIKE 'INSULATED LUGS % PIN TYPE' AND b.item_id = 1199 AND b.material_description NOT LIKE '%1.5%')
     OR (b.material_description IN ('CABLE TIES 100 MM','CABLE TIES 150 MM') AND b.item_id IN (715,716))`);
for (const w of wrong) {
  let target;
  const m = w.d.match(/LUGS ([\d.]+) SQ/);
  if (m) target = (await itemByName(LUG[m[1]]))?.id; else target = tieIds[w.d];
  log(`bom_item ${w.id} (project ${w.project_id}) "${w.d}": item ${w.item_id} -> ${target ?? '(new cable-tie item)'}`);
  if (apply) await db.execute({ sql: 'UPDATE bom_items SET item_id = ? WHERE id = ?', args: [target, w.id] });
}
// a bundled line (two different items in one description) must not point at just one of them
const bundled = await q(`SELECT id, project_id FROM bom_items WHERE material_description LIKE 'TURN BUCKLES -3 Nos & ''D'' CLAMPS%' AND item_id = 1240`);
for (const b of bundled) { log(`bom_item ${b.id} (project ${b.project_id}) bundled TURN BUCKLES + D CLAMPS: unlink (needs a human line split)`); if (apply) await db.execute({ sql: 'UPDATE bom_items SET item_id = NULL WHERE id = ?', args: [b.id] }); }
if (apply) await audit('item_residue_tier0_fix_wrong_links', { wrongLinksFixed: wrong.length, badMemoryDeleted: badMem.length });
log(`\n${wrong.length} wrong bom_item link(s) ${apply ? 'fixed' : 'to fix'}.`);
process.exit(0);
