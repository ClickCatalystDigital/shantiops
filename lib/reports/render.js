// lib/reports/render.js — per-report {cols, rows} extraction from a compute() result, plus the PDF
// composition step. Result shapes differ too much across reports (Trial Balance: accounts +
// totalDebit/totalCredit; P&L: income vs expense; Balance Sheet: assets/liabilities/equity) for one
// generic reflection-based mapper to be honest — REPORT-ENGINE-PLAN rejects a declarative Report
// Definition DSL for the same reason. Each report owns its own `toTable`; what's genuinely generic
// is turning a table (or, for GSTR-1, multiple named sections — the GST portal itself splits B2B
// and HSN into separate tables, REPORT-ENGINE-PLAN §9 flagged GST layouts might need this) plus
// totals into a PDF, which is what renderCatalogPdf does. A report with no row-shaped data at all
// (GSTR-3B: just a handful of summary numbers) returns {cols:[], rows:[]} — renderCatalogPdf skips
// the table entirely and shows only the totals line.
//
// JSX lives here (not in the [key]/export route) to match every other lib/*-pdf.js — route.js files
// in this app never contain JSX, they call a lib/ renderer.
import React from 'react';
import { Text } from '@react-pdf/renderer';
import { ReportDocument, ReportTable, ReportTotals, renderReportPdf, fmt, fmtDate, tokens } from '../report-pdf.js';

export const TRIAL_BALANCE_COLS = [
  ['Code', 14, (a) => a.account_code],
  ['Account', 38, (a) => a.account_name],
  ['Type', 14, (a) => a.account_type],
  ['Debit', 17, (a) => fmt(a.debit), 'right'],
  ['Credit', 17, (a) => fmt(a.credit), 'right'],
];

export function trialBalanceTable(result) {
  return { cols: TRIAL_BALANCE_COLS, rows: result.accounts };
}

// Debit/Credit/Balance columns are shared by four reports (Customer Ledger, Vendor Ledger, Stock
// Ledger, Cash Book) with the same {date,kind,ref,debit,credit,balance} row shape — but only the
// two that leave the building as a customer/vendor-facing statement should carry a ₹ symbol; Stock
// Ledger's "balance" is a quantity, and Cash Book is an internal working report.
function ledgerCols(currency) {
  return [
    ['Date', 12, (e) => fmtDate(e.date)],
    ['Type', 13, (e) => e.kind],
    ['Reference', 25, (e) => e.ref],
    ['Debit', 16, (e) => e.debit ? fmt(e.debit, { currency }) : '', 'right'],
    ['Credit', 16, (e) => e.credit ? fmt(e.credit, { currency }) : '', 'right'],
    ['Balance', 18, (e) => fmt(e.balance, { currency }), 'right'],
  ];
}
export const CUSTOMER_LEDGER_COLS = ledgerCols(true);
export const INTERNAL_LEDGER_COLS = ledgerCols(false);

export function customerLedgerTable(result) {
  return { cols: CUSTOMER_LEDGER_COLS, rows: result.entries };
}

export function internalLedgerTable(result) {
  return { cols: INTERNAL_LEDGER_COLS, rows: result.entries };
}

export const STOCK_VALUATION_COLS = [
  ['Item Code', 16, (i) => i.item_code || '—'],
  ['Description', 40, (i) => i.description],
  ['On Hand', 14, (i) => i.on_hand, 'right'],
  ['Avg Cost', 15, (i) => fmt(i.avg_cost), 'right'],
  ['Value', 15, (i) => fmt(i.value), 'right'],
];

export function stockValuationTable(result) {
  return { cols: STOCK_VALUATION_COLS, rows: result.items };
}

const SECTION_ACCOUNT_COLS = [
  ['Section', 16, (a) => a.section],
  ['Code', 12, (a) => a.account_code],
  ['Account', 42, (a) => a.account_name],
  ['Amount', 30, (a) => fmt(a.balance), 'right'],
];

