// lib/bom-config-selfcheck.mjs — runnable check for lib/bom-config.mjs (repo has no JS test framework;
// same precedent as bom-structure-selfcheck.mjs).   node lib/bom-config-selfcheck.mjs
import assert from 'node:assert';
import {
  isConfigLabel, classifyConfigRow, continuationConfig, splitLabelValue, splitValueUnit, configParts, parseConfig, validateConfigInput, normalizeConfig, serializeConfig, mergeConfig, CONFIG_LIMITS,
} from './bom-config.mjs';

// --- label vocabulary: the real labels seen across SB-1040 / SB-1108 / STF-IBR-053 / 060
for (const l of ['TYPE', 'FLOW cfm', 'STATIC HEAD inchwc', 'STATIC HEAD mmwc', 'STATIC HEAD mm wc', 'SPEED RPM', 'TYPE OF MOUNTING',
  'MEDIUM', 'OPERATING TEMP(°C)', 'OPERATING TEMP (°C)', 'MOTOR RATING', 'SET PRESSURE - I I', 'SET PRESSURE - II', 'MIN RELIEVEING CAP', 'MIN RELIEVING CAP', 'RELIEVING CAPACITY', '  flow   CFM  ']) {
  assert.ok(isConfigLabel(l), `should be a config label: ${l}`);
}
// ... and things that merely start with the same word must NOT match (they are real items)
for (const l of ['FLOW METER', 'FLOW SWITCH', 'TYPE B FLANGE', 'MEDIUM PRESSURE VALVE', 'SPEED CONTROLLER', 'MOTOR', 'MOTOR RATING PLATE',
  'SET PRESSURE GAUGE', 'SUPPPLY OF CONDENSATE RECOVERY PUMP WITH FLASH STEAM VESSEL', '', null]) {
  assert.ok(!isConfigLabel(l), `must NOT be a config label: ${l}`);
}

// --- row classification (conservative)
assert.deepStrictEqual(classifyConfigRow({ material_description: 'TYPE', size_spec: 'CENTRIFUGAL', grn_ref: '0000' }),
  { label: 'TYPE', value: 'CENTRIFUGAL', unit: '' }, 'value in size, pre-filled 0000 GRN placeholder is ignored');
assert.deepStrictEqual(classifyConfigRow({ material_description: 'TYPE', make: 'CENTRIFUGAL' }),
  { label: 'TYPE', value: 'CENTRIFUGAL', unit: '' }, 'SB-1108 layout: the value sits in the Make column');
assert.deepStrictEqual(classifyConfigRow({ material_description: 'FLOW cfm' }),
  { label: 'FLOW', value: '', unit: 'cfm' }, 'blank-value label is still configuration (field waiting to be filled)');
assert.strictEqual(classifyConfigRow({ material_description: 'MOTOR RATING', size_spec: '5HP', make: 'Vashi/HINDUSTAN', po_ref: '179/SB/25/26' }), null,
  'a MOTOR RATING row with a make AND a PO is the motor purchase itself — stays an item');
assert.strictEqual(classifyConfigRow({ material_description: 'MOTOR RATING', size_spec: '5HP', make: 'Vashi' }), null,
  'two value cells filled = ambiguous — stays an item');
assert.strictEqual(classifyConfigRow({ material_description: 'TYPE', size_spec: 'X', qty_text: '2 Nos' }), null, 'a quantity means a real item');
assert.strictEqual(classifyConfigRow({ material_description: 'TYPE', moc: 'SS 304' }), null, 'a material means a real item');
assert.strictEqual(classifyConfigRow({ material_description: 'TYPE', size_spec: 'X', grn_ref: 'GRN-55' }), null, 'a real GRN reference is procurement data');
assert.strictEqual(classifyConfigRow({ material_description: 'SUPPPLY OF CONDENSATE RECOVERY PUMP', size_spec: '' }), null, 'unknown label stays an item');

// explicit conversion of a hand-picked item may use any label — but never a row with real item/procurement data
assert.deepStrictEqual(classifyConfigRow({ material_description: 'VOLTAGE', size_spec: '415 V' }, { anyLabel: true }), { label: 'VOLTAGE', value: '415 V', unit: '' });
assert.strictEqual(classifyConfigRow({ material_description: 'VOLTAGE', size_spec: '415 V' }), null, 'without anyLabel an unknown label is not auto-detected');
assert.strictEqual(classifyConfigRow({ material_description: 'VOLTAGE', size_spec: '415 V', qty_text: '1' }, { anyLabel: true }), null, 'anyLabel never overrides quantity');
assert.strictEqual(classifyConfigRow({ material_description: 'MS PLATE', moc: 'SA 516' }, { anyLabel: true }), null, 'anyLabel never overrides a material');

// SET PRESSURE: a quantity there is the valve count, not purchasing data — but only for the real label
assert.deepStrictEqual(classifyConfigRow({ material_description: 'SET PRESSURE - I ', size_spec: '10.54 KG/CM2(G)', qty_text: '2 Nos' }),
  { label: 'SET PRESSURE - I', value: '10.54', unit: 'KG/CM2(G)' }, 'SET PRESSURE with a valve count is still configuration');
