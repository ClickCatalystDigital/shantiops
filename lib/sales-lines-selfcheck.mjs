// node lib/sales-lines-selfcheck.mjs
import assert from 'node:assert/strict';
import { lineAmount, linesTotal, quotationTotals, normalizeProductLines } from './sales-lines.mjs';

assert.equal(lineAmount({ qty: 2, rate: 1000, discount_pct: 10 }), 1800);
assert.equal(lineAmount({ qty: '3', rate: '250.5' }), 751.5);
assert.equal(lineAmount({ qty: '', rate: 100 }), 0);
assert.equal(linesTotal([{ qty: 1, rate: 100 }, { qty: 2, rate: 50, discount_pct: 50 }]), 150);

// Intra-state (both Telangana, 36): CGST + SGST halves.
const intra = quotationTotals([{ qty: 1, rate: 100000, gst_pct: 18 }], { companyStateCode: '36', customerStateCode: '36' });
assert.equal(intra.subtotal, 100000);
assert.equal(intra.cgst, 9000); assert.equal(intra.sgst, 9000); assert.equal(intra.igst, 0);
assert.equal(intra.total, 118000);
assert.equal(intra.uniformGstPct, 18);

// Inter-state: IGST only.
const inter = quotationTotals([{ qty: 1, rate: 100000, gst_pct: 18 }], { companyStateCode: '36', customerStateCode: '27' });
assert.equal(inter.igst, 18000); assert.equal(inter.cgst, 0);

// Unknown customer state: never guesses intra-state — IGST.
assert.equal(quotationTotals([{ qty: 1, rate: 100, gst_pct: 18 }], { companyStateCode: '36' }).igst, 18);

// Mixed rates per line, discount applied first; blank rate falls back to the document rate.
const mixed = quotationTotals(
  [{ qty: 1, rate: 1000, discount_pct: 10, gst_pct: 18 }, { qty: 2, rate: 500, gst_pct: 5 }, { qty: 1, rate: 100, gst_pct: '' }],
  { companyStateCode: '36', customerStateCode: '27', fallbackGstPct: 12 },
);
assert.equal(mixed.subtotal, 2000);           // 900 + 1000 + 100
assert.equal(mixed.igst, 162 + 50 + 12);      // 18% of 900, 5% of 1000, 12% of 100
assert.equal(mixed.uniformGstPct, null);
assert.equal(mixed.lines[2].gst_pct, 12);

// Enquiry product lines: blank rows dropped, product defaults filled, bad input refused.
const products = new Map([[7, { id: 7, product_name: 'Steam Boiler 1 TPH', unit: 'Nos', price: 500000, gst_pct: 18 }]]);
const n = normalizeProductLines([
  { product_id: 7, qty: 2 },
  { description: '  ', qty: 1 },
  { description: 'Installation', qty: 1, unit: 'Set', rate: '25000', gst_pct: '' },
], products);
assert.equal(n.lines.length, 2);
assert.deepEqual(n.lines[0], { product_id: 7, description: 'Steam Boiler 1 TPH', qty: 2, unit: 'Nos', rate: 500000, gst_pct: 18, sort_order: 0 });
assert.equal(n.lines[1].rate, 25000); assert.equal(n.lines[1].gst_pct, null); assert.equal(n.lines[1].sort_order, 1);
assert.equal(linesTotal(n.lines.map(l => ({ qty: l.qty ?? 1, rate: l.rate }))), 1025000);
assert.ok(normalizeProductLines([{ product_id: 99 }], products).error);
assert.ok(normalizeProductLines([{ description: 'x', qty: -1 }]).error);
assert.ok(normalizeProductLines([{ description: 'x', gst_pct: 150 }]).error);
assert.ok(normalizeProductLines('nope').error);
assert.deepEqual(normalizeProductLines(undefined), { lines: [] });

console.log('sales-lines selfcheck: all assertions passed');
