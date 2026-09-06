// Pure, dependency-free BOM-tree section resolution for Form IV A's lettered assembly grouping
// (SYSTEM.md's QC statutory-forms sync-accuracy plan, "Phase 3"). Given a project's flat
// bom_assemblies list (lib/data.js's getBomAssembliesFlat — {id, name, parent_id}, already ordered
// by sort_order/id) and a list of already-classified material parts (each carrying its own
// bom_items.assembly_id), groups parts into the real subsystem sections the reference sample's
// "A. Shell / B. Water Wall..." shape actually shows — never a hardcoded name, always derived from
// whatever the tree's own nodes are called. A project with an empty/no tree produces zero sections
// and every part lands in the ungrouped fallback — the exact same flat single-table output this
// generator already produced before this feature existed, so nothing regresses for a project that
// hasn't structured its BOM.
//
// Note for split (master/child) projects: `assemblies` and `parts[].assembly_id` are always sourced
// from a bom_item row's own project_id — which for a split child's QC document is already the
// MASTER's id (syncQcPartsFromBom always resolves the master's BOM for a child, SYSTEM.md §5bj) —
// so the caller doesn't need any master/child branching here; passing the right `assemblies` array
// in is the caller's job (see app/api/qc-documents/[id]/pdf/route.js).

// Climbs an item's ancestor chain to the first level below the tree's own root — its own node IS
// the section if it already sits directly on a root (a real, confirmed shape: SB-1109-01-50 has 3
// of its 5 roots with no children at all, items assigned straight to the root).
export function resolveSection(assemblyId, byId) {
  if (assemblyId == null) return null;
  const node = byId.get(assemblyId);
  if (!node) return null;
  if (node.parent_id == null) return node;
  let cur = node;
  while (byId.get(cur.parent_id)?.parent_id != null) cur = byId.get(cur.parent_id);
  return cur;
}

// A-Z, falling back to a plain number past Z — a safety valve, not an expected case (26 real
// sections on one boiler would be extraordinary).
function letterFor(i) { return i < 26 ? String.fromCharCode(65 + i) : String(i + 1); }

// The full candidate list of section nodes, in tree order. A root always joins the list itself —
// resolveSection() can return a root directly (an item assigned straight to it, even one that also
// has children — nothing in the tree UI prevents this) — followed by its own children, if any, each
// their own section. Real bug found and fixed here: an earlier version only ever included a root's
// CHILDREN when it had any, never the root itself — an item assigned directly to a root-with-
// children would resolve correctly via resolveSection() but then silently vanish from both the
// lettered sections AND the ungrouped fallback, since its bucket key never appeared in this
// candidate list at all. `buildLetteredSections`'s own `.filter(node => byNodeId.has(node.id))`
// already drops a root-with-children that ends up with zero directly-assigned items (the common,
// real-data case — SB-1109-01-50 has none), so including it here costs nothing when unused. Array
// order already reflects each node's real sort_order (getBomAssembliesFlat's own ORDER BY), so no
// re-sorting here.
function orderedSectionCandidates(assemblies) {
  const childrenByParent = new Map();
  for (const a of assemblies) {
    if (a.parent_id == null) continue;
    if (!childrenByParent.has(a.parent_id)) childrenByParent.set(a.parent_id, []);
    childrenByParent.get(a.parent_id).push(a);
  }
  const roots = assemblies.filter(a => a.parent_id == null);
  const out = [];
  for (const root of roots) out.push(root, ...(childrenByParent.get(root.id) || []));
  return out;
}

// Groups `parts` (each carrying its own `.assembly_id`) into lettered sections plus a trailing
// ungrouped bucket. Only sections that actually have >=1 part get a letter — no gaps like A, C, D
// if B turned out empty. Returns { sections: [{letter, name, parts}], ungrouped }.
export function buildLetteredSections(assemblies, parts) {
  const byId = new Map(assemblies.map(a => [a.id, a]));
  const byNodeId = new Map();
  const ungrouped = [];
  for (const p of parts) {
    const section = resolveSection(p.assembly_id, byId);
    if (!section) { ungrouped.push(p); continue; }
    if (!byNodeId.has(section.id)) byNodeId.set(section.id, []);
    byNodeId.get(section.id).push(p);
  }
  const candidates = orderedSectionCandidates(assemblies).filter(node => byNodeId.has(node.id));
  const sections = candidates.map((node, i) => ({ letter: letterFor(i), name: node.name, parts: byNodeId.get(node.id) }));
  return { sections, ungrouped };
}