assert.strictEqual(classifyConfigRow({ material_description: 'SET PRESSURE GAUGE', size_spec: '0-21', qty_text: '1 No' }, { anyLabel: true }), null,
  'a pressure gauge with a quantity is a real item, even when hand-picked');
assert.strictEqual(classifyConfigRow({ material_description: 'SET PRESSURE - I', size_spec: '10.54', qty_text: '2 Nos', moc: 'CS' }), null, 'a MOC still means a real item');
assert.strictEqual(classifyConfigRow({ material_description: 'FLOW cfm', size_spec: '2400', qty_text: '2 Nos' }), null, 'the quantity exemption is SET PRESSURE only');

// label + value in one cell / description-less continuation rows
assert.deepStrictEqual(splitLabelValue('MIN RELIEVEING CAP - 1800 Kg/hr'), { label: 'MIN RELIEVEING CAP', value: '1800 Kg/hr' });
assert.strictEqual(splitLabelValue('SAFETY VALVE - F/E (STEAM RELIEVING CAPACITY - 3000 Kg/hr)'), null, 'an item name that merely contains the words is not split');
assert.strictEqual(splitLabelValue('FLOW METER - 4"'), null, 'unknown label is not split');
assert.deepStrictEqual(continuationConfig({ size_spec: 'MIN RELIEVEING CAP - 1800 Kg/hr', purchase_status: 'PENDING' }),
  { label: 'MIN RELIEVING CAP', value: '1800', unit: 'Kg/hr' }, 'label typo corrected, value and unit split');
assert.strictEqual(continuationConfig({ material_description: 'X', size_spec: 'MIN RELIEVEING CAP - 1800 Kg/hr' }), null, 'a row with a description is not a continuation');
assert.strictEqual(continuationConfig({ size_spec: 'MIN RELIEVEING CAP - 1800 Kg/hr', qty_text: '2' }), null, 'any other filled cell means it is not a plain continuation');

// --- storage helpers
assert.deepStrictEqual(parseConfig(null), []);
assert.deepStrictEqual(parseConfig('not json'), []);
assert.deepStrictEqual(parseConfig('{"a":1}'), [], 'non-array JSON is tolerated');
assert.deepStrictEqual(parseConfig('[{"label":" TYPE ","value":"C"},{"label":""},7]'), [{ label: 'TYPE', value: 'C', unit: '' }]);
assert.deepStrictEqual(parseConfig('[{"label":"FLOW cfm","value":"2400"},{"label":"SET PRESSURE - I","value":"10.54 KG/CM2(G)"},{"label":"MEDIUM","value":"COLD AIR"}]'),
  [{ label: 'FLOW', value: '2400', unit: 'cfm' }, { label: 'SET PRESSURE - I', value: '10.54', unit: 'KG/CM2(G)' }, { label: 'MEDIUM', value: 'COLD AIR', unit: '' }],
  'rows saved before units existed (no unit key) are split on read');
assert.deepStrictEqual(parseConfig('[{"label":"FLOW","value":"5 cfm","unit":""}]'), [{ label: 'FLOW', value: '5 cfm', unit: '' }], 'a row that already has a unit key is never re-split');
assert.strictEqual(serializeConfig([]), null, 'no rows -> NULL so an unconfigured node stays unchanged');
assert.strictEqual(serializeConfig([{ label: ' ', value: 'x' }]), null, 'rows with an empty label are dropped');
assert.deepStrictEqual(normalizeConfig([{ label: 'Type', value: 'A' }, { label: 'TYPE', value: 'B' }, { label: 'Flow', value: ' 5 ' }]),
  [{ label: 'Type', value: 'A', unit: '' }, { label: 'Flow', value: '5', unit: '' }], 'case-insensitive de-dupe keeps the first, values trimmed');
assert.ok(validateConfigInput('x'), 'non-array rejected');
assert.ok(validateConfigInput(Array.from({ length: CONFIG_LIMITS.rows + 1 }, (_, i) => ({ label: 'L' + i, value: '' }))), 'too many rows rejected');
assert.ok(validateConfigInput([{ label: 'x'.repeat(CONFIG_LIMITS.label + 1), value: '' }]), 'over-long label rejected');
assert.ok(validateConfigInput([{ label: 'ok', value: 'y'.repeat(CONFIG_LIMITS.value + 1) }]), 'over-long value rejected');
assert.ok(validateConfigInput([{ label: 'ok', value: '1', unit: 'u'.repeat(CONFIG_LIMITS.unit + 1) }]), 'over-long unit rejected');
assert.strictEqual(validateConfigInput([{ label: 'ok', value: 'fine' }]), null);

// --- merge (import / convert)
let m = mergeConfig([{ label: 'TYPE', value: 'A' }, { label: 'MEDIUM', value: 'AIR' }], [{ label: 'type', value: 'B' }, { label: 'medium', value: '' }, { label: 'FLOW', value: '9', unit: 'cfm' }]);
assert.deepStrictEqual(m.list, [{ label: 'TYPE', value: 'B', unit: '' }, { label: 'MEDIUM', value: 'AIR', unit: '' }, { label: 'FLOW', value: '9', unit: 'cfm' }],
  'incoming non-empty value wins, incoming blank never blanks, new labels append');
