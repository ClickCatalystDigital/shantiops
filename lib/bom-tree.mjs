// lib/bom-tree.mjs — pure client-safe helpers for the BOM workspace tree (Phase 2). No DB import,
// same self-checkable-by-plain-node convention as lib/bom-fields.mjs/lib/bom-structure.mjs.
import { normalizeWords } from './match-utils.js';

// Suggested node_type labels — never enforced server-side (bom_assemblies.node_type is free TEXT,
// deliberately not a DB enum, per the explicit instruction not to hard-code the hierarchy). The UI
// presents these as a real select-first list with an "Other — type your own" escape hatch, rather
// than a symmetric pick-or-type field, to keep the common case consistent without constraining the
// database.
export const NODE_TYPE_SUGGESTIONS = ['System', 'Subsystem', 'Assembly', 'Sub-assembly', 'Component'];

// A node past this many ancestor levels gets a soft "getting deep" cue in the UI — never a hard
// block (bom_assemblies has no depth limit, by design, matching "no depth limit exists today").
export const SOFT_DEPTH_WARNING = 5;

// Builds a parent_id -> children[] map from a flat assemblies array, same shape the current
// BomStructureTab already builds inline — extracted here so both the tree renderer and the
// search/depth helpers below share one grouping pass.
export function groupByParent(assemblies) {
  const byParent = new Map();
  for (const a of assemblies) {
    const key = a.parent_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(a);
  }
  return byParent;
}

// Depth of a node (root = 0), walking up via a Map<id, assembly>.
export function nodeDepth(assemblyId, byId) {
  let depth = 0;
  let a = byId.get(assemblyId);
  while (a && a.parent_id != null) { depth++; a = byId.get(a.parent_id); }
  return depth;
}

// Breadcrumb path from root to this node, as an array of names (root first). Matches the "System >
// Boiler Shell > Feedwater Subsystem" header the detail panel shows.
export function nodePath(assemblyId, byId) {
  const path = [];
  let a = byId.get(assemblyId);
  while (a) { path.unshift(a.name); a = a.parent_id != null ? byId.get(a.parent_id) : null; }
  return path;
}

// Deterministic type suggestion — name keywords win first (an explicit "Sub-assembly"/"Assembly"/
// "System"/"Subsystem"/"Component" in the name is a stronger signal than position), falling back to
// depth-in-the-tree otherwise (root=System, ... deepest=Component). No LLM, no backend
// classification service — just keyword/depth rules, same "computed, never stored" spirit as
// roll-up qty. Only ever a *suggestion*: the caller pre-fills it into node_type at creation time,
// and the user can still change it afterward via the Overview tab's own Type control.
const NAME_TYPE_HINTS = [
  [/\bsub[\s-]?assembl/i, 'Sub-assembly'],
  [/\bassembl/i, 'Assembly'],
  [/\bsub[\s-]?system/i, 'Subsystem'],
  [/\bsystem\b/i, 'System'],
  [/\bcomponent\b/i, 'Component'],
];
export function suggestNodeType(name, depth) {
  const n = String(name || '');
  for (const [re, type] of NAME_TYPE_HINTS) {
    if (re.test(n)) return type;
  }
  const i = Math.max(0, Math.min(depth, NODE_TYPE_SUGGESTIONS.length - 1));
  return NODE_TYPE_SUGGESTIONS[i];
}

// Ranks a flat item list by keyword overlap against a node's own name + ancestor path — the
// "only show relevant items" ask for the Assign-existing-item picker. Reuses the same
// keyword-overlap primitive Stores'/QC's own possible-match badges already trust
// (lib/match-utils.js's normalizeWords), not a new matching algorithm; deliberately never hides a
// non-matching item (same "suggest, never hide" precedent as possibleMatches() elsewhere in this
// app) — a zero-keyword-overlap item just sorts to the end, still reachable by typing.
export function rankItemsByRelevance(pathNames, items, textFields = ['material_description', 'section', 'group_label']) {
  const keywords = new Set(normalizeWords(pathNames.join(' ')));
  if (keywords.size === 0) return items;
  return [...items]
    .map(it => {
      const words = new Set(normalizeWords(textFields.map(f => it[f]).join(' ')));
      let score = 0;
      for (const w of keywords) if (words.has(w)) score++;
      return { it, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ it }) => it);
}

// Search-with-location-reveal (the tree brief's explicit requirement — a search hit must show
// where it lives, not just a flat unrelated list). Returns the set of assembly ids that must be
// expanded for every match (by name) to be visible: every match itself plus every one of its
// ancestors. Case-insensitive substring match, same convention as every other search box in this
// app (SearchableSelect, WorkspaceSidebar's groups search).
export function expandedIdsForSearch(query, assemblies, byId) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return new Set();
  const expand = new Set();
  for (const a of assemblies) {
    if (!a.name.toLowerCase().includes(q)) continue;
    let cur = a;
    while (cur) {
      expand.add(cur.id);
      cur = cur.parent_id != null ? byId.get(cur.parent_id) : null;
    }
  }
  return expand;
}

// Same ancestor-walk shape as expandedIdsForSearch, but for the READ-ONLY Final BOM card's own
// search (components/bom-structure/BomTreeReadOnly.jsx) — matches against each node's own items[]
// (material_description / catalog_item_code / "BM-{id}") instead of the node's name, since items
// are what's most likely being searched for in a 300+-line BOM. Kept as a separate function rather
// than broadening expandedIdsForSearch itself, which the EDITABLE tree's own already-shipped search
// depends on unchanged. Returns both the ancestor-expand set (so a hit's whole chain stays visible)
// and the smaller set of node ids whose OWN items matched (so the caller only needs to un-hide
// items on nodes that actually need it, not every node in the expand chain).
export function itemMatchAncestorIds(query, assemblies, byId) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return { expandIds: new Set(), matchingNodeIds: new Set() };
  const expandIds = new Set();
  const matchingNodeIds = new Set();
  for (const a of assemblies) {
    const hasMatch = (a.items || []).some(it =>
      (it.material_description || '').toLowerCase().includes(q) ||
      (it.catalog_item_code || '').toLowerCase().includes(q) ||
      (it.pr_no || it.pr_ref || '').toLowerCase().includes(q) ||
      `bm-${it.id}`.includes(q)
    );
    if (!hasMatch) continue;
    matchingNodeIds.add(a.id);
    let cur = a;
    while (cur) {
      expandIds.add(cur.id);
      cur = cur.parent_id != null ? byId.get(cur.parent_id) : null;
    }
  }
  return { expandIds, matchingNodeIds };
}
