// lib/multi-value-selfcheck.mjs — runnable check for lib/multi-value.mjs.
//   node lib/multi-value-selfcheck.mjs
import assert from 'node:assert';
import { splitVariants, splitLabeledSizeList } from './multi-value.mjs';

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

  console.log('lib/multi-value.mjs self-check: all assertions passed.');
}

selfcheck();