assert.deepStrictEqual([m.added, m.updated], [1, 1]);
m = mergeConfig(m.list, [{ label: 'TYPE', value: 'B' }]);
assert.deepStrictEqual([m.added, m.updated], [0, 0], 're-merging identical data changes nothing (idempotent — safe for a Replace re-import)');
const full = Array.from({ length: CONFIG_LIMITS.rows }, (_, i) => ({ label: 'L' + i, value: '' }));
assert.strictEqual(mergeConfig(full, [{ label: 'NEW', value: 'x' }]).list.length, CONFIG_LIMITS.rows, 'never exceeds the row cap');

// --- value / unit split
assert.deepStrictEqual(splitValueUnit('10.54 KG/CM2(G)'), { value: '10.54', unit: 'KG/CM2(G)' });
assert.deepStrictEqual(splitValueUnit('1800 Kg/hr'), { value: '1800', unit: 'Kg/hr' });
assert.deepStrictEqual(splitValueUnit('300 mmWC'), { value: '300', unit: 'mmWC' });
assert.deepStrictEqual(splitValueUnit('150mmwc'), { value: '150', unit: 'mmwc' });
assert.deepStrictEqual(splitValueUnit('40°C'), { value: '40', unit: '°C' });
assert.deepStrictEqual(splitValueUnit('5HP'), { value: '5', unit: 'HP' });
assert.deepStrictEqual(splitValueUnit('4"'), { value: '4', unit: '"' });
assert.deepStrictEqual(splitValueUnit('2400'), { value: '2400', unit: '' });
for (const v of ['COLD AIR', 'DIRECT MOUNTED TYPE-B.', '0-21KG/CM2(G)', '1250X2500', '3 PHASE 415 V', '']) {
  assert.deepStrictEqual(splitValueUnit(v), { value: v, unit: '' }, `not number + unit: ${v}`);
}
// label + value -> {label, value, unit}: value's own unit wins, then the label's, then a fixed default (numbers only)
assert.deepStrictEqual(configParts('FLOW cfm', '2400'), { label: 'FLOW', value: '2400', unit: 'cfm' });
assert.deepStrictEqual(configParts('STATIC HEAD inchwc', '300 mmWC'), { label: 'STATIC HEAD', value: '300', unit: 'mmWC' }, 'unit typed with the value beats the label');
assert.deepStrictEqual(configParts('STATIC HEAD mmwc', '150mmwc'), { label: 'STATIC HEAD', value: '150', unit: 'mmwc' });
assert.deepStrictEqual(configParts('SPEED RPM', '2880'), { label: 'SPEED', value: '2880', unit: 'RPM' });
assert.deepStrictEqual(configParts('OPERATING TEMP(°C)', '40°C'), { label: 'OPERATING TEMP', value: '40', unit: '°C' });
assert.deepStrictEqual(configParts('OPERATING TEMP', '220'), { label: 'OPERATING TEMP', value: '220', unit: '°C' }, 'default unit for a plain number');
assert.deepStrictEqual(configParts('OPERATING TEMP', 'AMBIENT'), { label: 'OPERATING TEMP', value: 'AMBIENT', unit: '' }, 'no default unit on text');
assert.deepStrictEqual(configParts('SET PRESSURE - I I', '10.54 KG/CM2(G)'), { label: 'SET PRESSURE - I I', value: '10.54', unit: 'KG/CM2(G)' });
assert.deepStrictEqual(configParts('SET PRESSURE - I', '10.54'), { label: 'SET PRESSURE - I', value: '10.54', unit: 'KG/CM2(G)' }, 'SET PRESSURE always defaults to KG/CM2(G)');
assert.deepStrictEqual(configParts('SET PRESSURE - I', ''), { label: 'SET PRESSURE - I', value: '', unit: 'KG/CM2(G)' }, 'blank field waiting to be filled keeps its unit');
assert.deepStrictEqual(configParts('MIN RELIEVEING CAP', '1800 Kg/hr'), { label: 'MIN RELIEVING CAP', value: '1800', unit: 'Kg/hr' });
assert.deepStrictEqual(configParts('MIN RELIEVING CAP', '1800'), { label: 'MIN RELIEVING CAP', value: '1800', unit: 'Kg/hr' });
assert.deepStrictEqual(configParts('MOTOR RATING', '5HP'), { label: 'MOTOR RATING', value: '5', unit: 'HP' });
assert.deepStrictEqual(configParts('TYPE', 'CENTRIFUGAL'), { label: 'TYPE', value: 'CENTRIFUGAL', unit: '' });
assert.ok(isConfigLabel('RPM'), 'bare RPM label still recognised');
assert.deepStrictEqual(configParts('RPM', '1440'), { label: 'SPEED', value: '1440', unit: 'RPM' });

console.log('lib/bom-config.mjs self-check: all assertions passed.');
