// scripts/ledger-selfcheck.mjs — node scripts/ledger-selfcheck.mjs
// Pure-function checks for lib/ledger.mjs's per-trigger line builders that don't already have
// their own selfcheck: vendorBillLines (normal + RCM), salesInvoiceLines (normal + RCM),
// fixedAssetDisposalLines (gain + loss). No DB, no fake data — every posted amount here is
// invented purely to exercise the math, never written anywhere.
import { strict as assert } from 'node:assert';
import { assertBalanced, vendorBillLines, salesInvoiceLines, fixedAssetDisposalLines } from '../lib/ledger.mjs';

function sum(lines, key) { return lines.reduce((s, l) => s + (l[key] || 0), 0); }
function lineFor(lines, code) { return lines.find(l => l.accountCode === code); }

// --- vendorBillLines: normal case ------------------------------------------------------------
{
  const lines = vendorBillLines({ subtotal: 1000, taxAmount: 180, tdsAmount: 10, payableAmount: 1170 });
  assertBalanced(lines);
  assert.equal(lineFor(lines, '2200'), undefined, 'normal purchase must not touch GST Output Payable');
  assert.equal(lineFor(lines, '2100').credit, 1170, 'AP should be the full payable amount (tax included) minus nothing extra');
}

// --- vendorBillLines: reverse charge — AP excludes tax, self-assessed liability posted --------
{
  const lines = vendorBillLines({ subtotal: 1000, taxAmount: 180, tdsAmount: 10, payableAmount: 1170, isReverseCharge: true });
  assertBalanced(lines);
  assert.equal(lineFor(lines, '1300').debit, 180, 'Input Credit still claimed under RCM');
  assert.equal(lineFor(lines, '2200').credit, 180, 'GST Output Payable (self-assessed) must equal the tax amount');
  assert.equal(lineFor(lines, '2100').credit, 990, 'AP must exclude tax (1170 payable - 180 tax = 990)');
}

// --- salesInvoiceLines: normal case ------------------------------------------------------------
{
  const lines = salesInvoiceLines({ subtotal: 1000, taxAmount: 180, total: 1180 });
  assertBalanced(lines);
  assert.equal(lineFor(lines, '2200').credit, 180);
  assert.equal(lineFor(lines, '1100').debit, 1180);
}

// --- salesInvoiceLines: reverse charge — no GST line at all, AR is taxable value only ----------
{
  const lines = salesInvoiceLines({ subtotal: 1000, taxAmount: 180, total: 1180, isReverseCharge: true });
  assertBalanced(lines);
  assert.equal(lineFor(lines, '2200'), undefined, 'RCM sales invoice must post no output-tax liability at all');
  assert.equal(lineFor(lines, '1100').debit, 1000, 'AR must be taxable value only under RCM');
  assert.equal(lines.length, 2, 'RCM sales invoice is exactly two lines: AR and Revenue');
}

// --- fixedAssetDisposalLines: loss (sold for less than book value) -----------------------------
{
  // cost 100000, accumulated dep 60000 -> book value 40000, sold for 25000 -> loss of 15000
  const lines = fixedAssetDisposalLines({ cost: 100000, accumulatedDepreciation: 60000, disposalAmount: 25000 });
  assertBalanced(lines);
  const glLine = lineFor(lines, '4200');
  assert.equal(glLine.debit, 15000, 'a sale below book value must debit the Gain/Loss account (a loss)');
  assert.equal(glLine.credit, 0);
  assert.equal(lineFor(lines, '1400').credit, 100000, 'Fixed Assets must be cleared at full cost');
  assert.equal(lineFor(lines, '1410').debit, 60000, 'Accumulated Depreciation must be cleared');
}

// --- fixedAssetDisposalLines: gain (sold for more than book value) -----------------------------
{
  // cost 100000, accumulated dep 90000 -> book value 10000, sold for 22000 -> gain of 12000
  const lines = fixedAssetDisposalLines({ cost: 100000, accumulatedDepreciation: 90000, disposalAmount: 22000 });
  assertBalanced(lines);
  const glLine = lineFor(lines, '4200');
  assert.equal(glLine.credit, 12000, 'a sale above book value must credit the Gain/Loss account (a gain)');
  assert.equal(glLine.debit, 0);
}

// --- fixedAssetDisposalLines: exact book value — no gain/loss line at all ----------------------
{
  const lines = fixedAssetDisposalLines({ cost: 100000, accumulatedDepreciation: 70000, disposalAmount: 30000 });
  assertBalanced(lines);
  assert.equal(lineFor(lines, '4200'), undefined, 'disposal at exactly book value must not post a zero-amount gain/loss line');
}

// --- fixedAssetDisposalLines: mistake correction — dispose at 0 to undo a wrong entry -----------
{
  const lines = fixedAssetDisposalLines({ cost: 50000, accumulatedDepreciation: 0, disposalAmount: 0 });
  assertBalanced(lines);
  assert.equal(lineFor(lines, '4200').debit, 50000, 'disposing a fresh mistake at 0 is a full loss of its cost, correctly reversing the purchase');
}

console.log('ledger-selfcheck OK');
