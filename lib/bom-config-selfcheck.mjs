// lib/bom-config-selfcheck.mjs — runnable check for lib/bom-config.mjs (repo has no JS test framework;
// same precedent as bom-structure-selfcheck.mjs).   node lib/bom-config-selfcheck.mjs
import assert from 'node:assert';
import {
  isConfigLabel, classifyConfigRow, parseConfig, validateConfigInput, normalizeConfig, serializeConfig, mergeConfig, CONFIG_LIMITS,
} from './bom-config.mjs';

// --- label vocabulary: the real labels seen across SB-1040 / SB-1108 / STF-IBR-053 / 060
for (const l of ['TYPE', 'FLOW cfm', 'STATIC HEAD inchwc', 'STATIC HEAD mmwc', 'STATIC HEAD mm wc', 'SPEED RPM', 'TYPE OF MOUNTING',
  'MEDIUM', 'OPERATING TEMP(°C)', 'OPERATING TEMP (°C)', 'MOTOR RATING', 'SET PRESSURE - I I', 'SET PRESSURE - II', '  flow   CFM  ']) {
  assert.ok(isConfigLabel(l), `should be a config label: ${l}`);
}
// ... and things that merely start with the same word must NOT match (they are real items)
for (const l of ['FLOW METER', 'FLOW SWITCH', 'TYPE B FLANGE', 'MEDIUM PRESSURE VALVE', 'SPEED CONTROLLER', 'MOTOR', 'MOTOR RATING PLATE',
  'SET PRESSURE GAUGE', 'SUPPPLY OF CONDENSATE RECOVERY PUMP WITH FLASH STEAM VESSEL', '', null]) {
  assert.ok(!isConfigLabel(l), `must NOT be a config label: ${l}`);
}

// --- row classification (conservative)
assert.deepStrictEqual(classifyConfigRow({ material_description: 'TYPE', size_spec: 'CENTRIFUGAL', grn_ref: '0000' }),
  { label: 'TYPE', value: 'CENTRIFUGAL' }, 'value in size, pre-filled 0000 GRN placeholder is ignored');
assert.deepStrictEqual(classifyConfigRow({ material_description: 'TYPE', make: 'CENTRIFUGAL' }),
  { label: 'TYPE', value: 'CENTRIFUGAL' }, 'SB-1108 layout: the value sits in the Make column');
assert.deepStrictEqual(classifyConfigRow({ material_description: 'FLOW cfm' }),
  { label: 'FLOW cfm', value: '' }, 'blank-value label is still configuration (field waiting to be filled)');
assert.strictEqual(classifyConfigRow({ material_description: 'MOTOR RATING', size_spec: '5HP', make: 'Vashi/HINDUSTAN', po_ref: '179/SB/25/26' }), null,
  'a MOTOR RATING row with a make AND a PO is the motor purchase itself — stays an item');
assert.strictEqual(classifyConfigRow({ material_description: 'MOTOR RATING', size_spec: '5HP', make: 'Vashi' }), null,
  'two value cells filled = ambiguous — stays an item');
assert.strictEqual(classifyConfigRow({ material_description: 'TYPE', size_spec: 'X', qty_text: '2 Nos' }), null, 'a quantity means a real item');
assert.strictEqual(classifyConfigRow({ material_description: 'TYPE', moc: 'SS 304' }), null, 'a material means a real item');
assert.strictEqual(classifyConfigRow({ material_description: 'TYPE', size_spec: 'X', grn_ref: 'GRN-55' }), null, 'a real GRN reference is procurement data');
assert.strictEqual(classifyConfigRow({ material_description: 'SUPPPLY OF CONDENSATE RECOVERY PUMP', size_spec: '' }), null, 'unknown label stays an item');

// explicit conversion of a hand-picked item may use any label — but never a row with real item/procurement data
assert.deepStrictEqual(classifyConfigRow({ material_description: 'VOLTAGE', size_spec: '415 V' }, { anyLabel: true }), { label: 'VOLTAGE', value: '415 V' });
assert.strictEqual(classifyConfigRow({ material_description: 'VOLTAGE', size_spec: '415 V' }), null, 'without anyLabel an unknown label is not auto-detected');
assert.strictEqual(classifyConfigRow({ material_description: 'VOLTAGE', size_spec: '415 V', qty_text: '1' }, { anyLabel: true }), null, 'anyLabel never overrides quantity');
assert.strictEqual(classifyConfigRow({ material_description: 'MS PLATE', moc: 'SA 516' }, { anyLabel: true }), null, 'anyLabel never overrides a material');

// --- storage helpers
assert.deepStrictEqual(parseConfig(null), []);
assert.deepStrictEqual(parseConfig('not json'), []);
assert.deepStrictEqual(parseConfig('{"a":1}'), [], 'non-array JSON is tolerated');
assert.deepStrictEqual(parseConfig('[{"label":" TYPE ","value":"C"},{"label":""},7]'), [{ label: 'TYPE', value: 'C' }]);
assert.strictEqual(serializeConfig([]), null, 'no rows -> NULL so an unconfigured node stays unchanged');
assert.strictEqual(serializeConfig([{ label: ' ', value: 'x' }]), null, 'rows with an empty label are dropped');
assert.deepStrictEqual(normalizeConfig([{ label: 'Type', value: 'A' }, { label: 'TYPE', value: 'B' }, { label: 'Flow', value: ' 5 ' }]),
  [{ label: 'Type', value: 'A' }, { label: 'Flow', value: '5' }], 'case-insensitive de-dupe keeps the first, values trimmed');
assert.ok(validateConfigInput('x'), 'non-array rejected');
assert.ok(validateConfigInput(Array.from({ length: CONFIG_LIMITS.rows + 1 }, (_, i) => ({ label: 'L' + i, value: '' }))), 'too many rows rejected');
assert.ok(validateConfigInput([{ label: 'x'.repeat(CONFIG_LIMITS.label + 1), value: '' }]), 'over-long label rejected');
assert.ok(validateConfigInput([{ label: 'ok', value: 'y'.repeat(CONFIG_LIMITS.value + 1) }]), 'over-long value rejected');
assert.strictEqual(validateConfigInput([{ label: 'ok', value: 'fine' }]), null);

// --- merge (import / convert)
let m = mergeConfig([{ label: 'TYPE', value: 'A' }, { label: 'MEDIUM', value: 'AIR' }], [{ label: 'type', value: 'B' }, { label: 'medium', value: '' }, { label: 'FLOW cfm', value: '9' }]);
assert.deepStrictEqual(m.list, [{ label: 'TYPE', value: 'B' }, { label: 'MEDIUM', value: 'AIR' }, { label: 'FLOW cfm', value: '9' }],
  'incoming non-empty value wins, incoming blank never blanks, new labels append');
assert.deepStrictEqual([m.added, m.updated], [1, 1]);
m = mergeConfig(m.list, [{ label: 'TYPE', value: 'B' }]);
assert.deepStrictEqual([m.added, m.updated], [0, 0], 're-merging identical data changes nothing (idempotent — safe for a Replace re-import)');
const full = Array.from({ length: CONFIG_LIMITS.rows }, (_, i) => ({ label: 'L' + i, value: '' }));
assert.strictEqual(mergeConfig(full, [{ label: 'NEW', value: 'x' }]).list.length, CONFIG_LIMITS.rows, 'never exceeds the row cap');

console.log('lib/bom-config.mjs self-check: all assertions passed.');