export function profitLossTable(result) {
  const rows = [
    ...result.income.map((a) => ({ ...a, section: 'Income' })),
    ...result.expense.map((a) => ({ ...a, section: 'Expense' })),
  ];
  return { cols: SECTION_ACCOUNT_COLS, rows };
}

export function balanceSheetTable(result) {
  const rows = [
    ...result.assets.map((a) => ({ ...a, section: 'Assets' })),
    ...result.liabilities.map((a) => ({ ...a, section: 'Liabilities' })),
    ...result.equity.map((a) => ({ ...a, section: 'Equity' })),
  ];
  return { cols: SECTION_ACCOUNT_COLS, rows };
}

// GSTR-1 mirrors the GST portal's own split: B2B (Table 4, by GSTIN) and HSN (Table 12) are
// genuinely separate tables there, not one — REPORT-ENGINE-PLAN §9 anticipated this.
export const GSTR1_B2B_COLS = [
  ['GSTIN', 18, (g) => g.customer_gstin || '—'],
  ['Customer', 27, (g) => g.customer_name],
  ['Invoices', 9, (g) => g.invoice_count, 'right'],
  ['Taxable', 16, (g) => fmt(g.taxable), 'right'],
  ['CGST', 10, (g) => fmt(g.cgst), 'right'],
  ['SGST', 10, (g) => fmt(g.sgst), 'right'],
  ['IGST', 10, (g) => fmt(g.igst), 'right'],
];
export const GSTR1_HSN_COLS = [
  ['HSN', 12, (h) => h.hsn_code || '—'],
  ['UOM', 10, (h) => h.uom || '—'],
  ['Qty', 12, (h) => h.qty, 'right'],
  ['Taxable', 22, (h) => fmt(h.taxable), 'right'],
  ['CGST', 14, (h) => fmt(h.cgst), 'right'],
  ['SGST', 14, (h) => fmt(h.sgst), 'right'],
  ['IGST', 16, (h) => fmt(h.igst), 'right'],
];
export function gstr1Table(result) {
  return {
    sections: [
      { title: 'B2B Summary (by GSTIN)', cols: GSTR1_B2B_COLS, rows: result.b2b },
      { title: 'HSN Summary', cols: GSTR1_HSN_COLS, rows: result.hsn },
    ],
  };
}

// GSTR-3B is a handful of net-liability numbers, no row-shaped data at all — catalog.js's
// `totals(result)` carries the whole document; this just tells renderCatalogPdf to skip the table.
export function gstr3bTable() {
  return { cols: [], rows: [] };
}

export const ITC_RECON_COLS = [
  ['Supplier GSTIN', 20, (l) => l.supplier_gstin || '—'],
  ['Invoice No', 20, (l) => l.invoice_no],
  ['Tax Amount', 18, (l) => fmt(l.tax_amount), 'right'],
  ['ITC Availability', 18, (l) => l.itc_availability || '—'],
  ['Matched', 12, (l) => l.matched_vendor_bill_id ? 'Yes' : 'No'],
  ['Eligible', 12, (l) => l.eligible ? 'Yes' : 'No'],
];
export function itcReconciliationTable(result) {
  return { cols: ITC_RECON_COLS, rows: result.lines };
}

// AR/AP Aging share one column spec — `party` is generic (customer or supplier), same reason
// lib/ledger.mjs's agingBuckets() is one function for both.
export const AGING_COLS = [
  ['Reference', 16, (i) => i.ref],
  ['Party', 30, (i) => i.party],
  ['Due Date', 14, (i) => fmtDate(i.dueDate || i.date)],
  ['Days Overdue', 14, (i) => i.daysOverdue, 'right'],
  ['Bucket', 12, (i) => i.bucket],
  ['Outstanding', 14, (i) => fmt(i.outstanding), 'right'],
];
export function agingTable(result) {
  return { cols: AGING_COLS, rows: result.items };
}

