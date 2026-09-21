// node lib/qty-units-selfcheck.mjs
import assert from 'node:assert';
import { normalizeUnit, splitQtyUnit, formatQty, qtyTokens, QTY_UNITS } from './qty-units.mjs';

for (const [raw, want] of [['No', 'Nos'], ['NOS.', 'Nos'], ['Mtrs.', 'Mtr'], ['mtr', 'Mtr'], ['LTR', 'Ltr'], ['Ltrs', 'Ltr'], ['kgs', 'Kgs'], ['SET', 'Set'], ['Bags', 'Bag'], ['BAG', 'Bag'], ['PKT', 'Pkt'], ['SQ MTR', 'Sqm'], ['Sq.m', 'Sqm'], ['sqm', 'Sqm']]) {
  assert.strictEqual(normalizeUnit(raw), want, raw);
  assert.ok(QTY_UNITS.includes(want));
}
assert.strictEqual(normalizeUnit('feet'), null);

assert.deepStrictEqual(splitQtyUnit('2 Nos'), { num: '2', unit: 'Nos' });
assert.deepStrictEqual(splitQtyUnit('2.0 Mtrs.'), { num: '2', unit: 'Mtr' });
assert.deepStrictEqual(splitQtyUnit('3Nos'), { num: '3', unit: 'Nos' });
assert.deepStrictEqual(splitQtyUnit('50'), { num: '50', unit: '' });
assert.deepStrictEqual(splitQtyUnit('4 Sq.m'), { num: '4', unit: 'Sqm' });
assert.deepStrictEqual(splitQtyUnit('13 SQ MTR'), { num: '13', unit: 'Sqm' }, 'multi-word unit that is a known alias');
assert.strictEqual(splitQtyUnit('1 SET COMPLETE'), null, 'an unknown multi-word unit is left alone');
assert.deepStrictEqual(splitQtyUnit('25 Bags'), { num: '25', unit: 'Bag' });
assert.deepStrictEqual(splitQtyUnit('2 PCS'), { num: '2', unit: 'PCS' }, 'one unknown word is kept as typed');
assert.strictEqual(splitQtyUnit('2 Nos 1 No'), null, 'several values are not one quantity');
assert.strictEqual(splitQtyUnit('1. 1.  1'), null, 'messy legacy text is left alone');
assert.strictEqual(splitQtyUnit(''), null);

assert.strictEqual(formatQty('1 No'), '1 Nos');
assert.strictEqual(formatQty('17 Mtr.'), '17 Mtr');
assert.strictEqual(formatQty('2 Nos 1 No'), '2 Nos 1 No', 'unchanged when not a single clean quantity');
assert.strictEqual(formatQty('ROUND OFF'), 'ROUND OFF');

assert.deepStrictEqual(qtyTokens('88 No                                            58 No     '), ['88 No', '58 No']);
assert.deepStrictEqual(qtyTokens('1 No                     2 No                \n8 No'), ['1 No', '2 No', '8 No']);
assert.deepStrictEqual(qtyTokens('2 Nos 1 No 1 No'), ['2 Nos', '1 No', '1 No']);
assert.strictEqual(qtyTokens('1 SET (2 for spare)'), null, 'a stray word means we do not guess');
assert.deepStrictEqual(qtyTokens('2.0 Mtrs.'), ['2.0 Mtrs.']);
console.log('lib/qty-units.mjs self-check: all assertions passed.');
