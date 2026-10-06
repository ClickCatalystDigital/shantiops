// lib/multi-value-selfcheck.mjs — runnable check for lib/multi-value.mjs.
//   node lib/multi-value-selfcheck.mjs
import assert from 'node:assert';
import { splitVariants, splitLabeledSizeList, splitKnownBundles } from './multi-value.mjs';

function selfcheck() {
  // --- splitLabeledSizeList: the real STF-IBR-060/057 "PLATE SIZE :" rows (2026-09, user-directed) ---
  const row1 = { material_description: 'PLATE SIZE :', moc: 'MS',
    size_spec: '10 X 500 X 1200 - 1 Nos                             12 X 1500 X 2000 - 1 Nos                          16 X 1100 X 1100 - 1 Nos',
    qty_text: null };
  assert.deepStrictEqual(splitLabeledSizeList(row1), [
    { material_description: 'PLATE', moc: 'MS', size_spec: '10 MM THK X 500 X 1200', qty_text: '1 Nos' },
    { material_description: 'PLATE', moc: 'MS', size_spec: '12 MM THK X 1500 X 2000', qty_text: '1 Nos' },
    { material_description: 'PLATE', moc: 'MS', size_spec: '16 MM THK X 1100 X 1100', qty_text: '1 Nos' },
  ], 'each clause becomes its own item, thickness first and marked "MM THK" so keyDim can find it');

  const row2 = { material_description: 'PLATE SIZE :', moc: 'MS',
    size_spec: '8 X 1500 X 6300 - 2 -1/2 Nos                                                             10 X 500 X 1200 - 1 Nos                                    12 X 1500 X 800 - 1 Nos                                             16 X 1500 X 4000 - 1 Nos',
    qty_text: null };
  const out2 = splitLabeledSizeList(row2);
  assert.strictEqual(out2.length, 4);
  assert.strictEqual(out2[0].size_spec, '8 MM THK X 1500 X 6300');
  assert.strictEqual(out2[0].qty_text, '2.5 Nos', 'a mangled "2 -1/2" mixed fraction is preserved exactly as 2.5, never dropped to 2');
  assert.strictEqual(out2[1].qty_text, '1 Nos', 'a plain quantity with no fraction is unaffected');

  // --- not a labeled-size-list: wrong label, single clause, or no bundle at all ---
  assert.strictEqual(splitLabeledSizeList({ material_description: 'CHANNEL SIZE :', moc: 'MS', size_spec: '10 X 500 X 1200 - 1 Nos   12 X 1500 X 2000 - 1 Nos' }), null, 'only "PLATE SIZE" is evidenced — a different label must not be swept in speculatively');
  assert.strictEqual(splitLabeledSizeList({ material_description: 'PLATE SIZE :', moc: 'MS', size_spec: '10 X 500 X 1200 - 1 Nos' }), null, 'a single clause is not a bundle — left to the normal single-item path');
  assert.strictEqual(splitLabeledSizeList({ material_description: 'PLATE', moc: 'MS', size_spec: '10 X 500 X 1200' }), null, 'an ordinary plate line (no "SIZE :" label) is untouched');
  assert.strictEqual(splitLabeledSizeList({ material_description: 'PLATE SIZE :', moc: 'MS', size_spec: '' }), null, 'blank size_spec');

  // --- splitVariants: pre-existing behavior, unaffected by adding a sibling export to this file ---
  const v = splitVariants({ material_description: 'MS ANGLE', moc: 'MS', size_spec: '50x50x5\n65x65x6', qty_text: '2 Nos 1 No' });
  assert.strictEqual(v.length, 2);
  assert.strictEqual(v[0].size_spec, '50x50x5');
  assert.strictEqual(v[1].qty_text, '1 Nos', 'formatQty normalizes "No" to the canonical "Nos"');
  assert.strictEqual(splitVariants({ material_description: 'PLATE', moc: 'MS', size_spec: '10mm', qty_text: '1 Nos' }), null, 'a single quantity never splits');

  // --- splitKnownBundles: values one space apart, or one quantity for several pieces ---
  const kb = (d, s, q, moc = 'MS') => splitKnownBundles({ material_description: d, moc, size_spec: s, qty_text: q });
  assert.deepStrictEqual(kb('MS BOLT WITH NUTS', '5/8" - 2 1/2" 1/2" - 2"', '100 Nos             25 Nos').map(v => [v.size_spec, v.qty_text]), [['5/8" - 2 1/2"', '100 Nos'], ['1/2" - 2"', '25 Nos']]);
  assert.deepStrictEqual(kb('MS STRUCTURE SUPPORT', 'ISMC 100x50 ISA50x50', '10 Mtr.          6 Mtr.').map(v => [v.size_spec, v.qty_text]), [['ISMC 100x50', '10 Mtr'], ['ISA50x50', '6 Mtr']]);
  assert.deepStrictEqual(kb('PULLEY', 'B3 - 8" B3- 7"', '1 No 1 No').map(v => [v.size_spec, v.qty_text]), [['B3 - 8"', '1 Nos'], ['B3- 7"', '1 Nos']]);
  assert.deepStrictEqual(kb('SHAFT', 'ø100 x 115 Lg/ 63dia 900 lg', '1 Set', 'EN-8').map(v => [v.size_spec, v.qty_text]), [['ø100 x 115 Lg', '1 Nos'], ['ø63 x 900 Lg', '1 Nos']]);
  assert.deepStrictEqual(kb('MS SADDLE/ LUGS', '1850 x 1850 x 12 THK - 1 Nos          1850 x 2500 x 10 THK - 1 Nos', '-').map(v => [v.size_spec, v.qty_text]), [['1850 x 1850 x 12 THK', '1 Nos'], ['1850 x 2500 x 10 THK', '1 Nos']]);
  assert.strictEqual(kb('SHAFT', 'ø100 x 115 Lg', '1 Set'), null, 'one rod is not a bundle');
  assert.strictEqual(kb('SHAFT', 'ø100 x 115 Lg ø63 x 900 Lg', '2 Set'), null, 'only "1 Set" is read as one of each');
  assert.strictEqual(kb('MS BOLT WITH NUTS', '5/8" - 2 1/2" 1/2" - 2"', '100 Nos'), null, 'two sizes, one quantity: never guessed');
  assert.strictEqual(kb('MS ANGLE', 'ISA 50x50x5 welded to ISMC 100x50', '10 Mtr 6 Mtr'), null, 'extra words in the size cell: left alone');
  assert.strictEqual(kb('PLATE', '10 x 500 x 1200', '1 Nos'), null);

  console.log('lib/multi-value.mjs self-check: all assertions passed.');
}

selfcheck();
