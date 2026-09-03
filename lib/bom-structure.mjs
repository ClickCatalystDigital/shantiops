// lib/bom-structure.mjs — pure computation for STERP items 16-19 (§5o: Multi-Level BOM roll-up,
// Where-Used/Common-Uncommon identity matching, ECN/Purchase-Return transition guards). Split out
// from lib/data.js and the API routes so plain `node` can load and self-check it, same precedent
// as lib/bom-fields.mjs.
//
// normalizeMaterial is inlined (not imported from lib/remnant-match.js, which has the identical
// one-line function) because remnant-match.js pulls in lib/db.js's whole Turso client at import
// time — that would break plain-`node` self-checkability for the sake of a one-line dedupe.
function normalizeMaterial(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Roll-up qty for one assembly = product of qty up its parent chain. `byId` is a Map<id, assembly>
// (assembly = {id, parent_id, qty}).
export function rollupQty(assemblyId, byId) {
  let mult = 1;
  let a = byId.get(assemblyId);
  while (a) { mult *= Number(a.qty) || 1; a = a.parent_id ? byId.get(a.parent_id) : null; }
  return mult;
}

// Reparent cycle guard (BOM workspace Phase 2) — true if `candidateParentId` is `nodeId` itself or
// any descendant of it, i.e. moving `nodeId` under `candidateParentId` would create a cycle. Same
// parent-chain walk shape as rollupQty, just starting from the proposed parent and walking up
// looking for nodeId instead of multiplying qty.
export function wouldCreateCycle(nodeId, candidateParentId, byId) {
  let cur = candidateParentId;
  while (cur != null) {
    if (cur === nodeId) return true;
    const a = byId.get(cur);
    cur = a ? a.parent_id : null;
  }
  return false;
}

// A BOM item's own qty_text ("2 Nos") times its assembly's roll-up multiplier. Null when qty_text
// doesn't start with a number — shown as-is, not guessed.
// ponytail: leading-number parse is the ceiling; a real UOM-aware parser is the upgrade path.
export function itemRollupQty(qtyText, assemblyId, byId) {
  const m = String(qtyText || '').match(/^\s*([\d.]+)/);
  if (!m) return null;
  return Number(m[1]) * rollupQty(assemblyId, byId);
}

// Human-readable "<total> <unit> = <base> <unit> × <mult>" breakdown for one item's rolled-up
// quantity — shown wherever a multiplied number flows into real Procurement/Stores/Dispatch
// quantities, so a multiplier is never silently unexplained on screen. Null when there's nothing
// to explain (multiplier is 1, or qty_text doesn't parse) — callers render nothing extra then,
// same as today.
export function qtyBreakdown(qtyText, assemblyId, byId) {
  const mult = rollupQty(assemblyId, byId);
  if (mult === 1) return null;
  const rolled = itemRollupQty(qtyText, assemblyId, byId);
  if (rolled == null) return null;
  const m = String(qtyText).match(/^\s*([\d.]+)\s*(.*)$/);
  const unit = m[2].trim();
  const fmt = n => Number(n.toFixed(4)).toString();
  return {
    base: Number(m[1]), mult, total: rolled, unit,
    label: `${fmt(rolled)}${unit ? ` ${unit}` : ''} = ${m[1]}${unit ? ` ${unit}` : ''} × ${fmt(mult)}`,
  };
}

// True when qty_text carries more than one numeric segment (e.g. "2 Nos 1 No 1 No") — itemRollupQty
// only ever uses the first one, so the roll-up total on a row like this is not the full picture.
// ponytail: a numeric-token count, same ceiling as itemRollupQty's own leading-number-only parse —
// a real fix needs a real UOM-aware parser, a separate bigger job.
export function hasAmbiguousQty(qtyText) {
  return (String(qtyText || '').match(/[\d.]+/g)?.length ?? 0) > 1;
}

// Bottom-up sum of known-weight-consumed (stock_pieces.weight_kg, real recorded cuts only —
// never scaled by rollupQty's multiplier, which is a fact about intended quantity, not about what
// has physically been cut) across a node's own items plus every descendant's items. `byId` is
// Map<id, assembly & {items}>. Returns {weight_kg, weight_items_known, weight_items_total} — snake
// case to match every other computed field this app attaches to a query row — so a partial figure
// is never shown without its own coverage count, at every level, not just the leaf.
export function sumKnownWeight(assemblyId, byId, childrenByParent) {
  const node = byId.get(assemblyId);
  if (!node) return { weight_kg: 0, weight_items_known: 0, weight_items_total: 0 };
  let weight_kg = 0, weight_items_known = 0, weight_items_total = 0;
  for (const it of node.items || []) {
    weight_items_total++;
    if (it.known_weight_kg != null) { weight_kg += it.known_weight_kg; weight_items_known++; }
  }
  for (const child of childrenByParent.get(assemblyId) || []) {
    const sub = sumKnownWeight(child.id, byId, childrenByParent);
    weight_kg += sub.weight_kg; weight_items_known += sub.weight_items_known; weight_items_total += sub.weight_items_total;
  }
  return { weight_kg, weight_items_known, weight_items_total };
}

// Hybrid part identity for Where-Used/Common-Uncommon: bom_items.item_id when set (exact,
// catalog-linked), normalized material_description+moc+size_spec fallback otherwise. An item_id
// row and a string-only row never match each other, even if their text happens to coincide.
export function partIdentityKey(row) {
  if (row.item_id) return `id:${row.item_id}`;
  const key = [row.material_description, row.moc, row.size_spec].map(normalizeMaterial).join('|');
  return key.replace(/\|+$/, '') ? `s:${key}` : null;
}

// ECN approve/reject guard: only a still-pending note may be decided (mirrors
// app/api/engineering-change-notes/[id]/route.js's own check).
export function canDecideChangeNote(status) {
  return status === 'pending';
}

// Purchase-return stock-decrement guard: only fires on the transition INTO removed_from_stock, so
// a later re-save (e.g. editing debit_note_ref) never double-decrements. Mirrors
// app/api/purchase-returns/[id]/route.js's own check (and sales-returns' credit-side mirror).
export function shouldAdjustStock(requestedAction, currentAction, targetAction = 'removed_from_stock') {
  return requestedAction === targetAction && currentAction !== targetAction;
}

// --- Structure Templates (hierarchy-level BOM templates) ---
// Three pure shape transforms shared by the save-as-template / apply-template routes. All DB
// querying/inserting stays in the route files themselves (same precedent
// app/api/bom-assemblies/[id]/duplicate/route.js already sets) — these only reshape already-fetched
// or already-parsed data, so they stay loadable by plain `node`.

// Turn a set of already-fetched root nodes (each `{id, name, node_type, qty}`) plus a
// `childrenByParent` map (Map<parent_id, node[]>, same shape lib/bom-tree.mjs's groupByParent
// already produces) and an `itemsByAssembly` map (Map<assembly_id, bom_items row[]>) into the
// nested JSON a template stores. Item fields are the same free-text spec + Item Master link +
// engineering-judgment fields bom_items itself carries — never procurement/receiving state (a
// template is reusable structure, not one project's purchasing history). `make` (supplier/brand)
// and `remarks` (e.g. a Safety Valve's real Set-Pressure note) are real data a template would
// otherwise silently drop; the four requires_* traceability flags capture a standing engineering
// judgment ("this line always needs an MTC") worth reusing, not re-deciding on every project.
// Callers are expected to have already ordered childrenByParent/itemsByAssembly by sort_order —
// this function preserves whatever order it's handed, it doesn't re-sort.
export function buildTemplateTree(rootNodes, childrenByParent, itemsByAssembly) {
  function nodeToJson(node) {
    return {
      name: node.name,
      node_type: node.node_type,
      qty: node.qty,
      items: (itemsByAssembly.get(node.id) || []).map(it => ({
        material_description: it.material_description,
        moc: it.moc,
        size_spec: it.size_spec,
        qty_text: it.qty_text,
        make: it.make,
        remarks: it.remarks,
        category: it.category,
        category_fields_json: it.category_fields_json,
        named_parts_json: it.named_parts_json,
        item_id: it.item_id,
        requires_heat_no: it.requires_heat_no,
        requires_mtc: it.requires_mtc,
        requires_supplier_batch: it.requires_supplier_batch,
        requires_serial_no: it.requires_serial_no,
      })),
      children: (childrenByParent.get(node.id) || []).map(nodeToJson),
    };
  }
  return rootNodes.map(nodeToJson);
}

// The reverse: flatten a template's nested tree_json into a parent-before-child ordered list, each
// entry tagged with a synthetic tempId and its tempParentId (null for a template root). A caller
// walks this list in order, inserting one real bom_assemblies row per entry and recording
// tempId -> real id as it goes — the exact idMap pattern duplicate/route.js already uses for a live
// subtree, just driven by JSON instead of a DB-fetched parent_id map.
export function flattenTemplateTree(treeJson) {
  const flat = [];
  let n = 0;
  function walk(nodes, tempParentId) {
    for (const node of nodes || []) {
      const tempId = n++;
      flat.push({
        tempId, tempParentId,
        name: node.name, node_type: node.node_type || null, qty: node.qty ?? 1,
        items: node.items || [],
      });
      walk(node.children, tempId);
    }
  }
  walk(treeJson, null);
  return flat;
}

// node_count/item_count/rootCount for a template's tree_json — walked fresh on every save (never
// trusted from the client) so the denormalized counts shown in the template list can never drift
// from reality. rootCount > 1 means a whole-BOM template (every top-level root of a project
// captured in one save, see save-bom-as-template) rather than a single node's own branch.
export function computeTemplateCounts(treeJson) {
  let nodeCount = 0, itemCount = 0;
  const rootCount = (treeJson || []).length;
  function walk(nodes) {
    for (const node of nodes || []) {
      nodeCount++;
      itemCount += (node.items || []).length;
      walk(node.children);
    }
  }
  walk(treeJson);
  return { nodeCount, itemCount, rootCount };
}