// Inventory Aging reuses the same agingBuckets() rollup but the columns read as "item / last
// movement / value" instead of "party / due date / outstanding" — different enough labels to
// warrant its own cols rather than relabeling AGING_COLS in place.
export const INVENTORY_AGING_COLS = [
  ['Item Code', 16, (i) => i.ref],
  ['Description', 30, (i) => i.party],
  ['Last Movement', 16, (i) => i.date === '1900-01-01' ? 'Never' : fmtDate(i.date)],
  ['Days Idle', 14, (i) => i.daysOverdue, 'right'],
  ['Bucket', 10, (i) => i.bucket],
  ['Value', 14, (i) => fmt(i.outstanding), 'right'],
];
export function inventoryAgingTable(result) {
  return { cols: INVENTORY_AGING_COLS, rows: result.items };
}

export const JOURNAL_REGISTER_COLS = [
  ['Date', 12, (e) => fmtDate(e.entry_date)],
  ['Source', 20, (e) => e.source_type],
  ['Description', 48, (e) => e.description || '—'],
  ['Amount', 20, (e) => fmt(e.amount), 'right'],
];
export function journalRegisterTable(result) {
  return { cols: JOURNAL_REGISTER_COLS, rows: result.entries };
}

export const MATERIAL_CONSUMPTION_COLS = [
  ['Date', 12, (l) => fmtDate(l.issued_at)],
  ['Project', 16, (l) => l.project_no],
  ['Material', 32, (l) => l.material_description],
  ['Qty', 10, (l) => l.qty, 'right'],
  ['Unit Cost', 15, (l) => fmt(l.unit_cost), 'right'],
  ['Total Cost', 15, (l) => fmt(l.total_cost), 'right'],
];
export function materialConsumptionTable(result) {
  return { cols: MATERIAL_CONSUMPTION_COLS, rows: result.lines };
}

export const BANK_RECONCILIATION_COLS = [
  ['Date', 12, (l) => fmtDate(l.entry_date)],
  ['Description', 40, (l) => l.description || l.source_type],
  ['Debit', 16, (l) => l.debit ? fmt(l.debit) : '', 'right'],
  ['Credit', 16, (l) => l.credit ? fmt(l.credit) : '', 'right'],
  ['Reconciled', 16, (l) => l.reconciled ? 'Yes' : 'No'],
];
export function bankReconciliationTable(result) {
  return { cols: BANK_RECONCILIATION_COLS, rows: result.lines };
}

export const PURCHASE_REGISTER_COLS = [
  ['Bill No', 16, (b) => b.bill_no],
  ['Date', 12, (b) => fmtDate(b.bill_date)],
  ['Supplier', 28, (b) => b.supplier_name],
  ['Subtotal', 14, (b) => fmt(b.subtotal), 'right'],
  ['Tax', 14, (b) => fmt(b.tax_amount), 'right'],
  ['Payable', 16, (b) => fmt(b.payable_amount), 'right'],
];
export function purchaseRegisterTable(result) {
  return { cols: PURCHASE_REGISTER_COLS, rows: result.bills };
}

export const TDS_REGISTER_COLS = [
  ['Bill No', 14, (l) => l.bill_no],
  ['Date', 11, (l) => fmtDate(l.bill_date)],
  ['Supplier', 22, (l) => l.supplier_name],
  ['PAN', 12, (l) => l.supplier_pan || '—'],
  ['Section', 10, (l) => l.tds_section],
  ['FY / Qtr', 10, (l) => `${l.financial_year} ${l.quarter}`],
  ['Rate %', 8, (l) => l.tds_rate_pct, 'right'],
  ['Gross', 13, (l) => fmt(l.total), 'right'],
  ['TDS', 13, (l) => fmt(l.tds_amount), 'right'],
];
export function tdsRegisterTable(result) {
  return { cols: TDS_REGISTER_COLS, rows: result.lines };
}

