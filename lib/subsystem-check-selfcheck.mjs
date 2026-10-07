import assert from 'node:assert';
import { lineStem, matchBuild, bestBuild } from './subsystem-check.mjs';

assert.strictEqual(lineStem('MS EN-8 ROD 63 MM (1 MTR 24.5 KGS)'), lineStem('MS EN-8 ROD 100 MM (1 MTR 61.65 KGS)'));
assert.strictEqual(lineStem('MOTOR 5 HP IE2'), lineStem('MOTOR 7.5 HP'));
assert.notStrictEqual(lineStem('MOTOR 5 HP'), lineStem('MS EN-8 ROD 63 MM'));

const build = [
  { item_id: 1, label: 'MOTOR 5 HP' }, { item_id: 2, label: 'MS EN-8 ROD 100 MM (1 MTR 61.65 KGS)' },
  { item_id: 3, label: 'MS ANGLE 50 X 50 X 5 MM' }, { item_id: 4, label: 'CANVAS CLOTH EXPANSION JOINT', presence: 'optional' },
  { item_id: null, label: 'BODY SHELL MATERIAL' },
];
// same shaft at another diameter is not missing; the missing required line is the angle; the optional one is never reported
let r = matchBuild([{ item_id: 1, label: 'MOTOR 5 HP' }, { item_id: 9, label: 'MS EN-8 ROD 63 MM (1 MTR 24.5 KGS)' }, { item_id: null, label: 'BODY SHELL MATERIAL' }], build);
assert.deepStrictEqual(r.missing.map(m => m.label), ['MS ANGLE 50 X 50 X 5 MM']);
assert.strictEqual(r.matched, 3);
// an absent motor is reported
r = matchBuild([{ item_id: 2, label: 'MS EN-8 ROD 100 MM' }, { item_id: 3, label: 'MS ANGLE 50 X 50 X 5 MM' }, { item_id: null, label: 'BODY SHELL MATERIAL' }], build);
assert.deepStrictEqual(r.missing.map(m => m.label), ['MOTOR 5 HP']);
// one project line satisfies one build line only
r = matchBuild([{ item_id: 2, label: 'MS EN-8 ROD 100 MM' }], [{ item_id: 2, label: 'MS EN-8 ROD 100 MM' }, { item_id: 7, label: 'MS EN-8 ROD 63 MM' }]);
assert.strictEqual(r.matched, 1);
assert.strictEqual(r.missing.length, 1, 'two shafts in the build need two shafts on the project');
// best build = most matches
const b = bestBuild([{ item_id: 1, label: 'MOTOR 5 HP' }], [{ name: 'A', lines: [{ item_id: 8, label: 'FAN' }] }, { name: 'B', lines: [{ item_id: 1, label: 'MOTOR 5 HP' }] }]);
assert.strictEqual(b.build.name, 'B');
assert.strictEqual(bestBuild([], []), null);
console.log('lib/subsystem-check.mjs self-check: all assertions passed.');
