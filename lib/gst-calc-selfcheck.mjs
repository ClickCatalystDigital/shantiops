// node lib/gst-calc-selfcheck.mjs — real assert checks for lib/gst-calc.mjs, no app boot needed.
import assert from 'node:assert';
import { financialYear, gstSplit, tdsAmount } from './gst-calc.mjs';

// financialYear
assert.strictEqual(financialYear('2026-04-01'), '2026-27');
assert.strictEqual(financialYear('2027-03-31'), '2026-27');
assert.strictEqual(financialYear('2026-03-31'), '2025-26');
assert.strictEqual(financialYear('2026-08-20'), '2026-27');

// gstSplit — intra-state
let r = gstSplit({ taxableAmount: 1000, ratePct: 18, companyStateCode: '36', customerStateCode: '36' });
assert.strictEqual(r.taxAmount, 180);
assert.strictEqual(r.cgst, 90);
assert.strictEqual(r.sgst, 90);
assert.strictEqual(r.igst, 0);

// gstSplit — inter-state
r = gstSplit({ taxableAmount: 1000, ratePct: 18, companyStateCode: '36', customerStateCode: '27' });
assert.strictEqual(r.taxAmount, 180);
assert.strictEqual(r.cgst, 0);
assert.strictEqual(r.sgst, 0);
assert.strictEqual(r.igst, 180);

// gstSplit — odd rupee amount splits without losing a paisa
r = gstSplit({ taxableAmount: 333.33, ratePct: 18, companyStateCode: '36', customerStateCode: '36' });
assert.strictEqual(Math.round((r.cgst + r.sgst) * 100), Math.round(r.taxAmount * 100));

// gstSplit — missing state codes falls back to IGST rather than guessing intra-state
r = gstSplit({ taxableAmount: 1000, ratePct: 18, companyStateCode: '36', customerStateCode: null });
assert.strictEqual(r.igst, 180);
assert.strictEqual(r.cgst, 0);

// tdsAmount
assert.strictEqual(tdsAmount({ payableAmount: 50000, ratePct: 2, thresholdAmount: 30000 }), 1000);
assert.strictEqual(tdsAmount({ payableAmount: 20000, ratePct: 2, thresholdAmount: 30000 }), 0);
assert.strictEqual(tdsAmount({ payableAmount: 50000, ratePct: 10, thresholdAmount: null }), 5000);

console.log('gst-calc-selfcheck: all checks passed');
