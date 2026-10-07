// lib/subsystem-check.js — DB side of "possibly missing": for each subsystem node of a project that has a saved build
// (a Structure Template with a family), list the build's required lines the project does not have. Read-only except the
// per-node "not needed here" dismissals. Matching rules live in lib/subsystem-check.mjs.
import { queryAll } from './db';
import { subsystemFamily } from './subsystem-family.mjs';
import { bestBuild } from './subsystem-check.mjs';
import { collectItemIds } from './bom-structure.mjs';

const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
export const dismissKey = line => `${line.item_id ? `i${line.item_id}` : `d${norm(line.material_description)}`}|${line.path || ''}`;

function templateLines(tree, names) {
  const out = [];
  (function walk(nodes, path) {
    for (const n of nodes || []) {
      const p = [...path, n.name];
      for (const it of n.items || []) out.push({ item_id: it.item_id || null, label: names.get(Number(it.item_id)) || it.material_description, presence: it.presence,
        material_description: it.material_description, size_spec: it.size_spec || '', qty_text: it.qty_text || '', path: path.join(' › ') });
      walk(n.children, p);
    }
  })(tree, []);
  return out;
}

export async function getSubsystemCheck(projectId) {
  const [nodes, items, templates] = await Promise.all([
    queryAll('SELECT id, parent_id, name, check_dismissed_json FROM bom_assemblies WHERE project_id = ?', [projectId]),
    queryAll(`SELECT b.assembly_id, b.item_id, b.material_description, i.item_name FROM bom_items b LEFT JOIN items i ON i.id = b.item_id
               WHERE b.project_id = ? AND b.source = 'bom' AND b.assembly_id IS NOT NULL`, [projectId]),
    queryAll(`SELECT id, name, family, version, is_default, tree_json FROM bom_structure_templates
               WHERE archived_at IS NULL AND family IS NOT NULL AND root_count = 1 ORDER BY is_default DESC, id`),
  ]);
  if (!templates.length) return { hasTemplates: false, items: [] };

  const trees = templates.map(t => { try { return JSON.parse(t.tree_json); } catch { return []; } });
  const ids = [...new Set(trees.flatMap(collectItemIds))];
  const names = new Map();
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    for (const r of await queryAll(`SELECT id, item_name FROM items WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk)) names.set(Number(r.id), r.item_name);
  }
  const buildsByFamily = new Map();
  templates.forEach((t, i) => {
    const k = subsystemFamily(t.family).key;
    if (!buildsByFamily.has(k)) buildsByFamily.set(k, []);
    buildsByFamily.get(k).push({ id: t.id, name: t.name, version: t.version, lines: templateLines(trees[i], names) });
  });

  const childrenOf = new Map();
  for (const n of nodes) { if (!childrenOf.has(n.parent_id)) childrenOf.set(n.parent_id, []); childrenOf.get(n.parent_id).push(n); }
  const itemsOf = new Map();
  for (const it of items) { if (!itemsOf.has(it.assembly_id)) itemsOf.set(it.assembly_id, []); itemsOf.get(it.assembly_id).push(it); }
  const under = n => [...(itemsOf.get(n.id) || []), ...(childrenOf.get(n.id) || []).flatMap(under)];

  const result = [];
  for (const n of nodes) {
    if (n.parent_id == null && !(itemsOf.get(n.id) || []).length) continue; // bare root container
    const builds = buildsByFamily.get(subsystemFamily(n.name).key);
    if (!builds) continue;
    const lines = under(n).map(it => ({ item_id: it.item_id || null, label: it.item_name || it.material_description }));
    const best = bestBuild(lines, builds);
    if (!best) continue;
    let dismissed = [];
    try { dismissed = JSON.parse(n.check_dismissed_json || '[]'); } catch { /* none */ }
    const missing = best.missing.filter(m => !dismissed.includes(dismissKey(m)))
      .map(m => ({ key: dismissKey(m), path: m.path, description: m.label, size_spec: m.size_spec, qty_text: m.qty_text, item_id: m.item_id }));
    if (missing.length) result.push({ node_id: n.id, node: n.name, build: { id: best.build.id, name: best.build.name }, matched: best.matched, missing });
  }
  return { hasTemplates: true, items: result };
}
