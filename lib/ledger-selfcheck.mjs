// lib/ledger-selfcheck.mjs — run with `node lib/ledger-selfcheck.mjs`. Same precedent as
// lib/gst-calc.mjs's matching selfcheck.
import assert from 'node:assert/strict';
import {
  assertBalanced, salesInvoiceLines, salesCreditNoteLines, vendorBillLines,
  purchaseDebitNoteLines, salarySlipLines, trialBalance, profitAndLoss, balanceSheet,
  customerReceiptLines, vendorPaymentLines, materialConsumptionLines, reversedLines,
} from './ledger.mjs';

// Sales Invoice: 100000 subtotal, 18000 tax -> AR 118000 = Revenue 100000 + GST Payable 18000.
{
  const lines = salesInvoiceLines({ subtotal: 100000, taxAmount: 18000, total: 118000 });
  assertBalanced(lines);
  assert.equal(lines.find(l => l.accountCode === '1100').debit, 118000);
}

// Vendor Bill with TDS deducted still balances (Inventory + GST Input = AP + TDS Payable).
{
  const lines = vendorBillLines({ subtotal: 50000, taxAmount: 9000, tdsAmount: 500, payableAmount: 58500 });
  assertBalanced(lines);
  assert.ok(!lines.some(l => l.accountCode === '2300' && !l.credit)); // TDS line present only with a real amount
}

// Vendor Bill with no TDS: no TDS Payable line at all, and it still balances.
{
  const lines = vendorBillLines({ subtotal: 20000, taxAmount: 3600, tdsAmount: 0, payableAmount: 23600 });
  assertBalanced(lines);
  assert.ok(!lines.some(l => l.accountCode === '2300'));
}

// Credit note / debit note: single reversing dr/cr pair, trivially balanced.
assertBalanced(salesCreditNoteLines({ amount: 5000 }));
assertBalanced(purchaseDebitNoteLines({ amount: 2000 }));

// Salary slip: employer PF/ESI share inflates Salary Expense above net pay + employee deductions.
{
  const lines = salarySlipLines({
    grossEarnings: 50000, pfEmployee: 1800, pfEmployer: 1800, esiEmployee: 375, esiEmployer: 1625,
    ptAmount: 200, tdsAmount: 1000, netPay: 46625,
  });
  assertBalanced(lines);
  assert.equal(lines.find(l => l.accountCode === '5200').debit, 53425); // 50000 + 1800 + 1625
}

// A deliberately unbalanced set of lines must throw.
assert.throws(() => assertBalanced([{ debit: 100, credit: 0 }, { debit: 0, credit: 90 }]));

// Customer receipt / vendor payment: both balance, and move the right accounts.
{
  const r = customerReceiptLines({ amount: 50000 });
  assertBalanced(r);
  assert.equal(r.find(l => l.accountCode === '1001').debit, 50000);
  assert.equal(r.find(l => l.accountCode === '1100').credit, 50000);
  const p = vendorPaymentLines({ amount: 20000 });
  assertBalanced(p);
  assert.equal(p.find(l => l.accountCode === '2100').debit, 20000);
  assert.equal(p.find(l => l.accountCode === '1001').credit, 20000);
}

// Material consumption: Inventory down, Material Consumed up, by the same costed amount.
{
  const m = materialConsumptionLines({ amount: 4500 });
  assertBalanced(m);
  assert.equal(m.find(l => l.accountCode === '5100').debit, 4500);
  assert.equal(m.find(l => l.accountCode === '1200').credit, 4500);
}

// Reversal: every line's debit/credit swapped, and the result still balances.
{
  const original = salesInvoiceLines({ subtotal: 1000, taxAmount: 180, total: 1180 });
  const reversed = reversedLines(original);
  assertBalanced(reversed);
  assert.equal(reversed.find(l => l.accountCode === '1100').credit, 1180);
  assert.equal(reversed.find(l => l.accountCode === '1100').debit, 0);
}

// Trial balance / P&L / Balance Sheet rollups over a tiny synthetic ledger (one posted invoice).
{
  const rows = [
    { account_code: '1100', account_name: 'Accounts Receivable', account_type: 'asset', debit: 118000, credit: 0 },
    { account_code: '4100', account_name: 'Sales Revenue', account_type: 'income', debit: 0, credit: 100000 },
    { account_code: '2200', account_name: 'GST Output Payable', account_type: 'liability', debit: 0, credit: 18000 },
  ];
  const tb = trialBalance(rows);
  assert.equal(tb.totalDebit, tb.totalCredit);
  const pl = profitAndLoss(rows);
  assert.equal(pl.netProfit, 100000);
  const bs = balanceSheet(rows);
  assert.equal(bs.totalAssets, 118000);
  assert.equal(round(bs.totalLiabilities + bs.totalEquity), 118000);
}

function round(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

console.log('lib/ledger.mjs selfcheck: all assertions passed');
