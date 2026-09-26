// READ-ONLY. Per active project, the BOM-line invariants: no category, not in a node (design lines only; PR-raised lines are
// exempt from the node rule), node of another project, dangling node, empty nodes, no Item Master link.
//   node --env-file=.env.local scripts/check-bom-integrity.mjs
import { createClient } from '@libsql/client';
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async s => (await db.execute(s)).rows.map(r => ({ ...r }));
const rows = await q(`SELECT p.project_no, COUNT(*) items,
  SUM(b.source='bom' AND (b.category IS NULL OR TRIM(b.category)='')) no_category,
  SUM(b.source='bom' AND b.assembly_id IS NULL AND b.pr_item_id IS NULL) no_node,
  SUM(b.assembly_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM bom_assemblies a WHERE a.id=b.assembly_id)) dangling,
  SUM(b.assembly_id IS NOT NULL AND EXISTS (SELECT 1 FROM bom_assemblies a WHERE a.id=b.assembly_id AND a.project_id!=b.project_id)) wrong_project,
  SUM(b.source='bom' AND b.item_id IS NULL) unlinked
  FROM bom_items b JOIN projects p ON p.id=b.project_id WHERE p.status='active' AND p.master_project_id IS NULL GROUP BY p.id ORDER BY p.project_no`);
const empty = await q(`SELECT p.project_no, COUNT(*) n FROM bom_assemblies a JOIN projects p ON p.id=a.project_id
  WHERE NOT EXISTS (SELECT 1 FROM bom_items b WHERE b.assembly_id=a.id) AND NOT EXISTS (SELECT 1 FROM bom_assemblies c WHERE c.parent_id=a.id) GROUP BY p.id`);
const emptyBy = new Map(empty.map(e => [e.project_no, e.n]));
console.log('project'.padEnd(18), ['items', 'no_cat', 'no_node', 'dangl', 'wrongP', 'unlinked', 'emptyNodes'].map(h => h.padStart(10)).join(''));
let bad = 0;
for (const r of rows) {
  const e = emptyBy.get(r.project_no) || 0;
  if (r.no_category || r.no_node || r.dangling || r.wrong_project) bad++;
  console.log(String(r.project_no).padEnd(18), [r.items, r.no_category, r.no_node, r.dangling, r.wrong_project, r.unlinked, e].map(v => String(v ?? 0).padStart(10)).join(''));
}
console.log(`\n${bad} project(s) with a category / node / reference problem`);
