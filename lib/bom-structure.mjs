// lib/bom-structure.mjs — pure computation for STERP items 16-19 (§5o: Multi-Level BOM roll-up,
// Where-Used/Common-Uncommon identity matching, ECN/Purchase-Return transition guards). Split out
// from lib/data.js and the API routes so plain `node` can load and self-check it, same precedent
// as lib/bom-fields.mjs.
//
// categoryWeightKg only ever imports lib/piece-weight.js, which has zero imports of its own —
// safe to pull in here without breaking this file's plain-`node` self-checkability, same guarantee
// the normalizeMaterial comment below is protecting for remnant-match.js.
import { categoryWeightKg, categoryShapeSpec } from './section-shapes.js';

// normalizeMaterial is inlined (not imported from lib/remnant-match.js, which has the identical
// one-line function) because remnant-match.js pulls in lib/db.js's whole Turso client at import
// time — that would break plain-`node` self-checkability for the sake of a one-line dedupe.
function normalizeMaterial(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Roll-up qty for one assembly = product of qty up its parent chain, times the project's own
// Whole-BOM Unit Count (a separate, always-on multiplier — see lib/db.js's projects.unit_count
// comment — folded in here as just one more factor rather than a second calculation elsewhere).
// `byId` is a Map<id, assembly> (assembly = {id, parent_id, qty}). `projectMultiplier` defaults to
// 1 so every pre-existing call site (all node-only, from before this multiplier existed) keeps
// behaving exactly as before.
export function rollupQty(assemblyId, byId, projectMultiplier = 1) {
  let mult = Number(projectMultiplier) || 1;
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
// `resolved` (bom_items.qty_resolved) marks a row whose qty_text is already a final physical count
// — the remainder of a partial match/reservation split, or its reserved-portion clone — never a
// per-instance base figure to multiply again. Every real call site passes it; only the self-check's
// own hand-built fixtures omit it (defaulting false = today's ordinary, never-split row).
export function itemRollupQty(qtyText, assemblyId, byId, projectMultiplier = 1, resolved = false) {
  const m = String(qtyText || '').match(/^\s*([\d.]+)/);
  if (!m) return null;
  return resolved ? Number(m[1]) : Number(m[1]) * rollupQty(assemblyId, byId, projectMultiplier);
}

// Human-readable "<total> <unit> = <base> <unit> × <mult>" breakdown for one item's rolled-up
// quantity — shown wherever a multiplied number flows into real Procurement/Stores/Dispatch
// quantities, so a multiplier is never silently unexplained on screen. Null when there's nothing
// to explain (multiplier is 1, `resolved` (no multiplier ever applies to it), or qty_text doesn't
// parse) — callers render nothing extra then, same as today.
export function qtyBreakdown(qtyText, assemblyId, byId, projectMultiplier = 1, resolved = false) {
  if (resolved) return null;
  const mult = rollupQty(assemblyId, byId, projectMultiplier);
  if (mult === 1) return null;
  const rolled = itemRollupQty(qtyText, assemblyId, byId, projectMultiplier, resolved);
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

// A row whose own active-reservation total already covers its own resolved quantity (rollup
// multiplier already applied — comparing against a raw qty_text parse would be wrong for a
// multi-unit-split line reserved in full with no shortfall) is stock Stores already has in hand
// for this line, not something Procurement still needs to source. lib/procurement.js's
// reserveFromStock always points the resulting inventory_reservations row at the exact bom_items
// row it fulfilled (the split-off clone when a shortfall remained, or the original row itself on a
// full no-shortfall reservation) — so this is reading back a real, already-correct number, not a
// heuristic. Small epsilon matches the float-rounding guard lib/procurement.js's own
// batch-allocation code already uses (allocShortfall > 0.0001).
export function isFullyReservedFromStock(resolvedQty, reservedQty) {
  return resolvedQty > 0 && (reservedQty || 0) >= resolvedQty - 0.0001;
}

// One row's own "real quantity that matters right now" — qty_breakdown.total when a rollup
// multiplier applies, else the raw leading number of qty_text (qtyBreakdown itself returns null
// exactly when that leading number already IS the resolved figure: resolved=true, or mult===1).
function resolveRowQty(row) {
  if (row.qty_breakdown) return row.qty_breakdown.total;
  const m = String(row.qty_text || '').match(/^\s*([\d.]+)/);
  return m ? Number(m[1]) : 0;
}

function resolveRowUnit(row) {
  if (row.qty_breakdown) return row.qty_breakdown.unit;
  const m = String(row.qty_text || '').match(/^\s*[\d.]+\s*(.*)$/);
  return (m ? m[1] : '').trim();
}

// Groups getSourcingItems()'s flat rows by their shared PR line (pr_item_id — set once per project
// split by the unified PR flow, Group 5 Bundle A). Rows with no pr_item_id (PMB import, free-hand
// adds) are dropped — nothing to aggregate. The group's own MOC/common spec are read from the PR
// header (pr_items — getSourcingItems()'s pr_item_moc/pr_item_category_fields_json columns), the
// real backend record of what's being bought, written once at raise time — never re-derived by
// picking one project's own bom_items row, which stays independently editable afterward and is
// therefore not a reliable stand-in for the group's shared spec. Each project's own row is compared
// against that header record to detect real drift.
export function aggregatePrGroups(items) {
  const groups = new Map();
  for (const it of items) {
    if (!it.pr_item_id) continue;
    if (!groups.has(it.pr_item_id)) groups.set(it.pr_item_id, []);
    groups.get(it.pr_item_id).push(it);
  }

  const out = [];
  for (const [prItemId, rows] of groups) {
    // Already-covered-from-stock constituents (isFullyReservedFromStock) are still listed (for the
    // UI's own "already reserved, not counted" label) but excluded from every sum/representative
    // pick below.
    const constituents = rows.map(r => {
      const resolvedQty = resolveRowQty(r);
      return { ...r, resolved_qty: resolvedQty, excluded: isFullyReservedFromStock(resolvedQty, r.reserved_qty) };
    });
    const sourcing = constituents.filter(c => !c.excluded);
    // material_description/pr_no/pr_created_at/category still come off a real bom_items row — always
    // a still-needs-sourcing constituent when one exists, never a stock-reserved row whose own specs
    // are moot to the actual sourcing decision. Falls back to the first constituent only when every
    // row in the group is already reserved (nothing left to represent for sourcing purposes).
    const representative = sourcing[0] || constituents[0];

    // Common spec/MOC — read from pr_items (the PR header row), the actual backend record of "what
    // material is this line buying," written once at raise time and shared by construction across
    // every project split under it. NOT re-derived by picking one project's own bom_items row and
    // stripping fields back out — that row can be edited independently afterward (BomTable's normal
    // per-line edit), so it's not a reliable stand-in for the group's own recorded common spec; it's
    // exactly the class of "picked, not sourced" fragility a representative-row approach has. Falls
    // back to the representative constituent's own fields only for the rare case pr_items itself has
    // nothing recorded (a pre-unified-flow row, or a header whose own fields were never set).
    const commonMoc = representative.pr_item_moc || representative.moc;
    let commonSpec = '';
    const headerFieldsJson = representative.pr_item_category_fields_json || representative.category_fields_json;
    if (headerFieldsJson) {
      try {
        const fields = JSON.parse(headerFieldsJson);
        if (fields) commonSpec = categoryShapeSpec(representative.category, fields);
      } catch { /* malformed, leave blank */ }
    }

    let totalQty = 0, unit = null, unitMismatch = false;
    for (const c of sourcing) {
      totalQty += c.resolved_qty;
      const u = resolveRowUnit(c);
      if (unit == null) unit = u;
      else if (u !== unit) unitMismatch = true;
    }

    // Spec drift — does this project's own row still agree with the group's recorded common spec?
    // Compares MOC and the *shape-only* spec (never the full size_spec, which legitimately includes
    // this project's own Length/Width and is expected to differ project to project — comparing full
    // size_spec would flag drift on every normal multi-project plate/tube line, not just real
    // anomalies). A constituent whose own category diverges (rare — category isn't editable per
    // project in the composer, but a direct API/import edit could still do it) also counts.
    let specDrift = false;
    for (const c of sourcing) {
      let cShape = '';
      if (c.category_fields_json) {
        try {
          const fields = JSON.parse(c.category_fields_json);
          if (fields) cShape = categoryShapeSpec(c.category, fields);
        } catch { /* malformed — treated as blank, compared like any other mismatch */ }
      }
      if (normalizeMaterial(c.moc) !== normalizeMaterial(commonMoc)
        || normalizeMaterial(cShape) !== normalizeMaterial(commonSpec)
        || c.category !== representative.category) {
        specDrift = true;
        break;
      }
    }

    // Aggregated *demand*, never a fictitious combined stock item — real per-constituent figures
    // summed, each using that constituent's OWN dimensions (constituents can genuinely differ, a
    // 2000x1000x10mm plate for one project vs 1500x800x12mm for another — a single per-unit figure
    // applied to the combined qty would be mathematically wrong, same reasoning for area/length as
    // for weight). Weight always sums (every dimensional category has a real per-unit weight).
    // Plate additionally gets total net area (Σ L x W x qty, m²) — the real "how much sheet do we
    // need" figure, since its two per-instance dimensions (Length, Width) multiply into an area, not
    // a length. Every other dimensional category (round/square/octagonal/flat/angle/beam/channel/
    // pipe/tee) has exactly one per-instance dimension (Length), so its analogous aggregate is total
    // length (Σ length x qty, m) — "how many metres do we need." Neither total claims one physical
    // piece of that combined size exists; which real stock size(s) to actually buy and how to cut
    // them is a downstream Procurement/Stores decision, not computed here. Both stay null when
    // nothing sourced has parseable dimensions (same "no opinion" shape as weight).
    const isPlate = representative.category === 'plate';
    let totalWeightKg = 0, anyWeight = false;
    let totalAreaSqm = 0, anyArea = false;
    let totalLengthM = 0, anyLength = false;
    for (const c of sourcing) {
      if (!c.category_fields_json) continue;
      let fields = null;
      try { fields = JSON.parse(c.category_fields_json); } catch { continue; /* malformed, skip */ }
      if (!fields) continue;
      const perUnit = categoryWeightKg(c.category, fields);
      if (perUnit > 0) { totalWeightKg += perUnit * c.resolved_qty; anyWeight = true; }
      if (isPlate) {
        if (Number(fields.length) > 0 && Number(fields.width) > 0) {
          totalAreaSqm += (Number(fields.length) / 1000) * (Number(fields.width) / 1000) * c.resolved_qty;
          anyArea = true;
        }
      } else if (Number(fields.length) > 0) {
        totalLengthM += (Number(fields.length) / 1000) * c.resolved_qty;
        anyLength = true;
      }
    }

    out.push({
      pr_item_id: prItemId, pr_no: representative.pr_no, pr_created_at: representative.pr_created_at,
      material_description: representative.material_description, moc: commonMoc, size_spec: representative.size_spec,
      category: representative.category, category_fields_json: representative.category_fields_json,
      common_spec: commonSpec,
      total_qty: Number(totalQty.toFixed(4)), unit: unit || '',
      total_weight_kg: anyWeight ? Number(totalWeightKg.toFixed(2)) : null,
      total_area_sqm: anyArea ? Number(totalAreaSqm.toFixed(3)) : null,
      total_length_m: anyLength ? Number(totalLengthM.toFixed(3)) : null,
      unit_mismatch: unitMismatch, spec_drift: specDrift,
      sourcing_bom_item_ids: sourcing.map(c => c.id),
      constituents,
    });
  }
  return out;
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
        // Previously never captured here at all (found auditing this round) — a template-
        // materialized item always silently reverted to the column's own DB default (1) regardless
        // of the source line's real value, inconsistent with the assembly-node duplicate route,
        // which already copies this field correctly.
        requires_manufacturing: it.requires_manufacturing,
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