export const FIXED_ASSET_REGISTER_COLS = [
  ['Asset No', 12, (a) => a.asset_no],
  ['Name', 22, (a) => a.name],
  ['Category', 14, (a) => a.category || '—'],
  ['Purchased', 12, (a) => fmtDate(a.purchase_date)],
  ['Method', 8, (a) => a.method],
  ['Cost', 12, (a) => fmt(a.cost), 'right'],
  ['Accum. Dep.', 12, (a) => fmt(a.accumulated_depreciation), 'right'],
  ['Book Value', 12, (a) => fmt(a.book_value), 'right'],
  ['Status', 12, (a) => a.status],
];
export function fixedAssetRegisterTable(result) {
  return { cols: FIXED_ASSET_REGISTER_COLS, rows: result.assets };
}

export const DEPRECIATION_SCHEDULE_COLS = [
  ['Period', 12, (l) => `${l.period_year}-${String(l.period_month).padStart(2, '0')}`],
  ['Run Date', 12, (l) => fmtDate(l.run_date)],
  ['Asset No', 12, (l) => l.asset_no],
  ['Asset', 28, (l) => l.asset_name],
  ['Method', 10, (l) => l.method],
  ['Amount', 14, (l) => fmt(l.amount), 'right'],
];
export function depreciationScheduleTable(result) {
  return { cols: DEPRECIATION_SCHEDULE_COLS, rows: result.lines };
}

// Cash Flow Statement — indirect method (lib/cash-flow.mjs). Three named sections, same
// multi-section shape as gstr1Table (the GST portal's own B2B/HSN split) — each row is a
// {label, amount} pair the section builds fresh, not a raw ledger row, since a cash flow
// statement's "line items" (Net Profit, Add: Depreciation, each working-capital account, ...) are
// a presentation structure, not a query result.
export const CASH_FLOW_COLS = [
  ['Particulars', 50, (r) => r.label],
  ['Amount', 18, (r) => fmt(r.amount), 'right'],
];
export function cashFlowTable(result) {
  const { operating, investing, financing } = result;
  const operatingRows = [
    { label: 'Net Profit', amount: operating.netProfit },
    { label: 'Add: Depreciation', amount: operating.depreciationAddback },
    { label: 'Add/Less: Reversal of (Gain)/Loss on Asset Disposal', amount: operating.disposalReversal },
    ...operating.workingCapital.map((w) => ({ label: `Change in ${w.account_name}`, amount: w.change })),
    { label: 'Net Cash from Operating Activities', amount: operating.netOperating },
  ];
  const investingRows = [
    ...investing.lines.map((l) => ({ label: l.description || l.source_type || 'Fixed asset transaction', amount: (l.debit || 0) - (l.credit || 0) })),
    { label: 'Net Cash from Investing Activities', amount: investing.netInvesting },
  ];
  const financingRows = [
    ...financing.lines.map((f) => ({ label: `Change in ${f.account_name}`, amount: f.change })),
    { label: 'Net Cash from Financing Activities', amount: financing.netFinancing },
  ];
  return {
    sections: [
      { title: 'Operating Activities', cols: CASH_FLOW_COLS, rows: operatingRows },
      { title: 'Investing Activities', cols: CASH_FLOW_COLS, rows: investingRows },
      { title: 'Financing Activities', cols: CASH_FLOW_COLS, rows: financingRows },
    ],
  };
}

export const SALES_REGISTER_COLS = [
  ['Invoice No', 18, (i) => i.invoice_no],
  ['Date', 12, (i) => fmtDate(i.invoice_date)],
  ['Customer', 30, (i) => i.customer_name],
  ['Subtotal', 16, (i) => fmt(i.subtotal), 'right'],
  ['Tax', 12, (i) => fmt(i.tax_amount), 'right'],
  ['Total', 12, (i) => fmt(i.total), 'right'],
];
export function salesRegisterTable(result) {
  return { cols: SALES_REGISTER_COLS, rows: result.invoices };
}

