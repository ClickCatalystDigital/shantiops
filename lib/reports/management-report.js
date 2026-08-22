// lib/reports/management-report.js — REPORT-ENGINE-MATURITY.md §1.2's composite Management Report:
// one page of headline numbers (liquidity, P&L, AR/AP exposure, balance sheet) instead of another
// single-metric report. Built entirely from compute() functions the existing catalog reports
// already call — no new data queries, no new ledger math, per the doc's own "second consumer of
// data already shaped" principle. Per-company, as-of-today snapshot only (no period comparison,
// no drill-down) — the smallest version that's still "one document a director opens."
import { computeProfitLoss } from '@/app/api/reports/profit-loss/route.js';
import { computeBalanceSheet } from '@/app/api/reports/balance-sheet/route.js';
import { computeArAging } from '@/app/api/reports/ar-aging/route.js';
import { computeApAging } from '@/app/api/reports/ap-aging/route.js';
import { computeStockValuation } from '@/app/api/reports/stock-valuation/route.js';
import { todayISO, currentFyBounds } from '@/lib/date';

const CASH_ACCOUNT_CODE = '1001'; // Bank & Cash, same account Cash/Bank Book reports against

export async function computeManagementReport(company, { asOf } = {}) {
  const resolvedAsOf = asOf || todayISO();
  const monthStart = `${resolvedAsOf.slice(0, 7)}-01`;
  const fy = currentFyBounds();

  const [balanceSheetResult, mtdPnl, fytdPnl, arAging, apAging, stockValuation] = await Promise.all([
    computeBalanceSheet(company, { asOf: resolvedAsOf }),
    computeProfitLoss(company, { from: monthStart, to: resolvedAsOf }),
    computeProfitLoss(company, { from: fy.from, to: resolvedAsOf }),
    computeArAging(company, { asOf: resolvedAsOf }),
    computeApAging(company, { asOf: resolvedAsOf }),
    computeStockValuation(),
  ]);

  const cash = balanceSheetResult.assets.find((a) => a.account_code === CASH_ACCOUNT_CODE)?.balance || 0;
  // Inventory is shop-wide, not company-split (Stores is one shared warehouse, same as Stock
  // Valuation itself) — mixed with company-scoped cash/AR/AP here anyway, since a director reading
  // "working capital" wants the one number, not a caveat about which half is shared stock.
  const inventoryValue = stockValuation.totalValue;
  const workingCapital = cash + arAging.total + inventoryValue - apAging.total;

  return {
    asOf: resolvedAsOf,
    fy,
    cash,
    arTotal: arAging.total,
    apTotal: apAging.total,
    inventoryValue,
    workingCapital,
    balanceSheet: balanceSheetResult,
    mtdPnl,
    fytdPnl,
    arAging,
    apAging,
  };
}
