// lib/bom-structure-selfcheck.mjs — runnable check for lib/bom-structure.mjs (repo has no JS test
// framework; mirrors lib/pmb-selfcheck.mjs's precedent).
//   node lib/bom-structure-selfcheck.mjs
import assert from 'node:assert';
import {
  rollupQty, itemRollupQty, qtyBreakdown, partIdentityKey, canDecideChangeNote, shouldAdjustStock, wouldCreateCycle,
  buildTemplateTree, flattenTemplateTree, computeTemplateCounts,
  isFullyReservedFromStock, aggregatePrGroups, humanizeAssemblyName,
} from './bom-structure.mjs';
import { categoryWeightKg } from './section-shapes.js';

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

  // --- humanizeAssemblyName (PMB/CSV import auto-build) — every case validated against SB-1108's
  // own real stored Excel headings, plus one real case from a second affected project. ---
  assert.strictEqual(humanizeAssemblyName('BOILER'), 'Boiler');
  assert.strictEqual(
    humanizeAssemblyName('BOILER  MOUNTING & FITTINGS @   W.P.:  10.54 Kg/cm^2'),
    'Boiler Mounting & Fittings',
    'exact match to a real hand-typed subsystem name elsewhere in this app'
  );
  assert.strictEqual(humanizeAssemblyName('FOR FEED LINE'), 'Feed Line', 'leading "for" is stripped');
  assert.strictEqual(humanizeAssemblyName('FOR BLOW DOWN LINE'), 'Blow Down Line');
  assert.strictEqual(humanizeAssemblyName('SDC'), 'Sdc', 'no acronym-preservation attempt — see the function\'s own comment for why');
  assert.strictEqual(humanizeAssemblyName('WPH'), 'Wph');
  assert.strictEqual(humanizeAssemblyName('FD FAN & ID FAN'), 'Fd Fan & Id Fan', '& and short real words are all just title-cased uniformly');
  assert.strictEqual(humanizeAssemblyName('NOZZLE:'), 'Nozzle', 'trailing punctuation is stripped after title-casing');
  assert.strictEqual(humanizeAssemblyName('  BOILER   '), 'Boiler', 'whitespace is collapsed and trimmed');
  assert.strictEqual(humanizeAssemblyName(''), '', 'blank input stays blank, never crashes');
  assert.strictEqual(humanizeAssemblyName(null), '', 'null input stays blank, never crashes');
  assert.strictEqual(
    humanizeAssemblyName('FIRE DOOR AND FIRE BARS & SUPPORT BARS'),
    'Fire Door and Fire Bars & Support Bars',
    'a real joiner word ("and") stays lowercase mid-string'
  );

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

  // --- isFullyReservedFromStock ---
  assert.strictEqual(isFullyReservedFromStock(30, 30), true, 'reservation exactly covering resolved qty is fully reserved');
  assert.strictEqual(isFullyReservedFromStock(30, 29.9999), true, 'small float rounding is tolerated (epsilon)');
  assert.strictEqual(isFullyReservedFromStock(30, 20), false, 'a partial reservation is not fully reserved');
  assert.strictEqual(isFullyReservedFromStock(0, 0), false, 'zero resolved qty never counts as fully reserved');

  // --- aggregatePrGroups: grouping ignores rows with no pr_item_id ---
  const plateFields = { length: 2000, width: 1000, thickness: 10, density: 7850 };
  const grouped = aggregatePrGroups([
    { id: 101, pr_item_id: 5, pr_no: 'PR-5', pr_created_at: '2026-01-01', material_description: 'BQ Plate',
      moc: 'SA 516 GR 70', size_spec: '10 mm', category: 'plate', category_fields_json: JSON.stringify(plateFields),
      qty_text: '5 Nos', reserved_qty: 0, qty_breakdown: null, project_id: 1 },
    { id: 102, pr_item_id: 5, pr_no: 'PR-5', pr_created_at: '2026-01-01', material_description: 'BQ Plate',
      moc: 'SA 516 GR 70', size_spec: '10 mm', category: 'plate', category_fields_json: JSON.stringify(plateFields),
      qty_text: '8 Nos', reserved_qty: 0, qty_breakdown: null, project_id: 2 },
    { id: 200, pr_item_id: null, material_description: 'PMB item', qty_text: '1 No', reserved_qty: 0, qty_breakdown: null, project_id: 3 },
  ]);
  assert.strictEqual(grouped.length, 1, 'the PMB row (no pr_item_id) never becomes its own group');
  assert.strictEqual(grouped[0].total_qty, 13, '5 + 8 = 13');
  assert.strictEqual(grouped[0].unit, 'Nos');
  assert.strictEqual(grouped[0].unit_mismatch, false);
  assert.strictEqual(grouped[0].spec_drift, false);
  assert.deepStrictEqual(grouped[0].sourcing_bom_item_ids, [101, 102]);
  const perUnitPlate = categoryWeightKg('plate', plateFields);
  const expectedWeight = Number((perUnitPlate * 5 + perUnitPlate * 8).toFixed(2));
  assert.strictEqual(grouped[0].total_weight_kg, expectedWeight, 'weight total = sum of each constituent\'s own per-unit weight x its own qty');

  // --- aggregatePrGroups: excludes a fully-stock-reserved constituent, but still lists it ---
  const angleFields = { size: 'ISA 50x50x5', kg_per_m: 3.77, length: 2000 };
  const withReserved = aggregatePrGroups([
    { id: 301, pr_item_id: 9, pr_no: 'PR-9', material_description: 'MS Angle', moc: 'MS', size_spec: 'ISA 50x50x5',
      category: 'angle', category_fields_json: JSON.stringify(angleFields), qty_text: '10 Nos', reserved_qty: 0, qty_breakdown: null, project_id: 1 },
    { id: 302, pr_item_id: 9, pr_no: 'PR-9', material_description: 'MS Angle', moc: 'MS', size_spec: 'ISA 50x50x5',
      category: 'angle', category_fields_json: JSON.stringify(angleFields), qty_text: '6 Nos', reserved_qty: 6, qty_breakdown: null, project_id: 2 },
  ]);
  assert.strictEqual(withReserved[0].total_qty, 10, 'the fully-reserved constituent (6 of 6) is excluded from the sum');
  assert.strictEqual(withReserved[0].constituents.length, 2, 'but still listed for the UI');
  assert.strictEqual(withReserved[0].constituents.find(c => c.id === 302).excluded, true);
  assert.strictEqual(withReserved[0].sourcing_bom_item_ids.includes(302), false);

  // --- aggregatePrGroups: a fully-reserved multi-unit-split row is excluded against its ROLLED
  // total, not its raw qty_text leading number (the split-qty double-counting class of bug). ---
  const withRolledReservation = aggregatePrGroups([
    { id: 701, pr_item_id: 17, material_description: 'Bolt', moc: 'MS', size_spec: 'M12', category: null, category_fields_json: null,
      qty_text: '2 Nos', reserved_qty: 100,
      qty_breakdown: { base: 2, mult: 50, total: 100, unit: 'Nos', label: '100 Nos = 2 Nos × 50' }, project_id: 1 },
  ]);
  assert.strictEqual(withRolledReservation[0].constituents[0].excluded, true,
    'reserved_qty=100 must be compared against the rolled total (100), not the raw leading number (2)');
  assert.strictEqual(withRolledReservation[0].total_qty, 0, 'fully covered — nothing left to source');

  // --- aggregatePrGroups: unit mismatch is flagged, never silently coerced ---
  const unitMismatchGroup = aggregatePrGroups([
    { id: 401, pr_item_id: 11, material_description: 'Gasket', moc: 'CAF', size_spec: '80 NB', category: null, category_fields_json: null,
      qty_text: '5 Nos', reserved_qty: 0, qty_breakdown: null, project_id: 1 },
    { id: 402, pr_item_id: 11, material_description: 'Gasket', moc: 'CAF', size_spec: '80 NB', category: null, category_fields_json: null,
      qty_text: '3 Pcs', reserved_qty: 0, qty_breakdown: null, project_id: 2 },
  ]);
  assert.strictEqual(unitMismatchGroup[0].unit_mismatch, true, 'Nos vs Pcs must be flagged, not silently summed as one unit');
  assert.strictEqual(unitMismatchGroup[0].total_qty, 8, 'the sum is still computed — shown, but flagged');

  // --- aggregatePrGroups: spec drift (a hand-edited constituent) is flagged, never trusted blindly ---
  const specDriftGroup = aggregatePrGroups([
    { id: 501, pr_item_id: 13, material_description: 'BQ Plate', moc: 'SA 516 GR 70', size_spec: '10 mm', category: 'plate', category_fields_json: null,
      qty_text: '2 Nos', reserved_qty: 0, qty_breakdown: null, project_id: 1 },
    { id: 502, pr_item_id: 13, material_description: 'BQ Plate', moc: 'SA 516 GR 60', size_spec: '10 mm', category: 'plate', category_fields_json: null,
      qty_text: '3 Nos', reserved_qty: 0, qty_breakdown: null, project_id: 2 },
  ]);
  assert.strictEqual(specDriftGroup[0].spec_drift, true, 'a diverged MOC on one constituent must be flagged, not silently taken from the first row alone');

  // --- aggregatePrGroups: per-constituent weight — a group whose projects genuinely have
  // different dimensions (the critical Plate/Tube case: 2000x1000x10mm vs 1500x800x12mm) must sum
  // each constituent's OWN per-unit weight x its own qty, never one representative dimension's
  // per-unit weight applied to the combined total. ---
  const plateFieldsA = { length: 2000, width: 1000, thickness: 10, density: 7850 };
  const plateFieldsB = { length: 1500, width: 800, thickness: 12, density: 7850 };
  const mixedDimsGroup = aggregatePrGroups([
    { id: 801, pr_item_id: 21, pr_no: 'PR-21', material_description: 'BQ Plate', moc: 'SA 516 GR 70',
      size_spec: '2000 x 1000 x 10 mm', category: 'plate', category_fields_json: JSON.stringify(plateFieldsA),
      qty_text: '5 Nos', reserved_qty: 0, qty_breakdown: null, project_id: 1 },
    { id: 802, pr_item_id: 21, pr_no: 'PR-21', material_description: 'BQ Plate', moc: 'SA 516 GR 70',
      size_spec: '1500 x 800 x 12 mm', category: 'plate', category_fields_json: JSON.stringify(plateFieldsB),
      qty_text: '3 Nos', reserved_qty: 0, qty_breakdown: null, project_id: 2 },
  ]);
  const expectedMixedWeight = Number(
    (categoryWeightKg('plate', plateFieldsA) * 5 + categoryWeightKg('plate', plateFieldsB) * 3).toFixed(2)
  );
  const wrongMixedWeight = Number((categoryWeightKg('plate', plateFieldsA) * 8).toFixed(2));
  assert.strictEqual(mixedDimsGroup[0].spec_drift, true, 'genuinely different per-project dimensions must be flagged as spec drift');
  assert.strictEqual(mixedDimsGroup[0].total_weight_kg, expectedMixedWeight,
    'weight must be summed per-constituent using each project\'s own dimensions');
  assert.notStrictEqual(mixedDimsGroup[0].total_weight_kg, wrongMixedWeight,
    'must NOT equal one representative dimension\'s per-unit weight x the combined total qty');

  // --- aggregatePrGroups: the representative (moc/size_spec/category shown on the group header)
  // must never be an excluded/stock-reserved row, even when it happens to be the first in
  // insertion order — its own specs are moot to the actual sourcing decision. ---
  const representativeGroup = aggregatePrGroups([
    { id: 901, pr_item_id: 23, pr_no: 'PR-23', material_description: 'BQ Plate', moc: 'SA 516 GR 60',
      size_spec: '9 mm', category: 'plate', category_fields_json: null,
      qty_text: '4 Nos', reserved_qty: 4, qty_breakdown: null, project_id: 1 }, // fully reserved, listed first
    { id: 902, pr_item_id: 23, pr_no: 'PR-23', material_description: 'BQ Plate', moc: 'SA 516 GR 70',
      size_spec: '10 mm', category: 'plate', category_fields_json: null,
      qty_text: '6 Nos', reserved_qty: 0, qty_breakdown: null, project_id: 2 }, // the real sourcing need
  ]);
  assert.strictEqual(representativeGroup[0].moc, 'SA 516 GR 70', 'group header moc must come from the still-needed constituent, not the reserved one listed first');
  assert.strictEqual(representativeGroup[0].size_spec, '10 mm', 'same for size_spec');
  assert.strictEqual(representativeGroup[0].spec_drift, false, 'with only one real sourcing constituent, there is nothing left to disagree with');

  // --- aggregatePrGroups: identical thickness, genuinely different L x W (the normal shape of a
  // real multi-project plate/tube PR line, now that the raise-PR form always captures each
  // project's own Length/Width) must NOT be flagged as spec drift — only a genuinely diverged
  // shape spec (thickness/diameter/moc) should. Also proves common_spec/total_area_sqm are correct
  // for this, the actual common case. ---
  const sameThicknessA = { length: 2000, width: 1000, thickness: 10, density: 7850 };
  const sameThicknessB = { length: 1500, width: 800, thickness: 10, density: 7850 };
  const prHeaderFields = JSON.stringify({ thickness: 10, density: 7850 }); // pr_items' own record — shape only, no L/W
  const normalMultiProject = aggregatePrGroups([
    { id: 1001, pr_item_id: 31, pr_no: 'PR-31', material_description: 'BQ Plate', moc: 'SA 516 GR 70',
      pr_item_moc: 'SA 516 GR 70', pr_item_category_fields_json: prHeaderFields,
      size_spec: '2000 x 1000 x 10 mm', category: 'plate', category_fields_json: JSON.stringify(sameThicknessA),
      qty_text: '1 No', reserved_qty: 0, qty_breakdown: null, project_id: 1 },
    { id: 1002, pr_item_id: 31, pr_no: 'PR-31', material_description: 'BQ Plate', moc: 'SA 516 GR 70',
      pr_item_moc: 'SA 516 GR 70', pr_item_category_fields_json: prHeaderFields,
      size_spec: '1500 x 800 x 10 mm', category: 'plate', category_fields_json: JSON.stringify(sameThicknessB),
      qty_text: '3 No', reserved_qty: 0, qty_breakdown: null, project_id: 2 },
  ]);
  assert.strictEqual(normalMultiProject[0].spec_drift, false,
    'same thickness, different L x W (the normal case) must not read as spec drift');
  assert.strictEqual(normalMultiProject[0].common_spec, '10 mm thick', 'common spec is shape-only, never leaks L/W');
  assert.strictEqual(normalMultiProject[0].total_qty, 4, '1 + 3 = 4');
  const expectedArea = Number(((2 * 1 * 1) + (1.5 * 0.8 * 3)).toFixed(3));
  assert.strictEqual(normalMultiProject[0].total_area_sqm, expectedArea, 'total area = sum of each project\'s own L x W x qty (m²)');
  assert.strictEqual(normalMultiProject[0].total_length_m, null, 'plate has no total_length_m — area is its aggregate, not length');

  // --- aggregatePrGroups: common spec/MOC come from the PR header (pr_items), not from re-deriving
  // them off whichever bom_items row happens to be picked as representative. Proven by making the
  // representative row's OWN fields (as if independently edited later, e.g. via BomTable) disagree
  // with the header — the header must win, and that disagreement must itself surface as drift. ---
  const staleRepresentativeGroup = aggregatePrGroups([
    { id: 1101, pr_item_id: 33, pr_no: 'PR-33', material_description: 'BQ Plate', moc: 'SA 516 GR 60', // edited after raise, now stale
      pr_item_moc: 'SA 516 GR 70', pr_item_category_fields_json: JSON.stringify({ thickness: 10, density: 7850 }),
      size_spec: '2000 x 1000 x 8 mm', category: 'plate', category_fields_json: JSON.stringify({ length: 2000, width: 1000, thickness: 8, density: 7850 }),
      qty_text: '1 No', reserved_qty: 0, qty_breakdown: null, project_id: 1 },
  ]);
  assert.strictEqual(staleRepresentativeGroup[0].moc, 'SA 516 GR 70', 'group header moc comes from pr_items, not the (edited, stale) bom_items row');
  assert.strictEqual(staleRepresentativeGroup[0].common_spec, '10 mm thick', 'group header spec comes from pr_items, not the stale row\'s own thickness');
  assert.strictEqual(staleRepresentativeGroup[0].spec_drift, true, 'the row itself has genuinely diverged from the recorded header spec — must be flagged');

  // --- aggregatePrGroups: total_length_m for a non-plate dimensional category (tube/pipe etc.) —
  // the analogous aggregate to plate's area, since its one per-instance dimension is Length alone. ---
  const tubeFieldsA = { size: 'NB50', kg_per_m: 5, length: 6000, diameter_mm: 63.5 };
  const tubeFieldsB = { size: 'NB50', kg_per_m: 5, length: 4500, diameter_mm: 63.5 };
  const tubeHeaderFields = JSON.stringify({ size: 'NB50', kg_per_m: 5, diameter_mm: 63.5 });
  const tubeGroup = aggregatePrGroups([
    { id: 1201, pr_item_id: 35, pr_no: 'PR-35', material_description: 'Boiler Tube', moc: 'BS 3059',
      pr_item_moc: 'BS 3059', pr_item_category_fields_json: tubeHeaderFields,
      size_spec: 'NB50 x 6000mm long, ⌀63.5mm OD', category: 'pipe', category_fields_json: JSON.stringify(tubeFieldsA),
      qty_text: '2 No', reserved_qty: 0, qty_breakdown: null, project_id: 1 },
    { id: 1202, pr_item_id: 35, pr_no: 'PR-35', material_description: 'Boiler Tube', moc: 'BS 3059',
      pr_item_moc: 'BS 3059', pr_item_category_fields_json: tubeHeaderFields,
      size_spec: 'NB50 x 4500mm long, ⌀63.5mm OD', category: 'pipe', category_fields_json: JSON.stringify(tubeFieldsB),
      qty_text: '3 No', reserved_qty: 0, qty_breakdown: null, project_id: 2 },
  ]);
  assert.strictEqual(tubeGroup[0].spec_drift, false, 'same diameter/size, different length — the normal tube case, not drift');
  assert.strictEqual(tubeGroup[0].common_spec, 'NB50, ⌀63.5mm OD', 'tube common spec is size+diameter, never length');
  const expectedTubeLength = Number(((6 * 2) + (4.5 * 3)).toFixed(3));
  assert.strictEqual(tubeGroup[0].total_length_m, expectedTubeLength, 'total length = sum of each project\'s own length x qty (m)');
  assert.strictEqual(tubeGroup[0].total_area_sqm, null, 'tube has no total_area_sqm — length is its aggregate, not area');

  // --- aggregatePrGroups: no weight for a non-dimensional category ---
  const standardGroup = aggregatePrGroups([
    { id: 601, pr_item_id: 15, material_description: 'Safety valve', moc: null, size_spec: '2 inch', category: 'standard',
      category_fields_json: JSON.stringify({ item_master_ref: 'SV-01', qty: 2 }), qty_text: '2 Nos', reserved_qty: 0, qty_breakdown: null, project_id: 1 },
  ]);
  assert.strictEqual(standardGroup[0].total_weight_kg, null, 'standard/other has no dimensions to weigh');

  console.log('lib/bom-structure.mjs self-check: all assertions passed.');
}

selfcheck();