// Dispatch accounting integration, 2026-08-23 — dispatched_at falls back to updated_at for any
// packing list dispatched before that column existed (see lib/data.js's getDispatchRegisterLines),
// an approximation, not necessarily the real dispatch date for those historical rows.
export const DISPATCH_REGISTER_COLS = [
  ['Packing No', 14, (s) => s.packing_no],
  ['Dispatched', 12, (s) => fmtDate(s.dispatched_at)],
  ['Customer', 26, (s) => s.customer_name],
  ['Invoice No', 16, (s) => s.linked_invoice_no || s.invoice_no || '—'],
  ['Freight', 12, (s) => s.freight_amount ? fmt(s.freight_amount) : '—', 'right'],
  ['Paid By', 10, (s) => s.freight_paid_by || '—'],
  ['E-Way Bill', 16, (s) => s.eway_bill_no || '—'],
];
export function dispatchRegisterTable(result) {
  return { cols: DISPATCH_REGISTER_COLS, rows: result.shipments };
}

// Dispatch/QC report additions (plan §4/§5f, 2026-08-23) --------------------------------------

export const EWAY_BILL_REGISTER_COLS = [
  ['E-Way Bill No', 18, (s) => s.eway_bill_no],
  ['Date', 12, (s) => fmtDate(s.eway_bill_date)],
  ['Packing No', 14, (s) => s.packing_no],
  ['Vehicle No', 14, (s) => s.vehicle_no || '—'],
  ['Through', 16, (s) => s.dispatch_through || '—'],
  ['Invoice No', 16, (s) => s.invoice_no || '—'],
];
export function ewayBillRegisterTable(result) {
  return { cols: EWAY_BILL_REGISTER_COLS, rows: result.lines };
}

export const FREIGHT_COST_SUMMARY_COLS = [
  ['Month', 8, (s) => s.month],
  ['Packing No', 14, (s) => s.packing_no],
  ['Customer', 26, (s) => s.customer_name],
  ['Freight', 12, (s) => fmt(s.freight_amount), 'right'],
  ['Paid By', 10, (s) => s.freight_paid_by === 'customer' ? 'Customer' : 'Us'],
];
export function freightCostSummaryTable(result) {
  return { cols: FREIGHT_COST_SUMMARY_COLS, rows: result.lines };
}

export const DISPATCH_AGING_COLS = [
  ['Packing No', 14, (s) => s.packing_no],
  ['Customer', 26, (s) => s.customer_name],
  ['Status', 12, (s) => s.status],
  ['Created', 12, (s) => fmtDate(s.created_at)],
  ['Days Open', 10, (s) => s.days_open, 'right'],
];
export function dispatchAgingTable(result) {
  return { cols: DISPATCH_AGING_COLS, rows: result.lines };
}

export const TEST_CERTIFICATE_REGISTER_COLS = [
  ['Certificate No', 16, (c) => c.certificate_no],
  ['Cast No', 12, (c) => c.cast_no],
  ['Plate No', 10, (c) => c.plate_no || '—'],
  ['Project', 14, (c) => c.project_no],
  ['Spec', 14, (c) => c.material_spec],
  ['Maker', 16, (c) => c.steel_maker],
  ['YS', 8, (c) => c.ys ?? '—', 'right'],
  ['UTS', 8, (c) => c.uts ?? '—', 'right'],
  ['Elong %', 8, (c) => c.elongation ?? '—', 'right'],
  ['Bend', 8, (c) => c.bend_test || '—'],
];
export function testCertificateRegisterTable(result) {
  return { cols: TEST_CERTIFICATE_REGISTER_COLS, rows: result.lines };
}

export const QC_INSPECTION_SUMMARY_COLS = [
  ['Test Type', 30, (l) => l.test_type],
  ['Pass', 15, (l) => l.pass_count, 'right'],
  ['Fail', 15, (l) => l.fail_count, 'right'],
  ['Pending', 15, (l) => l.pending_count, 'right'],
];
export function qcInspectionSummaryTable(result) {
  return { cols: QC_INSPECTION_SUMMARY_COLS, rows: result.lines };
}

