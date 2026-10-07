import assert from 'node:assert';
import { subsystemFamily, isContainerOnly } from './subsystem-family.mjs';

const f = n => subsystemFamily(n).label;
for (const n of ['F.d.fan Blower', 'F.D. fan Blower', 'F.d Fan Blower', 'F.d.fan Blower with Vfd', 'F.D. fan Blower', 'Fd Fan Blower'])
  assert.strictEqual(f(n), 'FD Fan Blower', n);
for (const n of ['I.d.fan Blower', 'I.D. fan Blower', 'I.d.fan Blower with Vfd', 'ID FAN'])
  assert.strictEqual(f(n), 'ID Fan Blower', n);
assert.strictEqual(f('Boiler-sf-wb-300-10.54'), 'Boiler Body');
assert.strictEqual(f('Boiler-mf -3000 Kg/hr'), 'Boiler Body');
assert.strictEqual(f('Boiler-500 Kg/hr'), 'Boiler Body');
assert.strictEqual(f('Boiler -af-400-10.54 with Insulation'), 'Boiler Body');
assert.strictEqual(f('BOILER'), 'BOILER', 'the root container is not the body');
assert.notStrictEqual(subsystemFamily('BOILER').key, subsystemFamily('Boiler-sf-wb-300-10.54').key);
assert.strictEqual(f('Boiler Mounting & Fittings -4000 Kg/hr'), 'Boiler Mounting & Fittings');
assert.strictEqual(subsystemFamily('Boiler Mounting & Fittings -3000 Kg/hr').key, subsystemFamily('Boiler Mounting & Fittings').key);
assert.strictEqual(f('Electrical Panel for Boiler'), 'Electrical Panel');
assert.strictEqual(f('Fire Door & Fire Bars'), 'Fire Door and Fire Bars');
assert.strictEqual(subsystemFamily('Fire Door and Fire Bars & Support Bars').key, subsystemFamily('Fire Door & Fire Bars').key);
assert.strictEqual(f('Feed Line'), 'Feed Line');
assert.strictEqual(subsystemFamily('Feed Line').key, subsystemFamily('FEED LINE').key);
assert.strictEqual(f('Mdc to Id Fan'), 'Mdc to Id Fan', 'a different duct section is not the ID fan');
assert.strictEqual(f('Some New Thing'), 'Some New Thing', 'unknown names pass through as their own family');
assert.deepStrictEqual(subsystemFamily('  '), { key: '', label: '' });
assert.strictEqual(isContainerOnly({ parent_id: null, itemCount: 0 }), true);
assert.strictEqual(isContainerOnly({ parent_id: 5, itemCount: 0 }), false);
console.log('lib/subsystem-family.mjs self-check: all assertions passed.');
