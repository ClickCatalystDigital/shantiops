// lib/bom-tree-selfcheck.mjs — runnable check for lib/bom-tree.mjs (repo has no JS test framework;
// mirrors lib/bom-structure-selfcheck.mjs's precedent).
//   node lib/bom-tree-selfcheck.mjs
import assert from 'node:assert';
import { groupByParent, nodeDepth, nodePath, expandedIdsForSearch, suggestNodeType, rankItemsByRelevance } from './bom-tree.mjs';

function selfcheck() {
  const assemblies = [
    { id: 1, parent_id: null, name: 'Boiler Shell' },
    { id: 2, parent_id: 1, name: 'Feedwater Subsystem' },
    { id: 3, parent_id: 2, name: 'Pump Assembly' },
    { id: 4, parent_id: 1, name: 'Tube Bundle' },
  ];
  const byId = new Map(assemblies.map(a => [a.id, a]));

  const byParent = groupByParent(assemblies);
  assert.strictEqual(byParent.get(null).length, 1, 'one top-level root');
  assert.strictEqual(byParent.get(1).length, 2, 'Boiler Shell has two children');

  assert.strictEqual(nodeDepth(1, byId), 0);
  assert.strictEqual(nodeDepth(2, byId), 1);
  assert.strictEqual(nodeDepth(3, byId), 2);

  assert.deepStrictEqual(nodePath(3, byId), ['Boiler Shell', 'Feedwater Subsystem', 'Pump Assembly']);
  assert.deepStrictEqual(nodePath(1, byId), ['Boiler Shell']);

  const expanded = expandedIdsForSearch('pump', assemblies, byId);
  assert.ok(expanded.has(3), 'the match itself must be expanded');
  assert.ok(expanded.has(2) && expanded.has(1), 'every ancestor of a match must be expanded so it is visible');
  assert.ok(!expanded.has(4), 'an unrelated branch must not be force-expanded');
  assert.strictEqual(expandedIdsForSearch('', assemblies, byId).size, 0, 'an empty query expands nothing');
  assert.strictEqual(expandedIdsForSearch('PUMP', assemblies, byId).has(3), true, 'search is case-insensitive');

  assert.strictEqual(suggestNodeType('Pump Sub-assembly', 0), 'Sub-assembly', 'name keyword wins over depth');
  assert.strictEqual(suggestNodeType('Drive Assembly', 3), 'Assembly', 'name keyword wins over depth');
  assert.strictEqual(suggestNodeType('Feedwater Subsystem', 0), 'Subsystem', 'name keyword wins over depth');
  assert.strictEqual(suggestNodeType('Boiler Shell', 0), 'System', 'depth-0 fallback with no keyword');
  assert.strictEqual(suggestNodeType('Boiler Shell', 1), 'Subsystem', 'depth-1 fallback with no keyword');
  assert.strictEqual(suggestNodeType('Boiler Shell', 4), 'Component', 'depth-4 fallback with no keyword');
  assert.strictEqual(suggestNodeType('Boiler Shell', 99), 'Component', 'depth beyond the list clamps to the last suggestion');

  const items = [
    { id: 101, material_description: 'Feedwater pump gasket', section: 'Feedwater' },
    { id: 102, material_description: 'MS Angle 50x50x5', section: 'Structural' },
    { id: 103, material_description: 'Pump Assembly coupling', section: 'Feedwater' },
  ];
  const ranked = rankItemsByRelevance(['Feedwater Subsystem', 'Pump Assembly'], items);
  assert.strictEqual(ranked[0].id, 103, 'the item matching all three keywords ranks first');
  assert.ok(ranked.map(i => i.id).includes(102), 'a zero-overlap item is still present, never hidden');
  assert.strictEqual(rankItemsByRelevance([], items).length, 3, 'no keywords -> original list, untouched');

  console.log('lib/bom-tree.mjs self-check: all assertions passed.');
}

selfcheck();