export const NCR_REGISTER_COLS = [
  ['NCR No', 12, (n) => n.ncr_no],
  ['Project', 14, (n) => n.project_no],
  ['Severity', 10, (n) => n.severity],
  ['Status', 14, (n) => n.status],
  ['Disposition', 12, (n) => n.disposition || '—'],
  ['Description', 30, (n) => n.description],
  ['Raised', 10, (n) => fmtDate(n.raised_at)],
];
export function ncrRegisterTable(result) {
  return { cols: NCR_REGISTER_COLS, rows: result.lines };
}

// --- Production management reports (2026-08-22) --------------------------------------------

export const WORK_ORDER_REGISTER_COLS = [
  ['WO No', 12, (w) => w.wo_no],
  ['Project / Customer', 22, (w) => w.project_no ? `${w.project_no} — ${w.customer_name || ''}` : 'Stock'],
  ['Mode', 10, (w) => w.mode === 'against_order' ? 'Order' : 'Stock'],
  ['Status', 10, (w) => w.status],
  ['Qty Planned', 10, (w) => w.qty_planned, 'right'],
  ['Qty Done', 10, (w) => w.qty_done, 'right'],
  ['Qty Rejected', 10, (w) => w.qty_rejected, 'right'],
  ['%', 6, (w) => `${w.pct}%`, 'right'],
  ['Delayed', 10, (w) => w.delayed ? 'Yes' : 'No'],
];
export function workOrderRegisterTable(result) {
  return { cols: WORK_ORDER_REGISTER_COLS, rows: result.lines };
}

export const PRODUCTION_COST_VARIANCE_COLS = [
  ['WO No', 9, (w) => w.wo_no],
  ['Project', 15, (w) => w.project_no || 'Stock'],
  ['Plan Material', 10, (w) => fmt(w.plannedMaterialCost), 'right'],
  ['Actual Material', 10, (w) => fmt(w.actualMaterialCost), 'right'],
  ['Plan Labour', 10, (w) => fmt(w.plannedLaborCost), 'right'],
  ['Actual Labour', 10, (w) => fmt(w.actualLaborCost), 'right'],
  ['Plan Total', 10, (w) => fmt(w.plannedTotal), 'right'],
  ['Actual Total', 10, (w) => fmt(w.actualTotal), 'right'],
  ['Variance', 10, (w) => fmt(w.totalVariance), 'right'],
  ['Var %', 6, (w) => `${w.variancePct}%`, 'right'],
];
export function productionCostVarianceTable(result) {
  return { cols: PRODUCTION_COST_VARIANCE_COLS, rows: result.lines };
}

export const JOB_CARD_REJECTIONS_COLS = [
  ['Date', 12, (r) => fmtDate(r.updated_at)],
  ['Project', 18, (r) => r.project_no || 'Stock'],
  ['WO No', 12, (r) => r.wo_no || '—'],
  ['Section', 24, (r) => r.section],
  ['Operation', 14, (r) => r.operation_name || '—'],
  ['Qty Rejected', 12, (r) => r.qty_rejected, 'right'],
  ['Reworked', 8, (r) => r.rework_of_job_card_id ? 'Yes' : 'No'],
];
export const QC_FAILURES_COLS = [
  ['Date', 12, (r) => fmtDate(r.tested_on)],
  ['Project', 20, (r) => r.project_no],
  ['Test Type', 20, (r) => r.test_type],
  ['Inspector', 18, (r) => r.inspector || '—'],
  ['Notes', 30, (r) => r.notes || '—'],
];
export function reworkRejectionTable(result) {
  return {
    sections: [
      { title: 'Job Card Rejections', cols: JOB_CARD_REJECTIONS_COLS, rows: result.jobCardRejections },
      { title: 'QC Test Failures', cols: QC_FAILURES_COLS, rows: result.qcFailures },
    ],
  };
}

