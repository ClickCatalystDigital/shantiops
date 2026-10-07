// lib/subsystem-report.js — read-only: what each subsystem family (FD Fan Blower, Feed Line…) contains across the real
// projects, and how many projects have each line. Feeds Engineering → Subsystems. Writes nothing.
import { queryAll } from './db';
import { subsystemFamily } from './subsystem-family.mjs';
import { parseConfig } from './bom-config.mjs';

const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

// Real projects only: not a split unit (its master carries the BOM), not the stock/trade placeholder, not test data.
const REAL_PROJECT = `p.master_project_id IS NULL AND COALESCE(p.is_system, 0) = 0
  AND p.project_no NOT LIKE 'ZZ%' AND p.project_no NOT LIKE 'TEST%'`;

async function loadTree() {
  const nodes = await queryAll(
    `SELECT a.id, a.project_id, a.parent_id, a.name, a.config_json, p.project_no, p.series, p.model_capacity
       FROM bom_assemblies a JOIN projects p ON p.id = a.project_id WHERE ${REAL_PROJECT}`);
  const items = await queryAll(
    `SELECT b.id, b.assembly_id, b.material_description, b.size_spec, b.qty_text, b.category, b.item_id, i.item_name
       FROM bom_items b JOIN bom_assemblies a ON a.id = b.assembly_id JOIN projects p ON p.id = a.project_id
       LEFT JOIN items i ON i.id = b.item_id
      WHERE b.source = 'bom' AND ${REAL_PROJECT} ORDER BY b.sort_order, b.id`);
  const itemsByNode = new Map();
  for (const it of items) { if (!itemsByNode.has(it.assembly_id)) itemsByNode.set(it.assembly_id, []); itemsByNode.get(it.assembly_id).push(it); }
  const childrenOf = new Map();
  for (const n of nodes) { if (!childrenOf.has(n.parent_id)) childrenOf.set(n.parent_id, []); childrenOf.get(n.parent_id).push(n); }
  return { nodes, itemsByNode, childrenOf };
}

// every item at or under `node`, with the names of the nodes between (empty path = the node's own lines)
function collect(node, tree, path = []) {
  const out = (tree.itemsByNode.get(node.id) || []).map(item => ({ item, path }));
  for (const c of tree.childrenOf.get(node.id) || []) out.push(...collect(c, tree, [...path, c.name]));
  return out;
}

// A node is a family member unless it is a bare root container ("BOILER"): a root with nothing of its own.
const listable = (n, tree) => !(n.parent_id == null && !(tree.itemsByNode.get(n.id) || []).length);

export async function getSubsystemFamilies() {
  const tree = await loadTree();
  const fam = new Map();
  for (const n of tree.nodes) {
    if (!listable(n, tree)) continue;
    const f = subsystemFamily(n.name);
    if (!f.key) continue;
    const all = collect(n, tree);
    const e = fam.get(f.key) || { key: f.key, label: f.label, projects: new Set(), nodes: 0, items: 0, unlinked: 0 };
    e.projects.add(n.project_id); e.nodes++; e.items += all.length; e.unlinked += all.filter(x => !x.item.item_id).length;
    fam.set(f.key, e);
  }
  return [...fam.values()].map(e => ({ ...e, projects: e.projects.size }))
    .sort((a, b) => b.projects - a.projects || a.label.localeCompare(b.label));
}

export async function getSubsystemMatrix(familyKey) {
  const tree = await loadTree();
  const members = tree.nodes.filter(n => listable(n, tree) && subsystemFamily(n.name).key === familyKey);
  if (!members.length) return null;
  const label = subsystemFamily(members[0].name).label;

  const projects = new Map();
  const rows = new Map();
  const configRows = new Map();
  for (const n of members) {
    const p = projects.get(n.project_id) || { id: n.project_id, project_no: n.project_no, series: n.series || '', capacity: n.model_capacity || '', nodes: 0, config: [] };
    p.nodes++; p.config.push(...parseConfig(n.config_json));
    projects.set(n.project_id, p);
    for (const { item, path } of collect(n, tree)) {
      const key = `${path.join(' > ')}|${item.item_id ? `item:${item.item_id}` : `text:${norm(item.material_description)}`}`;
      const r = rows.get(key) || { key, path: path.join(' › '), label: item.item_name || String(item.material_description || '').replace(/\s+/g, ' ').trim(),
        item_id: item.item_id || null, category: item.category || null, cells: {} };
      (r.cells[n.project_id] ||= []).push({ size_spec: String(item.size_spec ?? '').replace(/\s+/g, ' ').trim(), qty_text: String(item.qty_text ?? '').replace(/\s+/g, ' ').trim() });
      rows.set(key, r);
    }
  }
  for (const p of projects.values()) for (const c of p.config) {
    const r = configRows.get(c.label) || { label: c.label, cells: {} };
    r.cells[p.id] = `${c.value}${c.unit ? ' ' + c.unit : ''}`;
    configRows.set(c.label, r);
  }
  // a fact kept as configuration on one project and as an item on another (MOTOR RATING): flag it, the Design Head decides once
  const itemLabels = new Set([...rows.values()].map(r => norm(r.label)));
  const projList = [...projects.values()].sort((a, b) => a.series.localeCompare(b.series) || (parseFloat(a.capacity) || 0) - (parseFloat(b.capacity) || 0) || a.project_no.localeCompare(b.project_no));
  const itemRows = [...rows.values()].map(r => ({ ...r, count: Object.keys(r.cells).length, unlinked: !r.item_id }))
    .sort((a, b) => a.path.localeCompare(b.path) || b.count - a.count || a.label.localeCompare(b.label));
  return {
    family: { key: familyKey, label },
    projects: projList,
    configRows: [...configRows.values()].map(r => ({ ...r, count: Object.keys(r.cells).length, alsoItem: ((w) => w.length >= 4 && [...itemLabels].some(l => l.startsWith(w)))(norm(r.label).split(' ')[0])}))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    rows: itemRows,
  };
}
