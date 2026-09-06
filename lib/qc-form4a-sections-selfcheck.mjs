import assert from 'node:assert/strict';
import { resolveSection, buildLetteredSections } from './qc-form4a-sections.mjs';

// Real shape confirmed on SB-1109-01-50: 5 roots, 2 with Subsystem children, 3 childless (items
// assigned straight to the root).
const assemblies = [
  { id: 1, name: 'BOILER', parent_id: null },
  { id: 2, name: 'Boiler Shell & Body', parent_id: 1 },
  { id: 3, name: 'Boiler Mounting & Fittings', parent_id: 1 },
  { id: 4, name: 'FLUE GAS DUCT UP TO CHIMNEY', parent_id: null },
  { id: 5, name: 'Boiler to SDC', parent_id: 4 },
  { id: 6, name: 'SDC', parent_id: null },       // childless root
  { id: 7, name: 'CHIMNEY', parent_id: null },   // childless root
  { id: 8, name: 'ID FAN', parent_id: null },    // childless root, zero parts (never appears)
  { id: 9, name: 'Deep Sub-assembly', parent_id: 2 }, // depth 2, under a Subsystem
];
const byId = new Map(assemblies.map(a => [a.id, a]));

// 1. Depth-1 item (directly under a root) resolves to its Subsystem parent.
assert.equal(resolveSection(2, byId).id, 2);
// 2. Item sitting directly ON a root (childless-root case) resolves to the root itself.
assert.equal(resolveSection(6, byId).id, 6);
// 3. Depth-2 item (root -> Subsystem -> Sub-assembly) still resolves to the Subsystem, not the leaf.
assert.equal(resolveSection(9, byId).id, 2);
// 4. Unassigned (null) -> null.
assert.equal(resolveSection(null, byId), null);
// 5. A stale/unknown assembly_id -> null (fails open, doesn't throw).
assert.equal(resolveSection(999, byId), null);

// 6. Full grouping: parts across depth-1, childless-root, and depth-2 nodes, plus one unassigned.
const parts = [
  { id: 'p1', assembly_id: 2 }, { id: 'p2', assembly_id: 9 }, // both -> section "Boiler Shell & Body"
  { id: 'p3', assembly_id: 3 },  // -> "Boiler Mounting & Fittings"
  { id: 'p4', assembly_id: 5 },  // -> "Boiler to SDC"
  { id: 'p5', assembly_id: 6 },  // -> "SDC" (childless root)
  { id: 'p6', assembly_id: null }, // ungrouped
  { id: 'p7', assembly_id: 999 }, // ungrouped (stale id)
];
const { sections, ungrouped } = buildLetteredSections(assemblies, parts);
assert.equal(sections.length, 4); // exactly the 4 sections that have >=1 part — no letter for CHIMNEY/ID FAN
assert.deepEqual(sections.map(s => s.letter), ['A', 'B', 'C', 'D']); // continuous, no gaps
assert.equal(sections[0].name, 'Boiler Shell & Body');
assert.deepEqual(sections[0].parts.map(p => p.id), ['p1', 'p2']); // depth-1 and depth-2 items both land here
assert.equal(sections[3].name, 'SDC'); // childless root correctly gets its own lettered section
assert.deepEqual(ungrouped.map(p => p.id), ['p6', 'p7']);

// 7. No tree at all (empty assemblies) -> zero sections, everything ungrouped -> byte-identical
//    fallback to today's single flat table.
const flat = buildLetteredSections([], parts);
assert.equal(flat.sections.length, 0);
assert.equal(flat.ungrouped.length, parts.length);

// 8. Real bug found on re-review, now fixed: an item assigned DIRECTLY to a root that also has
// children (BOILER, id 1, has children 2/3) must resolve to the root itself and still surface as
// its own lettered section — not silently vanish because the root was never in the candidate list.
const rootDirect = buildLetteredSections(assemblies, [{ id: 'p8', assembly_id: 1 }]);
assert.equal(rootDirect.sections.length, 1);
assert.equal(rootDirect.sections[0].name, 'BOILER');
assert.equal(rootDirect.ungrouped.length, 0);
// And a childless root with zero direct items (the real, common case) must still NOT get a
// spurious extra section of its own — only actually-populated nodes get lettered.
const noSpurious = buildLetteredSections(assemblies, [{ id: 'p9', assembly_id: 2 }]);
assert.equal(noSpurious.sections.length, 1); // just "Boiler Shell & Body" — not BOILER too

console.log('qc-form4a-sections-selfcheck: all assertions passed');