export const MATERIAL_UTILIZATION_COLS = [
  ['Cut Date', 12, (l) => fmtDate(l.cut_at)],
  ['Piece Code', 14, (l) => l.code],
  ['Material', 26, (l) => l.description || l.item_code || '—'],
  ['Kind', 8, (l) => l.kind],
  ['Source Wt (kg)', 10, (l) => l.source_weight, 'right'],
  ['Used (kg)', 10, (l) => l.used_weight, 'right'],
  ['Remnant (kg)', 10, (l) => l.remnant_weight, 'right'],
  ['Scrap (kg)', 10, (l) => l.scrap_weight, 'right'],
  ['Yield %', 10, (l) => `${l.yield_pct}%`, 'right'],
];
export function materialUtilizationTable(result) {
  return { cols: MATERIAL_UTILIZATION_COLS, rows: result.lines };
}

export const LABOUR_UTILIZATION_COLS = [
  ['Employee', 26, (l) => l.employee_name],
  ['Trade', 16, (l) => l.trade || '—'],
  ['Hours', 12, (l) => Math.round((l.total_minutes / 60) * 10) / 10, 'right'],
  ['Cost', 16, (l) => fmt(l.labor_cost), 'right'],
  ['Job Cards', 15, (l) => l.job_cards_worked, 'right'],
  ['Work Orders', 15, (l) => l.work_orders_worked, 'right'],
];
export function labourUtilizationTable(result) {
  return { cols: LABOUR_UTILIZATION_COLS, rows: result.lines };
}

export const MATERIAL_DEMAND_COLS = [
  ['Material', 60, (m) => m.material],
  ['Qty Outstanding', 40, (m) => m.qty_outstanding, 'right'],
];
export const SHORTAGE_WORK_ORDERS_COLS = [
  ['WO No', 15, (w) => w.wo_no],
  ['Project', 30, (w) => w.project_no || 'Stock'],
  ['Qty Planned', 15, (w) => w.qty_planned, 'right'],
  ['Planned Start', 20, (w) => fmtDate(w.planned_start)],
  ['Planned End', 20, (w) => fmtDate(w.planned_end)],
];
export function materialShortageTable(result) {
  return {
    sections: [
      { title: 'Outstanding Material Demand', cols: MATERIAL_DEMAND_COLS, rows: result.materialDemand },
      { title: 'Work Orders in Horizon', cols: SHORTAGE_WORK_ORDERS_COLS, rows: result.workOrders },
    ],
  };
}

// --- Design management reports (2026-08-22) -------------------------------------------------

export const DRAWING_REGISTER_COLS = [
  ['Project', 16, (d) => d.project_no],
  ['Drawing', 26, (d) => d.name],
  ['Type', 14, (d) => d.drawing_type || '—'],
  ['Status', 14, (d) => d.status.replace(/_/g, ' ')],
  ['Assigned To', 16, (d) => d.assigned_to || '—'],
  ['Due Date', 8, (d) => fmtDate(d.due_date)],
  ['Overdue', 6, (d) => d.overdue ? 'Yes' : 'No'],
];
export function drawingRegisterTable(result) {
  return { cols: DRAWING_REGISTER_COLS, rows: result.lines };
}

export const ECN_REGISTER_COLS = [
  ['Date', 10, (e) => fmtDate(e.created_at)],
  ['Project', 14, (e) => e.project_no],
  ['Field Changed', 14, (e) => e.field_changed],
  // "->" not "→" — same react-pdf base-14-Helvetica-has-no-glyph issue as the ₹ currency symbol
  // (lib/report-pdf.js's fmt()); caught by reading the actual rendered PDF, not the self-check.
  ['Old -> New', 22, (e) => `${e.old_value ?? '—'} -> ${e.new_value ?? '—'}`],
  ['Reason', 20, (e) => e.reason],
  ['Status', 10, (e) => e.status],
  ['Requested By', 10, (e) => e.requested_by || '—'],
];
export function ecnRegisterTable(result) {
  return { cols: ECN_REGISTER_COLS, rows: result.lines };
}

