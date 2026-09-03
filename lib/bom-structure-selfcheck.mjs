// lib/bom-structure-selfcheck.mjs — runnable check for lib/bom-structure.mjs (repo has no JS test
// framework; mirrors lib/pmb-selfcheck.mjs's precedent).
//   node lib/bom-structure-selfcheck.mjs
import assert from 'node:assert';
import {
  rollupQty, itemRollupQty, qtyBreakdown, partIdentityKey, canDecideChangeNote, shouldAdjustStock, wouldCreateCycle,
  buildTemplateTree, flattenTemplateTree, computeTemplateCounts,
} from './bom-structure.mjs';

function selfcheck() {
  // --- Multi-Level BOM roll-up (STERP item 16) ---
  // Boiler (top, qty 1) -> ID Fan assembly (qty 2, i.e. two fans per boiler) -> Drive sub-assembly
  // (qty 1 per fan). A bolt at Drive level with qty_text "3 Nos" should roll up to 1*2*1*3 = 6.
  const assemblies = new Map([
    [1, { id: 1, parent_id: null, qty: 1 }],   // Boiler
    [2, { id: 2, parent_id: 1, qty: 2 }],       // ID Fan (x2 per boiler)
    [3, { id: 3, parent_id: 2, qty: 1 }],       // Drive sub-assembly (x1 per fan)
  ]);
  assert.strictEqual(rollupQty(1, assemblies), 1);
  assert.strictEqual(rollupQty(2, assemblies), 2);
  assert.strictEqual(rollupQty(3, assemblies), 2);
  assert.strictEqual(itemRollupQty('3 Nos', 3, assemblies), 6);
  assert.strictEqual(itemRollupQty('As per drawing', 3, assemblies), null, 'non-numeric qty_text must not fabricate a number');
  assert.strictEqual(itemRollupQty('2 Mtrs', 999, assemblies), 2, 'an assembly not in the map rolls up as multiplier 1 (top-level default)');

  // --- Multi-unit quantity multiplier breakdown ---
  assert.strictEqual(qtyBreakdown('3 Nos', 1, assemblies), null, 'multiplier 1 (top-level Boiler) explains nothing');
  const idFanBreakdown = qtyBreakdown('3 Nos', 3, assemblies); // Drive: multiplier 2 (via ID Fan x2)
  assert.deepStrictEqual(idFanBreakdown, { base: 3, mult: 2, total: 6, unit: 'Nos', label: '6 Nos = 3 Nos × 2' });
  assert.strictEqual(qtyBreakdown('As per drawing', 3, assemblies), null, 'non-numeric qty_text explains nothing, even under a real multiplier');
  const noUnit = qtyBreakdown('3', 3, assemblies);
  assert.strictEqual(noUnit.label, '6 = 3 × 2', 'no unit suffix -> no stray trailing space');

  // --- Whole-BOM Unit Count (project-level multiplier, layered on top of the per-node one) ---
  // Drive (node multiplier 2, from ID Fan x2) under a project with unit_count=50: combined must be
  // 2*50=100, never 2 or 50 alone, and it must apply even to a node whose OWN qty stays at 1
  // (the common real case — e.g. Boiler itself, project-wide multiplier only).
  assert.strictEqual(rollupQty(1, assemblies, 50), 50, 'a project-only multiplier still applies to a node with its own qty=1');
  assert.strictEqual(rollupQty(3, assemblies, 50), 100, 'node chain (x2) times project unit_count (x50) = 100, not 2 or 50 alone');
  assert.strictEqual(itemRollupQty('4 Nos', 3, assemblies, 50), 400, '4 Nos per instance x combined multiplier 100 = 400');
  const combined = qtyBreakdown('2 Mtrs', 3, assemblies, 50);
  assert.deepStrictEqual(combined, { base: 2, mult: 100, total: 200, unit: 'Mtrs', label: '200 Mtrs = 2 Mtrs × 100' });
  assert.strictEqual(qtyBreakdown('3 Nos', 1, assemblies, 1), null, 'unit_count=1 (default) explains nothing, same as before this multiplier existed');
  assert.strictEqual(rollupQty(1, assemblies), 1, 'omitting projectMultiplier entirely still defaults to 1 -- pre-existing callers unaffected');

  // --- Split-qty double-counting fix (qty_resolved) ---
  // Drive (node multiplier 2) with unit_count=50 (combined 100) -- a FRESH "4 Nos" line correctly
  // rolls up to 400. Once that same text is marked resolved (as a split remainder/clone would be),
  // the identical multiplier context must be completely ignored -- the whole point of the flag.
  assert.strictEqual(itemRollupQty('4 Nos', 3, assemblies, 50, false), 400, 'unresolved: full multiplier chain applies, as before');
  assert.strictEqual(itemRollupQty('4 Nos', 3, assemblies, 50, true), 4, 'resolved: qty_text read as-is, no multiplier applied at all -- this is the actual bug fix');
  assert.strictEqual(qtyBreakdown('4 Nos', 3, assemblies, 50, true), null, 'a resolved row has nothing to explain -- no breakdown shown, since no multiplier was applied');
  assert.notStrictEqual(qtyBreakdown('4 Nos', 3, assemblies, 50, false), null, 'sanity check: the same row unresolved still shows its breakdown (confirms the two calls above differ only by the flag)');

  // --- Where-Used / Common-Uncommon identity (STERP items 17-18) ---
  const catalogRow = { item_id: 42, material_description: 'MS Angle 50x50x5', moc: 'MS', size_spec: '50x50x5' };
  const sameCatalogDifferentText = { item_id: 42, material_description: 'MS ANGLE (different casing)', moc: 'MS', size_spec: '50x50x5' };
  const freeTypedMatch = { item_id: null, material_description: 'MS Angle 50x50x5', moc: 'MS', size_spec: '50X50X5' };
  const freeTypedNoMatch = { item_id: null, material_description: 'MS Angle 50x50x5', moc: 'MS', size_spec: '40x40x5' };
  const noIdentity = { item_id: null, material_description: '', moc: '', size_spec: '' };

  assert.strictEqual(partIdentityKey(catalogRow), partIdentityKey(sameCatalogDifferentText),
    'two catalog-linked rows with the same item_id must match regardless of free-text drift');
  assert.notStrictEqual(partIdentityKey(catalogRow), partIdentityKey(freeTypedMatch),
    'an item_id row must never cross-match a string-only row, even with identical text');
  assert.strictEqual(partIdentityKey(freeTypedMatch), partIdentityKey({ ...freeTypedMatch, material_description: 'ms angle 50x50x5  ' }),
    'string identity is case/whitespace-insensitive (normalizeMaterial)');
  assert.notStrictEqual(partIdentityKey(freeTypedMatch), partIdentityKey(freeTypedNoMatch));
  assert.strictEqual(partIdentityKey(noIdentity), null, 'a blank row has no identity and must be excluded');

  // --- Reparent cycle guard (BOM workspace Phase 2) ---
  assert.strictEqual(wouldCreateCycle(2, 3, assemblies), true, 'moving ID Fan (2) under its own descendant Drive (3) must be rejected');
  assert.strictEqual(wouldCreateCycle(2, 2, assemblies), true, 'a node cannot become its own parent');
  assert.strictEqual(wouldCreateCycle(3, 1, assemblies), false, 'moving Drive under Boiler (an ancestor, not a descendant) is fine');
  assert.strictEqual(wouldCreateCycle(1, null, assemblies), false, 'moving to top-level (null parent) is always fine');
  assert.strictEqual(wouldCreateCycle(1, 999, assemblies), false, 'an unrelated/unknown candidate parent is not a cycle');

  // --- ECN approve/reject guard (STERP item 19) ---
  assert.strictEqual(canDecideChangeNote('pending'), true);
  assert.strictEqual(canDecideChangeNote('approved'), false, 'an already-approved note cannot be decided again');
  assert.strictEqual(canDecideChangeNote('rejected'), false);

  // --- Purchase Return stock-decrement guard (STERP item 13) ---
  assert.strictEqual(shouldAdjustStock('removed_from_stock', 'none'), true, 'fresh transition into removed_from_stock adjusts stock');
  assert.strictEqual(shouldAdjustStock('removed_from_stock', 'removed_from_stock'), false, 're-saving an already-applied return must not double-decrement');
  assert.strictEqual(shouldAdjustStock('replaced', 'none'), false, 'a non-stock-affecting action never adjusts stock');

  // --- Structure Templates: build/flatten/count round-trip ---
  // A "Feed Line" subsystem template: 2 root items directly, no child nodes — the common flat case.
  const flatRoots = [{ id: 10, name: 'Feed Line', node_type: 'Subsystem', qty: 1 }];
  const flatChildren = new Map();
  const flatItems = new Map([[10, [
    { material_description: 'PIPE', moc: 'C.S-SMLS', size_spec: 'SCH-40', qty_text: '2 Mtrs', category: null, category_fields_json: null, item_id: null },
    {
      material_description: 'FUSIBLE PLUG', moc: 'BRONZE', size_spec: '1"', qty_text: '1 No',
      make: 'ZOLOTO / RUSHAS', remarks: 'Set Pressure I & II: 7 KG/CM2(G) each.',
      category: null, category_fields_json: null, named_parts_json: '["A","B"]', item_id: 1799,
      requires_heat_no: 1, requires_mtc: 1, requires_supplier_batch: 0, requires_serial_no: 0,
    },
  ]]]);
  const flatTree = buildTemplateTree(flatRoots, flatChildren, flatItems);
  assert.strictEqual(flatTree.length, 1);
  assert.strictEqual(flatTree[0].items.length, 2);
  assert.strictEqual(flatTree[0].children.length, 0);
  // make/remarks/named_parts_json/traceability flags must survive the capture — these were silently
  // dropped before (found by direct question, not by testing) and are real engineering-judgment
  // data, not decorative.
  assert.strictEqual(flatTree[0].items[1].make, 'ZOLOTO / RUSHAS', 'make must be captured');
  assert.strictEqual(flatTree[0].items[1].remarks, 'Set Pressure I & II: 7 KG/CM2(G) each.', 'remarks must be captured');
  assert.strictEqual(flatTree[0].items[1].named_parts_json, '["A","B"]', 'named_parts_json must be captured');
  assert.strictEqual(flatTree[0].items[1].requires_mtc, 1, 'traceability flags must be captured');
  assert.strictEqual(flatTree[0].items[1].requires_serial_no, 0);
  const flatCounts = computeTemplateCounts(flatTree);
  assert.strictEqual(flatCounts.nodeCount, 1);
  assert.strictEqual(flatCounts.itemCount, 2);
  assert.strictEqual(flatCounts.rootCount, 1, 'a single-node save has exactly one root');
  const flatFlattened = flattenTemplateTree(flatTree);
  assert.strictEqual(flatFlattened.length, 1, 'one node, no children');
  assert.strictEqual(flatFlattened[0].tempParentId, null, 'a template root has no temp parent');
  assert.strictEqual(flatFlattened[0].items.length, 2);
  assert.strictEqual(flatFlattened[0].items[1].make, 'ZOLOTO / RUSHAS', 'flatten must not drop the new fields either');

  // Whole-BOM (multi-root) template: a project with 2 top-level Systems saved together in one
  // capture (save-bom-as-template) — rootCount must reflect the real number of top-level entries,
  // not always 1, since "Build from Templates"/insertTemplateTree rely on this to distinguish a
  // whole-BOM template from a single-System one.
  const multiRoots = [
    { id: 20, name: 'BOILER', node_type: 'System', qty: 1 },
    { id: 21, name: 'CHIMNEY', node_type: 'System', qty: 1 },
  ];
  const multiTree = buildTemplateTree(multiRoots, new Map(), new Map());
  assert.strictEqual(multiTree.length, 2);
  assert.strictEqual(computeTemplateCounts(multiTree).rootCount, 2, 'a whole-BOM capture reports every top-level root');
  const multiFlattened = flattenTemplateTree(multiTree);
  assert.strictEqual(multiFlattened.length, 2);
  assert.ok(multiFlattened.every(e => e.tempParentId === null), 'every root of a whole-BOM template is parent-less, applied at the project root');

  // A "Boiler" System template: 2 Subsystem children, one of which itself has 1 item and the other
  // has none — the real multi-level case (mirrors this session's actual Boiler tree).
  const nestedRoots = [{ id: 1, name: 'Boiler', node_type: 'System', qty: 1 }];
  const nestedChildren = new Map([
    [1, [{ id: 2, name: 'Shell & Body', node_type: 'Subsystem', qty: 1 }, { id: 3, name: 'Feed Line', node_type: 'Subsystem', qty: 1 }]],
  ]);
  const nestedItems = new Map([[2, [{ material_description: 'BQ PLATE', moc: 'SA 516', size_spec: '8 THK', qty_text: '1 No', category: null, category_fields_json: null, item_id: null }]]]);
  const nestedTree = buildTemplateTree(nestedRoots, nestedChildren, nestedItems);
  assert.strictEqual(nestedTree[0].children.length, 2, 'Boiler has 2 Subsystem children');
  assert.strictEqual(nestedTree[0].items.length, 0, 'Boiler itself carries no items directly');
  assert.strictEqual(nestedTree[0].children[0].items.length, 1, 'Shell & Body carries its own item');
  assert.strictEqual(nestedTree[0].children[1].items.length, 0, 'Feed Line here carries none');
  const nestedCounts = computeTemplateCounts(nestedTree);
  assert.strictEqual(nestedCounts.nodeCount, 3, 'Boiler + 2 Subsystems = 3 nodes');
  assert.strictEqual(nestedCounts.itemCount, 1);
  const nestedFlattened = flattenTemplateTree(nestedTree);
  assert.strictEqual(nestedFlattened.length, 3);
  assert.strictEqual(nestedFlattened[0].tempParentId, null, 'Boiler (root) has no temp parent');
  const shellEntry = nestedFlattened.find(e => e.name === 'Shell & Body');
  const boilerEntry = nestedFlattened.find(e => e.name === 'Boiler');
  assert.strictEqual(shellEntry.tempParentId, boilerEntry.tempId, 'Shell & Body is parented under Boiler by temp id, not by name/order');
  // Parent-before-child ordering is what lets a caller build its idMap in one forward pass.
  assert.ok(nestedFlattened.indexOf(boilerEntry) < nestedFlattened.indexOf(shellEntry), 'a node always appears before its own children');

  console.log('lib/bom-structure.mjs self-check: all assertions passed.');
}

selfcheck();
