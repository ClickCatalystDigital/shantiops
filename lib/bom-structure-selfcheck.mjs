// lib/bom-structure-selfcheck.mjs — runnable check for lib/bom-structure.mjs (repo has no JS test
// framework; mirrors lib/pmb-selfcheck.mjs's precedent).
//   node lib/bom-structure-selfcheck.mjs
import assert from 'node:assert';
import { rollupQty, itemRollupQty, partIdentityKey, canDecideChangeNote, shouldAdjustStock, wouldCreateCycle } from './bom-structure.mjs';

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

  console.log('lib/bom-structure.mjs self-check: all assertions passed.');
}

selfcheck();
