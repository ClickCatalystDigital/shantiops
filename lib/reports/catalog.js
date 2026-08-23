// lib/reports/catalog.js — single source of truth for which reports exist, which department they
// belong to, and how to compute + table-ify them. Nav (which departments get a Reports tab) and
// ReportsWorkspace (what shows under it) both read this list — REPORT-ENGINE-PLAN §"Reports tab is
// catalog-driven". Entries are added here exactly as they're built per the plan's §10 phasing,
// never ahead of it.
//
// Entry shape: { key, title, department, compute, toTable, totals?, subtitle?, heavy?, needsCompany? }
// - compute(company, {from,to,customerId,...}) -> result — same function the report's own JSON
//   route imports, so PDF/screen never disagree (ground rule 2).
// - toTable(result) -> {cols, rows} for <ReportTable>.
// - totals(result) -> [[label,value]] pairs for the PDF's closing totals line (optional).
// - subtitle(result, {from,to}) -> string for the PDF header's subtitle line (optional; default is
//   the from/to range when both are present).
// - heavy: true means "PDF export must not default to all-time" (see currentFyBounds in the export
//   route) — an unbounded GL-backed roll-up could be hundreds of pages.
// - needsCompany: false hides ReportsWorkspace's company switcher for reports with no company split
//   (e.g. Stock Valuation — Stores is one shared warehouse). Defaults to true.
import { computeTrialBalance } from '@/app/api/reports/trial-balance/route.js';
import { computeCustomerLedger } from '@/app/api/reports/customer-ledger/route.js';
import { computeStockValuation } from '@/app/api/reports/stock-valuation/route.js';
import { computeProfitLoss } from '@/app/api/reports/profit-loss/route.js';
import { computeBalanceSheet } from '@/app/api/reports/balance-sheet/route.js';
import { computeGstr1 } from '@/app/api/reports/gstr1/route.js';
import { computeGstr3b } from '@/app/api/reports/gstr3b/route.js';
import { computeItcReconciliation } from '@/app/api/reports/itc-reconciliation/route.js';
import { computeArAging } from '@/app/api/reports/ar-aging/route.js';
import { computeApAging } from '@/app/api/reports/ap-aging/route.js';
import { computeVendorLedger } from '@/app/api/reports/vendor-ledger/route.js';
import { computeCashBook } from '@/app/api/reports/cash-book/route.js';
import { computeJournalRegister } from '@/app/api/reports/journal-register/route.js';
import { computePurchaseRegister } from '@/app/api/reports/purchase-register/route.js';
import { computeSalesRegister } from '@/app/api/reports/sales-register/route.js';
import { computeInventoryAging } from '@/app/api/reports/inventory-aging/route.js';
import { computeStockLedger } from '@/app/api/reports/stock-ledger/route.js';
import { computeMaterialConsumption } from '@/app/api/reports/material-consumption/route.js';
import { computeBankReconciliation } from '@/app/api/reports/bank-reconciliation/route.js';
import { computeWorkOrderRegister } from '@/app/api/reports/work-order-register/route.js';
import { computeProductionCostVariance } from '@/app/api/reports/production-cost-variance/route.js';
import { computeReworkRejection } from '@/app/api/reports/rework-rejection/route.js';
import { computeMaterialUtilization } from '@/app/api/reports/material-utilization/route.js';
import { computeLabourUtilization } from '@/app/api/reports/labour-utilization/route.js';
import { computeMaterialShortage } from '@/app/api/reports/material-shortage/route.js';
import { computeDrawingRegister } from '@/app/api/reports/drawing-register/route.js';
import { computeEcnRegister } from '@/app/api/reports/ecn-register/route.js';
import { computeOpenPoAging } from '@/app/api/reports/open-po-aging/route.js';
import { computeTdsRegister } from '@/app/api/reports/tds-register/route.js';
import { computeFixedAssetRegister } from '@/app/api/reports/fixed-asset-register/route.js';
import { computeDepreciationSchedule } from '@/app/api/reports/depreciation-schedule/route.js';
import { computeCashFlow } from '@/app/api/reports/cash-flow/route.js';
import { computeDispatchRegister } from '@/app/api/reports/dispatch-register/route.js';
import {
  trialBalanceTable, customerLedgerTable, internalLedgerTable, stockValuationTable,
  profitLossTable, balanceSheetTable, gstr1Table, gstr3bTable, itcReconciliationTable,
  agingTable, journalRegisterTable, purchaseRegisterTable, salesRegisterTable,
  inventoryAgingTable, materialConsumptionTable, bankReconciliationTable,
  workOrderRegisterTable, productionCostVarianceTable, reworkRejectionTable,
  materialUtilizationTable, labourUtilizationTable, materialShortageTable,
  drawingRegisterTable, ecnRegisterTable, openPoAgingTable, tdsRegisterTable,
  fixedAssetRegisterTable, depreciationScheduleTable, cashFlowTable, dispatchRegisterTable,
} from './render.js';
import { fmt } from '../report-pdf.js';