export const OPEN_PO_AGING_COLS = [
  ['PO No', 14, (p) => p.po_no],
  ['Supplier', 26, (p) => p.supplier_name],
  ['Issued', 12, (p) => fmtDate(p.issued_at)],
  ['Days Open', 10, (p) => p.daysOpen, 'right'],
  ['Open Lines', 10, (p) => p.open_line_count, 'right'],
  ['Open Value', 14, (p) => fmt(p.open_value, { currency: true }), 'right'],
  ['PO Value', 14, (p) => fmt(p.po_value, { currency: true }), 'right'],
];
export function openPoAgingTable(result) {
  return { cols: OPEN_PO_AGING_COLS, rows: result.lines };
}

// --- Management reports (2026-08-22, cross-department, /executive/reports) ------------------

export const PROJECT_PROFITABILITY_COLS = [
  ['Project', 14, (p) => p.project_no],
  ['Customer', 22, (p) => p.customer_name],
  ['Material', 14, (p) => fmt(p.materialCost, { currency: true }), 'right'],
  ['Labour', 14, (p) => fmt(p.laborCost, { currency: true }), 'right'],
  ['Selling Value', 14, (p) => fmt(p.sellingValue, { currency: true }), 'right'],
  ['Margin', 14, (p) => fmt(p.margin, { currency: true }), 'right'],
  ['Margin %', 8, (p) => p.marginPct == null ? '—' : `${p.marginPct}%`, 'right'],
];
export function projectProfitabilityTable(result) {
  return { cols: PROJECT_PROFITABILITY_COLS, rows: result.lines };
}

export const CUSTOMER_PROFITABILITY_COLS = [
  ['Customer', 24, (c) => c.customer_name],
  ['Projects', 10, (c) => c.projectCount, 'right'],
  ['Material', 14, (c) => fmt(c.materialCost, { currency: true }), 'right'],
  ['Labour', 14, (c) => fmt(c.laborCost, { currency: true }), 'right'],
  ['Selling Value', 14, (c) => fmt(c.sellingValue, { currency: true }), 'right'],
  ['Margin', 14, (c) => fmt(c.margin, { currency: true }), 'right'],
  ['Margin %', 10, (c) => c.marginPct == null ? '—' : `${c.marginPct}%`, 'right'],
];
export function customerProfitabilityTable(result) {
  return { cols: CUSTOMER_PROFITABILITY_COLS, rows: result.lines };
}

export const PROCUREMENT_SPEND_COLS = [
  ['Supplier', 30, (s) => s.supplier_name],
  ['Bills', 12, (s) => s.billCount, 'right'],
  ['Subtotal', 18, (s) => fmt(s.subtotal, { currency: true }), 'right'],
  ['Tax', 18, (s) => fmt(s.taxAmount, { currency: true }), 'right'],
  ['Payable', 22, (s) => fmt(s.payable, { currency: true }), 'right'],
];
export function procurementSpendTable(result) {
  return { cols: PROCUREMENT_SPEND_COLS, rows: result.lines };
}

// Shared by every catalog entry's PDF export — `table` is either {cols, rows} (the common case) or
// {sections: [{title, cols, rows}]} (GSTR-1: B2B summary + HSN summary, two distinct tables).
// `totals` is the [[label, value]] pairs a report's `totals(result)` produces (see catalog.js).
export function renderCatalogPdf({ company, title, subtitle, table, totals, generatedBy, orientation }) {
  const sections = table.sections || [{ cols: table.cols, rows: table.rows }];
  return renderReportPdf(
    <ReportDocument company={company} title={title} subtitle={subtitle} generatedBy={generatedBy} orientation={orientation}>
      {sections.map((s, i) => (
        <React.Fragment key={i}>
          {s.title ? <Text style={tokens.sectionTitle}>{s.title}</Text> : null}
          {s.rows.length
            ? <ReportTable cols={s.cols} rows={s.rows} />
            : (s.cols.length ? <Text style={tokens.empty}>No data for this period.</Text> : null)}
        </React.Fragment>
      ))}
      <ReportTotals pairs={totals} />
    </ReportDocument>
  );
}
