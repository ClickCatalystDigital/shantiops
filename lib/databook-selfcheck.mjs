import assert from 'node:assert/strict';
import { cleanLines, completeness, releaseProblems, buildManifest, sourceLabel, isKnownSource } from './databook.mjs';

const { lines, errors } = cleanLines([
  { key: 'mdr', section: '3', label: 'Data reports', source: 'asme_package' },
  { key: 'rt', section: '6', label: 'Radiography', source: 'inspection:RT' },
  { key: 'paint', section: '7', label: 'Paint', source: '' },
]);
assert.equal(errors.length, 0);
assert.equal(lines[2].source, 'upload', 'blank source = upload');
assert.equal(cleanLines([{ key: 'a', label: 'x' }, { key: 'a', label: 'y' }]).errors.length, 1, 'duplicate key');
assert.equal(cleanLines([{ key: 'a', label: 'x', source: 'nonsense' }]).errors.length, 1, 'unknown source');
assert.ok(isKnownSource('inspection:Hydro Test'));
assert.equal(sourceLabel('inspection:RT'), 'Inspection records: RT');

const book = [...lines.slice(0, 2), { ...lines[2], state: 'na', note: 'Not painted' }];
const s = completeness(book, { mdr: { auto: 1, files: 0 }, rt: { auto: 0, files: 0 } });
assert.deepEqual([s.included, s.missing, s.na], [1, 1, 1]);
assert.deepEqual(releaseProblems(s), ['6 · Radiography is missing']);
assert.equal(releaseProblems(s, ['JC-1 point 4.2']).length, 2);
const s2 = completeness(book, { mdr: { auto: 0, files: 2 }, rt: { auto: 3, files: 0 } });
assert.equal(releaseProblems(s2).length, 0, 'uploads count as content; n/a counts as done');

const parts = [{ key: 'mdr', label: 'Data reports', status: 'included', items: [{ kind: 'file', ref: 7, sha256: 'ab', pages: 3 }] }];
assert.deepEqual(buildManifest(parts), buildManifest(structuredClone(parts)), 'stable');
assert.equal(buildManifest(parts)[0].items[0].ref, '7');
console.log('databook ok');