export const REPORTS = [
  {
    key: 'trial-balance',
    title: 'Trial Balance',
    department: 'Accounts',
    heavy: true,
    compute: computeTrialBalance,
    toTable: trialBalanceTable,
    totals: (result) => [
      ['Total Debit', fmt(result.totalDebit)],
      ['Total Credit', fmt(result.totalCredit)],
    ],
  },
  {
    key: 'customer-ledger',
    title: 'Customer Ledger',
    department: 'Accounts',
    // NOT heavy: a single customer's transaction history is naturally bounded (unlike a
    // company-wide GL), and an AR statement is expected to show full history by default, not just
    // the current year — hiding older open invoices would make the report actively less useful.
    // Needs an extra param (customer_id) ReportsWorkspace's generic toolbar can't supply — the
    // screen card owns its own contextual "Download PDF" control instead (see
    // components/reports/CustomerLedgerCard.jsx).
    hasOwnPdfControl: true,
    compute: computeCustomerLedger,
    toTable: customerLedgerTable,
    totals: (result) => [
      ['Opening Balance', fmt(result.openingBalance)],
      ['Closing Balance', fmt(result.closingBalance)],
    ],
    subtitle: (result, { from, to }) =>
      [result.customer?.name, from && to ? `${from} to ${to}` : null].filter(Boolean).join(' · '),
  },
  {
    key: 'stock-valuation',
    title: 'Stock Valuation',
    department: 'Stores',
    needsCompany: false,
    compute: computeStockValuation,
    toTable: stockValuationTable,
    totals: (result) => [['Total Value', fmt(result.totalValue)]],
  },
  {
    key: 'inventory-aging',
    title: 'Inventory Aging',
    department: 'Stores',
    needsCompany: false,
    compute: computeInventoryAging,
    toTable: inventoryAgingTable,
    totals: (result) => [
      ...Object.entries(result.totals).map(([bucket, v]) => [bucket, fmt(v)]),
      ['Total', fmt(result.total)],
    ],
    subtitle: (result) => `As of ${result.asOf}`,
  },
  {
    key: 'stock-ledger',
    title: 'Stock Ledger',
    department: 'Stores',
    needsCompany: false,
    // Needs an extra param (item_id) ReportsWorkspace's generic toolbar can't supply — same reason
    // as Customer/Vendor Ledger.
    hasOwnPdfControl: true,
    compute: computeStockLedger,
    toTable: internalLedgerTable, // identical {date,kind,ref,debit,credit,balance} row shape; "balance" is qty, no ₹
    totals: (result) => [
      // Quantity, not money — no fmt() (that's a 2-decimal currency formatter).
      ['Opening Qty', String(result.openingBalance)],
      ['Closing Qty', String(result.closingBalance)],
    ],
    subtitle: (result, { from, to }) =>
      [result.item?.description, from && to ? `${from} to ${to}` : null].filter(Boolean).join(' · '),
  },
  // --- §10 Phase 2 — wraps of numbers already computed on screen, no new data model work ---------
  {
    key: 'profit-loss',
    title: 'Profit & Loss',
    department: 'Accounts',
    heavy: true,
    compute: computeProfitLoss,
    toTable: profitLossTable,
    totals: (result) => [
      ['Total Income', fmt(result.totalIncome)],
      ['Total Expense', fmt(result.totalExpense)],
      ['Net Profit', fmt(result.netProfit)],
    ],
  },
  {
    key: 'balance-sheet',
    title: 'Balance Sheet',
    department: 'Accounts',
    // NOT heavy: cumulative as-of-date by nature (todayISO() default, see the route), never
    // all-time-unbounded like Trial Balance/P&L — there's no runaway-page-count risk to guard.
    compute: computeBalanceSheet,
    toTable: balanceSheetTable,
    totals: (result) => [
      ['Total Assets', fmt(result.totalAssets)],
      ['Total Liabilities', fmt(result.totalLiabilities)],
      ['Total Equity', fmt(result.totalEquity)],
    ],
    subtitle: (result) => result.asOf ? `As of ${result.asOf}` : undefined,
  },
  {
    key: 'gstr1',
    title: 'GSTR-1 / IFF',
    department: 'Accounts',
    // Period picker lives on the card itself (components/reports/Gstr1ReportCard.jsx), same reason
    // as Customer Ledger's own PDF control — the generic toolbar only knows about `company`.
    hasOwnPdfControl: true,
    orientation: 'landscape', // B2B/HSN summary tables (7 cols) are tight on portrait A4
    compute: computeGstr1,
    toTable: gstr1Table,
    totals: (result) => [
      ['Total Taxable', fmt(result.totalTaxable)],
      ['Total CGST', fmt(result.totalCgst)],
      ['Total SGST', fmt(result.totalSgst)],
      ['Total IGST', fmt(result.totalIgst)],
      ['Total Tax', fmt(result.totalTax)],
    ],
    subtitle: (result) => result.period,
  },
  {
    key: 'gstr3b',
    title: 'GSTR-3B',
    department: 'Accounts',
    hasOwnPdfControl: true,
    compute: computeGstr3b,
    toTable: gstr3bTable,
    totals: (result) => [
      ['Outward Tax', fmt(result.outwardTax)],
      ['Eligible ITC', fmt(result.eligibleItc)],
      result.netPayable > 0 ? ['Net Payable', fmt(result.netPayable)] : ['ITC Carried Forward', fmt(result.itcCarriedForward)],
    ],
    subtitle: (result) => result.period,
  },
  {
    key: 'itc-reconciliation',
    title: 'ITC Reconciliation',
    department: 'Accounts',
    hasOwnPdfControl: true,
    orientation: 'landscape', // 6 columns incl. two GSTIN/invoice-no text columns, tight on portrait
    compute: computeItcReconciliation,
    toTable: itcReconciliationTable,
    totals: (result) => [
      ['Eligible ITC', fmt(result.eligibleItc)],
      ['Excluded ITC', fmt(result.excludedItc)],
      ['Matched', `${result.matchedCount} / ${result.lines.length}`],
    ],
    subtitle: (result) => result.period,
  },
  // --- §10 "after the first 10" — AR/AP/ledger set, straightforward joins over Phase 5's data ----
  {
    key: 'ar-aging',
    title: 'Receivables Aging',
    department: 'Accounts',
    compute: computeArAging,
    toTable: agingTable,
    totals: (result) => [
      ...Object.entries(result.totals).map(([bucket, v]) => [bucket, fmt(v)]),
      ['Total', fmt(result.total)],
    ],
    subtitle: (result) => `As of ${result.asOf}`,
  },
  {
    key: 'ap-aging',
    title: 'Payables Aging',
    department: 'Accounts',
    compute: computeApAging,
    toTable: agingTable,
    totals: (result) => [
      ...Object.entries(result.totals).map(([bucket, v]) => [bucket, fmt(v)]),
      ['Total', fmt(result.total)],
    ],
    subtitle: (result) => `As of ${result.asOf}`,
  },
  {
    key: 'vendor-ledger',
    title: 'Vendor Ledger',
    department: 'Accounts',
    // Same reasoning as Customer Ledger: bounded by one supplier's own history, PDF control lives
    // on the card (needs supplier_id, which the generic toolbar can't supply).
    hasOwnPdfControl: true,
    compute: computeVendorLedger,
    toTable: customerLedgerTable, // identical {date,kind,ref,debit,credit,balance} row shape
    totals: (result) => [
      ['Opening Balance', fmt(result.openingBalance)],
      ['Closing Balance', fmt(result.closingBalance)],
    ],
    subtitle: (result, { from, to }) =>
      [result.supplier?.name, from && to ? `${from} to ${to}` : null].filter(Boolean).join(' · '),
  },
  {
    key: 'cash-book',
    title: 'Cash / Bank Book',
    department: 'Accounts',
    heavy: true, // GL-backed (account 1001), same unbounded-page risk as Trial Balance/P&L
    compute: computeCashBook,
    toTable: internalLedgerTable, // identical row shape again; internal working report, no ₹
    totals: (result) => [
      ['Opening Balance', fmt(result.openingBalance)],
      ['Closing Balance', fmt(result.closingBalance)],
    ],
  },
  {
    key: 'journal-register',
    title: 'Journal Register',
    department: 'Accounts',
    heavy: true,
    compute: computeJournalRegister,
    toTable: journalRegisterTable,
    totals: (result) => [['Total', fmt(result.total)]],
  },
  {
    key: 'purchase-register',
    title: 'Purchase Register',
    department: 'Procurement',
    heavy: true,
    orientation: 'landscape', // 6 columns incl. supplier name, tight on portrait A4
    compute: computePurchaseRegister,
    toTable: purchaseRegisterTable,
    totals: (result) => [
      ['Total Subtotal', fmt(result.totalSubtotal)],
      ['Total Tax', fmt(result.totalTax)],
      ['Total Payable', fmt(result.totalPayable)],
    ],
  },
  {
    key: 'tds-register',
    title: 'TDS Deduction Register',
    department: 'Accounts',
    heavy: true,
    orientation: 'landscape', // 9 columns incl. PAN/section/FY-quarter, tight on portrait A4
    compute: computeTdsRegister,
    toTable: tdsRegisterTable,
    totals: (result) => [
      ['Total Gross', fmt(result.totalGross)],
      ['Total TDS Deducted', fmt(result.totalTds)],
    ],
  },
  {
    key: 'open-po-aging',
    title: 'Open PO Aging',
    department: 'Procurement',
    orientation: 'landscape', // 7 columns incl. supplier name, tight on portrait A4
    compute: computeOpenPoAging,
    toTable: openPoAgingTable,
    totals: (result) => [
      ['Total Open POs', String(result.total)],
      ['Total Open Value', fmt(result.totalOpenValue)],
      ['Oldest (days)', String(result.oldestDaysOpen)],
    ],
  },
  {
    key: 'sales-register',
    title: 'Sales Register',
    department: 'Sales',
    heavy: true,
    orientation: 'landscape', // 6 columns incl. customer name, tight on portrait A4
    compute: computeSalesRegister,
    toTable: salesRegisterTable,
    totals: (result) => [
      ['Total Subtotal', fmt(result.totalSubtotal)],
      ['Total Tax', fmt(result.totalTax)],
      ['Total Value', fmt(result.totalValue)],
    ],
  },
  {
    key: 'dispatch-register',
    title: 'Dispatch Register',
    department: 'Dispatch', // Dispatch's first-ever Report Engine entry
    heavy: true,
    orientation: 'landscape', // 7 columns incl. customer name and e-way bill no
    compute: computeDispatchRegister,
    toTable: dispatchRegisterTable,
    totals: (result) => [
      ['Shipments', String(result.shipmentCount)],
      ['Total Freight', fmt(result.totalFreight)],
    ],
  },
  {
    key: 'material-consumption',
    title: 'Material Consumption Report',
    department: 'Production',
    heavy: true,
    compute: computeMaterialConsumption,
    toTable: materialConsumptionTable,
    totals: (result) => [['Total Cost', fmt(result.totalCost)]],
  },
  {
    key: 'work-order-register',
    title: 'Work Order Register',
    department: 'Production',
    orientation: 'landscape', // 9 columns incl. project/customer text, tight on portrait A4
    compute: computeWorkOrderRegister,
    toTable: workOrderRegisterTable,
    totals: (result) => [
      ['Total Work Orders', String(result.total)],
      ['In Progress', String(result.inProgress)],
      ['Delayed', String(result.delayed)],
      ['Completed', String(result.completed)],
    ],
  },
  {
    key: 'production-cost-variance',
    title: 'Production Cost Variance',
    department: 'Production',
    orientation: 'landscape', // 10 columns of planned/actual/variance, needs the width
    compute: computeProductionCostVariance,
    toTable: productionCostVarianceTable,
    totals: (result) => [
      ['Total Planned', fmt(result.totalPlanned)],
      ['Total Actual', fmt(result.totalActual)],
      ['Total Variance', fmt(result.totalVariance)],
    ],
  },
  {
    key: 'rework-rejection',
    title: 'Rework / Rejection Report',
    department: 'Production',
    compute: computeReworkRejection,
    toTable: reworkRejectionTable,
    totals: (result) => [
      ['Total Qty Rejected', String(result.totalQtyRejected)],
      ['QC Failures', String(result.totalQcFailures)],
      ['Rework Cards Created', String(result.reworkCardsCreated)],
    ],
  },
  {
    key: 'material-utilization',
    title: 'Material Utilization Report',
    department: 'Production',
    needsCompany: false, // cut material is shared shop stock, no company split (same as Stock Valuation)
    compute: computeMaterialUtilization,
    toTable: materialUtilizationTable,
    totals: (result) => [
      ['Total Source Wt', `${result.totalSource} kg`],
      ['Used', `${result.totalUsed} kg`],
      ['Remnant Recovered', `${result.totalRemnant} kg`],
      ['Scrap', `${result.totalScrap} kg`],
      ['Overall Yield', `${result.overallYieldPct}%`],
    ],
  },
  {
    key: 'labour-utilization',
    title: 'Labour Utilization Report',
    department: 'Production',
    compute: computeLabourUtilization,
    toTable: labourUtilizationTable,
    totals: (result) => [
      ['Total Hours', String(result.totalHours)],
      ['Total Labour Cost', fmt(result.totalCost)],
    ],
  },
  {
    key: 'material-shortage',
    title: 'Material Shortage / Demand',
    department: 'Production',
    needsCompany: false, // wraps getProductionForecast(), which is shop-wide, not company-scoped
    // Own PDF control — this report is a forward-looking horizon (getProductionForecast's own
    // param), not a from/to historical period like every other report's generic toolbar assumes.
    hasOwnPdfControl: true,
    compute: computeMaterialShortage,
    toTable: materialShortageTable,
    totals: (result) => [['Horizon', `${result.horizonDays} days`]],
    subtitle: (result) => `Next ${result.horizonDays} days`,
  },
  {
    key: 'drawing-register',
    title: 'Drawing Register',
    department: 'Design',
    compute: computeDrawingRegister,
    toTable: drawingRegisterTable,
    totals: (result) => [
      ['Total Drawings', String(result.total)],
      ['Approved', String(result.approved)],
      ['Overdue', String(result.overdue)],
    ],
  },
  {
    key: 'ecn-register',
    title: 'ECN Register',
    department: 'Design',
    orientation: 'landscape', // Old → New value pair needs the width
    compute: computeEcnRegister,
    toTable: ecnRegisterTable,
    totals: (result) => [
      ['Total ECNs', String(result.total)],
      ['Pending', String(result.pending)],
      ['Approved', String(result.approved)],
      ['Rejected', String(result.rejected)],
    ],
  },
  {
    key: 'fixed-asset-register',
    title: 'Fixed Asset Register',
    department: 'Accounts',
    compute: computeFixedAssetRegister,
    toTable: fixedAssetRegisterTable,
    totals: (result) => [
      ['Total Cost', fmt(result.totalCost)],
      ['Total Accumulated Depreciation', fmt(result.totalAccumulatedDepreciation)],
      ['Total Book Value', fmt(result.totalBookValue)],
    ],
  },
  {
    key: 'depreciation-schedule',
    title: 'Depreciation Schedule',
    department: 'Accounts',
    heavy: true,
    compute: computeDepreciationSchedule,
    toTable: depreciationScheduleTable,
    totals: (result) => [
      ['Total Depreciation', fmt(result.totalAmount)],
    ],
  },
  {
    key: 'cash-flow',
    title: 'Cash Flow Statement',
    department: 'Accounts',
    heavy: true,
    compute: computeCashFlow,
    toTable: cashFlowTable,
    totals: (result) => [
      ['Net Cash from Operating', fmt(result.operating.netOperating)],
      ['Net Cash from Investing', fmt(result.investing.netInvesting)],
      ['Net Cash from Financing', fmt(result.financing.netFinancing)],
      ['Net Change in Cash', fmt(result.netChangeInCash)],
    ],
  },
  {
    key: 'bank-reconciliation',
    title: 'Bank Reconciliation Statement',
    department: 'Accounts',
    heavy: true,
    compute: computeBankReconciliation,
    toTable: bankReconciliationTable,
    totals: (result) => [
      ['Reconciled Balance', fmt(result.reconciledBalance)],
      ['Unreconciled Balance', fmt(result.unreconciledBalance)],
    ],
  },
];

export function getReport(key) {
  return REPORTS.find((r) => r.key === key) || null;
}

export function reportsForDepartment(department) {
  return REPORTS.filter((r) => r.department === department);
}

// Departments that get a Reports tab at all — computed once, not per-render.
export const REPORT_DEPARTMENTS = [...new Set(REPORTS.map((r) => r.department))];
