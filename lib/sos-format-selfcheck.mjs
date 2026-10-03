import assert from 'node:assert';
import { splitExclusions, hsnFrom, sosLine } from './sos-format.mjs';

assert.deepEqual(splitExclusions('Supply of Ducting. EXCLUSIONS : Site Installation / Insulation'), { body: 'Supply of Ducting', exclusions: 'Site Installation / Insulation' });
assert.deepEqual(splitExclusions('Chimney Foundation Bolts . MODEL : SB-1 EXCLUSSION : Civil'), { body: 'Chimney Foundation Bolts . MODEL : SB-1', exclusions: 'Civil' });
assert.deepEqual(splitExclusions('No such part'), { body: 'No such part', exclusions: '' });
assert.equal(splitExclusions('includes : &#61692; Boiler &#61692; Pump').body, 'includes : • Boiler • Pump');
assert.deepEqual(splitExclusions(null), { body: '', exclusions: '' });
assert.equal(hsnFrom('HSN 84021200 · GST 0%'), '84021200');
assert.equal(hsnFrom('GST 0%'), '');
assert.deepEqual(sosLine({ description: 'X', spec: 'HSN 84029000 · GST 0%' }), { name: 'X', type: '', body: '', exclusions: '', hsn: '84029000' });
console.log('sos-format ok');
