// lib/cash-flow.mjs — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 9. Indirect-method Cash Flow
// Statement (confirmed with user: indirect method; account-level category with a type-based
// default, not per-transaction tagging). Dependency-free, same precedent as lib/ledger.mjs — pure
// rollup over already-fetched rows, own selfcheck.
import { DEBIT_NORMAL_TYPES, ACCOUNT_CODES, trialBalance, profitAndLoss } from './ledger.mjs';

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

// Default category when chart_of_accounts.cash_flow_category is unset for that account. Bank &
// Cash is the balance this whole statement explains, not a flow line itself. Fixed Assets /
// Accumulated Depreciation are asset-type by chart-of-accounts convention but their balance
// change isn't their cash effect (see indirectCashFlow's own comment on investingCashLines) — code
// exception, not a type rule.
export function defaultCashFlowCategory(accountCode, accountType) {
  if (accountCode === ACCOUNT_CODES.BANK_CASH) return 'cash';
  if (accountCode === ACCOUNT_CODES.FIXED_ASSETS || accountCode === ACCOUNT_CODES.ACCUMULATED_DEPRECIATION) return 'investing';
  if (accountType === 'equity') return 'financing';
  return 'operating';
}

function categoryFor(accountCode, accountType, overrides) {
  if (accountCode === ACCOUNT_CODES.BANK_CASH) return 'cash'; // structural — never overridable
  return overrides[accountCode] || defaultCashFlowCategory(accountCode, accountType);
}

// trialBalance()'s `balance` is already signed by each account's own normal-balance direction
// (positive = increased in its normal direction). Reading that as a cash effect just needs one
// type-dependent flip: an asset balance increasing means cash was used (negative); a
// liability/equity balance increasing means cash was sourced (positive).
function cashEffect(account) {
  return DEBIT_NORMAL_TYPES.has(account.account_type) ? -account.balance : account.balance;
}

// periodRows: getLedgerLines(company, {from, to}) — a period slice, not cumulative (same input
// trialBalance()/profitAndLoss() already take).
//
// investingCashLines: the Bank & Cash journal_entry_lines whose journal_entries.source_type is
// 'fixed_asset' or 'fixed_asset_disposal', within the same period (lib/data.js's
// getFixedAssetCashLines). This is the one place a generic account-balance-change loop would be
// wrong: a disposal removes the asset's cost from the Fixed Assets account at book value, and
// removes whatever it had accumulated from Accumulated Depreciation — neither number is the actual
// cash received, which is a separate plug (lib/ledger.mjs's fixedAssetDisposalLines). Reading the
// real Bank & Cash lines for these two source types sidesteps that entirely and is always correct,
// including if a future on-account fixed-asset purchase path is ever added (this file doesn't
// assume fixedAssetPurchaseLines always touches Bank & Cash directly, even though it does today).
export function indirectCashFlow(periodRows, investingCashLines, { categoryOverrides = {} } = {}) {
  const tb = trialBalance(periodRows);
  const { netProfit } = profitAndLoss(periodRows);
  const byCode = new Map(tb.accounts.map(a => [a.account_code, a]));

  const depreciation = byCode.get(ACCOUNT_CODES.DEPRECIATION_EXPENSE);
  const depreciationAddback = depreciation ? round2(depreciation.balance) : 0;

  // The disposal gain/loss account is already inside netProfit (it's income-type). Its real cash
  // effect is fully captured by investingCashLines' disposal proceeds instead, so it's backed out
  // here rather than double-counted: subtracting a gain removes it, subtracting a (negative-balance)
  // loss adds it back.
  const disposal = byCode.get(ACCOUNT_CODES.ASSET_DISPOSAL_GAIN_LOSS);
  const disposalReversal = disposal ? round2(-disposal.balance) : 0;

  const workingCapital = tb.accounts
    .filter(a => ['asset', 'liability'].includes(a.account_type) && categoryFor(a.account_code, a.account_type, categoryOverrides) === 'operating')
    .map(a => ({ account_code: a.account_code, account_name: a.account_name, change: cashEffect(a) }));
  const workingCapitalTotal = round2(workingCapital.reduce((s, w) => s + w.change, 0));

  const netOperating = round2(netProfit + depreciationAddback + disposalReversal + workingCapitalTotal);

  const netInvesting = round2(investingCashLines.reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0));

  const financing = tb.accounts
    .filter(a => categoryFor(a.account_code, a.account_type, categoryOverrides) === 'financing')
    .map(a => ({ account_code: a.account_code, account_name: a.account_name, change: cashEffect(a) }));
  const netFinancing = round2(financing.reduce((s, f) => s + f.change, 0));

  const netChangeInCash = round2(netOperating + netInvesting + netFinancing);

  return {
    operating: { netProfit, depreciationAddback, disposalReversal, workingCapital, workingCapitalTotal, netOperating },
    investing: { lines: investingCashLines, netInvesting },
    financing: { lines: financing, netFinancing },
    netChangeInCash,
  };
}
