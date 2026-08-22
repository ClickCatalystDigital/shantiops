// scripts/cash-flow-selfcheck.mjs — node scripts/cash-flow-selfcheck.mjs
// Pure-function checks for lib/cash-flow.mjs's indirectCashFlow(). No DB, no fake data written
// anywhere. The real invariant an indirect-method Cash Flow Statement must satisfy: its computed
// net change in cash must equal the ACTUAL net change in the Bank & Cash account for the same
// rows — that's what this selfcheck proves, not just that the arithmetic runs.
import { strict as assert } from 'node:assert';
import { indirectCashFlow } from '../lib/cash-flow.mjs';
import { ACCOUNT_CODES, DEFAULT_CHART_OF_ACCOUNTS, fixedAssetDisposalLines } from '../lib/ledger.mjs';

const NAME = Object.fromEntries(DEFAULT_CHART_OF_ACCOUNTS.map(([code, name]) => [code, name]));
const TYPE = Object.fromEntries(DEFAULT_CHART_OF_ACCOUNTS.map(([code, , type]) => [code, type]));

// Turns [{accountCode, debit, credit}] lines (lib/ledger.mjs's own line shape) into the row shape
// getLedgerLines()/trialBalance() expect.
function rows(...entries) {
  return entries.flat().map(l => ({
    account_code: l.accountCode, account_name: NAME[l.accountCode], account_type: TYPE[l.accountCode],
    debit: l.debit || 0, credit: l.credit || 0,
  }));
}
const L = (accountCode, debit, credit) => ({ accountCode, debit, credit });

// --- a realistic mixed period: sales (partial collection), a vendor bill (partial payment),
// salary paid direct, a fixed-asset purchase, a depreciation run, a disposal at a loss, a disposal
// at a gain, and an equity injection. ---------------------------------------------------------
const periodRows = rows(
  // Sales Invoice: Dr AR 1180, Cr Revenue 1000, Cr GST Output 180
  [L(ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, 1180, 0), L(ACCOUNT_CODES.SALES_REVENUE, 0, 1000), L(ACCOUNT_CODES.GST_OUTPUT_PAYABLE, 0, 180)],
  // Partial customer receipt: Dr Bank 700, Cr AR 700
  [L(ACCOUNT_CODES.BANK_CASH, 700, 0), L(ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, 0, 700)],
  // Vendor Bill: Dr Material Consumed 500, Dr GST Input 90, Cr AP 590
  [L(ACCOUNT_CODES.MATERIAL_CONSUMED, 500, 0), L(ACCOUNT_CODES.GST_INPUT_CREDIT, 90, 0), L(ACCOUNT_CODES.ACCOUNTS_PAYABLE, 0, 590)],
  // Partial vendor payment: Dr AP 300, Cr Bank 300
  [L(ACCOUNT_CODES.ACCOUNTS_PAYABLE, 300, 0), L(ACCOUNT_CODES.BANK_CASH, 0, 300)],
  // Salary paid direct: Dr Salary Expense 200, Cr Bank 200
  [L(ACCOUNT_CODES.SALARY_EXPENSE, 200, 0), L(ACCOUNT_CODES.BANK_CASH, 0, 200)],
  // Fixed asset purchase: Dr Fixed Assets 1000, Cr Bank 1000
  [L(ACCOUNT_CODES.FIXED_ASSETS, 1000, 0), L(ACCOUNT_CODES.BANK_CASH, 0, 1000)],
  // Depreciation run: Dr Depreciation Expense 50, Cr Accumulated Depreciation 50
  [L(ACCOUNT_CODES.DEPRECIATION_EXPENSE, 50, 0), L(ACCOUNT_CODES.ACCUMULATED_DEPRECIATION, 0, 50)],
  // Disposal at a loss: cost 200, accumulated dep 50, received 100 -> loss 50
  fixedAssetDisposalLines({ cost: 200, accumulatedDepreciation: 50, disposalAmount: 100 }),
  // Disposal at a gain: cost 150, accumulated dep 100, received 80 -> gain 30
  fixedAssetDisposalLines({ cost: 150, accumulatedDepreciation: 100, disposalAmount: 80 }),
  // Equity injection: Dr Bank 500, Cr Owner's Equity 500
  [L(ACCOUNT_CODES.BANK_CASH, 500, 0), L(ACCOUNT_CODES.OWNERS_EQUITY, 0, 500)],
);

// investingCashLines: the Bank & Cash lines from the two fixed-asset-sourced events (purchase +
// both disposals) — exactly what lib/data.js's getFixedAssetCashLines would return for real rows.
const investingCashLines = [
  { debit: 0, credit: 1000 }, // purchase
  { debit: 100, credit: 0 },  // disposal (loss) proceeds
  { debit: 80, credit: 0 },   // disposal (gain) proceeds
];

const actualBankChange = periodRows
  .filter(r => r.account_code === ACCOUNT_CODES.BANK_CASH)
  .reduce((s, r) => s + r.debit - r.credit, 0);

const result = indirectCashFlow(periodRows, investingCashLines);

assert.equal(result.operating.netProfit, 230, `netProfit: expected 230, got ${result.operating.netProfit}`);
assert.equal(result.operating.depreciationAddback, 50);
assert.equal(result.operating.disposalReversal, 20, 'a net -20 in Gain/Loss must be fully reversed out of operating (+20)');
assert.equal(result.operating.workingCapitalTotal, -100);
assert.equal(result.operating.netOperating, 200);
assert.equal(result.investing.netInvesting, -820);
assert.equal(result.financing.netFinancing, 500);

assert.equal(result.netChangeInCash, actualBankChange, `indirect method (${result.netChangeInCash}) must tie to the real Bank & Cash movement (${actualBankChange})`);
assert.equal(result.netChangeInCash, -120);

// --- account-level override actually moves a working-capital account out of Operating ----------
{
  const withOverride = indirectCashFlow(periodRows, investingCashLines, {
    categoryOverrides: { [ACCOUNT_CODES.GST_OUTPUT_PAYABLE]: 'financing' },
  });
  assert.equal(withOverride.operating.workingCapitalTotal, -100 - 180, 'GST Output Payable\'s +180 cash effect must leave the operating bucket once overridden');
  assert.equal(withOverride.financing.netFinancing, 500 + 180, 'and land in financing instead');
  assert.equal(withOverride.netChangeInCash, actualBankChange, 'total cash movement is unchanged by re-categorization — only the section split moves');
}

// --- a quiet period (no postings) must be all zeros, not a crash on an empty trial balance -------
{
  const empty = indirectCashFlow([], []);
  assert.equal(empty.netChangeInCash, 0);
  assert.equal(empty.operating.netOperating, 0);
}

console.log('lib/cash-flow.mjs selfcheck: all assertions passed');
