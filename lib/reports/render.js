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
  ['Debit', 17, (a) => fmt(a.debit)],
  ['Credit', 17, (a) => fmt(a.credit)],
];

export function trialBalanceTable(result) {
  return { cols: TRIAL_BALANCE_COLS, rows: result.accounts };
}

export const CUSTOMER_LEDGER_COLS = [
  ['Date', 12, (e) => fmtDate(e.date)],
  ['Type', 13, (e) => e.kind],
  ['Reference', 25, (e) => e.ref],
  ['Debit', 16, (e) => e.debit ? fmt(e.debit) : ''],
  ['Credit', 16, (e) => e.credit ? fmt(e.credit) : ''],
  ['Balance', 18, (e) => fmt(e.balance)],
];

export function customerLedgerTable(result) {
  return { cols: CUSTOMER_LEDGER_COLS, rows: result.entries };
}

export const STOCK_VALUATION_COLS = [
  ['Item Code', 16, (i) => i.item_code || '—'],
  ['Description', 40, (i) => i.description],
  ['On Hand', 14, (i) => i.on_hand],
  ['Avg Cost', 15, (i) => fmt(i.avg_cost)],
  ['Value', 15, (i) => fmt(i.value)],
];

export function stockValuationTable(result) {
  return { cols: STOCK_VALUATION_COLS, rows: result.items };
}

const SECTION_ACCOUNT_COLS = [
  ['Section', 16, (a) => a.section],
  ['Code', 12, (a) => a.account_code],
  ['Account', 42, (a) => a.account_name],
  ['Amount', 30, (a) => fmt(a.balance)],
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
  ['Invoices', 9, (g) => g.invoice_count],
  ['Taxable', 16, (g) => fmt(g.taxable)],
  ['CGST', 10, (g) => fmt(g.cgst)],
  ['SGST', 10, (g) => fmt(g.sgst)],
  ['IGST', 10, (g) => fmt(g.igst)],
];
export const GSTR1_HSN_COLS = [
  ['HSN', 12, (h) => h.hsn_code || '—'],
  ['UOM', 10, (h) => h.uom || '—'],
  ['Qty', 12, (h) => h.qty],
  ['Taxable', 22, (h) => fmt(h.taxable)],
  ['CGST', 14, (h) => fmt(h.cgst)],
  ['SGST', 14, (h) => fmt(h.sgst)],
  ['IGST', 16, (h) => fmt(h.igst)],
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
  ['Tax Amount', 18, (l) => fmt(l.tax_amount)],
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
  ['Days Overdue', 14, (i) => i.daysOverdue],
  ['Bucket', 12, (i) => i.bucket],
  ['Outstanding', 14, (i) => fmt(i.outstanding)],
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
  ['Days Idle', 14, (i) => i.daysOverdue],
  ['Bucket', 10, (i) => i.bucket],
  ['Value', 14, (i) => fmt(i.outstanding)],
];
export function inventoryAgingTable(result) {
  return { cols: INVENTORY_AGING_COLS, rows: result.items };
}

export const JOURNAL_REGISTER_COLS = [
  ['Date', 12, (e) => fmtDate(e.entry_date)],
  ['Source', 20, (e) => e.source_type],
  ['Description', 48, (e) => e.description || '—'],
  ['Amount', 20, (e) => fmt(e.amount)],
];
export function journalRegisterTable(result) {
  return { cols: JOURNAL_REGISTER_COLS, rows: result.entries };
}

export const MATERIAL_CONSUMPTION_COLS = [
  ['Date', 12, (l) => fmtDate(l.issued_at)],
  ['Project', 16, (l) => l.project_no],
  ['Material', 32, (l) => l.material_description],
  ['Qty', 10, (l) => l.qty],
  ['Unit Cost', 15, (l) => fmt(l.unit_cost)],
  ['Total Cost', 15, (l) => fmt(l.total_cost)],
];
export function materialConsumptionTable(result) {
  return { cols: MATERIAL_CONSUMPTION_COLS, rows: result.lines };
}

export const BANK_RECONCILIATION_COLS = [
  ['Date', 12, (l) => fmtDate(l.entry_date)],
  ['Description', 40, (l) => l.description || l.source_type],
  ['Debit', 16, (l) => l.debit ? fmt(l.debit) : ''],
  ['Credit', 16, (l) => l.credit ? fmt(l.credit) : ''],
  ['Reconciled', 16, (l) => l.reconciled ? 'Yes' : 'No'],
];
export function bankReconciliationTable(result) {
  return { cols: BANK_RECONCILIATION_COLS, rows: result.lines };
}

export const PURCHASE_REGISTER_COLS = [
  ['Bill No', 16, (b) => b.bill_no],
  ['Date', 12, (b) => fmtDate(b.bill_date)],
  ['Supplier', 28, (b) => b.supplier_name],
  ['Subtotal', 14, (b) => fmt(b.subtotal)],
  ['Tax', 14, (b) => fmt(b.tax_amount)],
  ['Payable', 16, (b) => fmt(b.payable_amount)],
];
export function purchaseRegisterTable(result) {
  return { cols: PURCHASE_REGISTER_COLS, rows: result.bills };
}

export const SALES_REGISTER_COLS = [
  ['Invoice No', 18, (i) => i.invoice_no],
  ['Date', 12, (i) => fmtDate(i.invoice_date)],
  ['Customer', 30, (i) => i.customer_name],
  ['Subtotal', 16, (i) => fmt(i.subtotal)],
  ['Tax', 12, (i) => fmt(i.tax_amount)],
  ['Total', 12, (i) => fmt(i.total)],
];
export function salesRegisterTable(result) {
  return { cols: SALES_REGISTER_COLS, rows: result.invoices };
}

// Shared by every catalog entry's PDF export — `table` is either {cols, rows} (the common case) or
// {sections: [{title, cols, rows}]} (GSTR-1: B2B summary + HSN summary, two distinct tables).
// `totals` is the [[label, value]] pairs a report's `totals(result)` produces (see catalog.js).
export function renderCatalogPdf({ company, title, subtitle, table, totals }) {
  const sections = table.sections || [{ cols: table.cols, rows: table.rows }];
  return renderReportPdf(
    <ReportDocument company={company} title={title} subtitle={subtitle}>
      {sections.map((s, i) => (
        <React.Fragment key={i}>
          {s.title ? <Text style={tokens.sectionTitle}>{s.title}</Text> : null}
          {s.rows.length ? <ReportTable cols={s.cols} rows={s.rows} /> : null}
        </React.Fragment>
      ))}
      <ReportTotals pairs={totals} />
    </ReportDocument>
  );
}
