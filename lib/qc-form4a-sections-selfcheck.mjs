import assert from 'node:assert/strict';
import { buildManualSections } from './qc-form4a-sections.mjs';

const groups = [
  { id: 1, name: 'Shell', sort_order: 0 },
  { id: 2, name: 'Mountings', sort_order: 1 },
  { id: 3, name: 'Empty Group', sort_order: 2 }, // created, never assigned any parts
];
const parts = [
  { id: 'p1', form4a_group_id: 1 }, { id: 'p2', form4a_group_id: 1 },
  { id: 'p3', form4a_group_id: 2 },
  { id: 'p4', form4a_group_id: null },
];

// 1. Groups with parts become lettered sections in sort_order, in order; an empty group is skipped.
{
  const { sections, ungrouped } = buildManualSections(groups, parts);
  assert.equal(sections.length, 2);
  assert.deepEqual(sections.map(s => s.letter), ['A', 'B']);
  assert.equal(sections[0].name, 'Shell');
  assert.deepEqual(sections[0].parts.map(p => p.id), ['p1', 'p2']);
  assert.equal(sections[1].name, 'Mountings');
  assert.deepEqual(ungrouped.map(p => p.id), ['p4']);
}

// 2. Zero groups -> zero sections, everything ungrouped -> the flat, no-heading fallback (a real
// groupless document has every part's form4a_group_id null, since a part can only be tagged via an
// existing group).
{
  const flatParts = [{ id: 'q1', form4a_group_id: null }, { id: 'q2', form4a_group_id: null }];
  const { sections, ungrouped } = buildManualSections([], flatParts);
  assert.equal(sections.length, 0);
  assert.equal(ungrouped.length, flatParts.length);
}

// 3. Groups out of insertion order still letter by sort_order, not array order.
{
  const reordered = [{ id: 2, name: 'Mountings', sort_order: 1 }, { id: 1, name: 'Shell', sort_order: 0 }];
  const { sections } = buildManualSections(reordered, parts);
  assert.equal(sections[0].name, 'Shell');
  assert.equal(sections[1].name, 'Mountings');
}

console.log('qc-form4a-sections-selfcheck: all assertions passed');
