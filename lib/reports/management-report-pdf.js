// lib/reports/management-report-pdf.js — PDF rendering for computeManagementReport()'s result.
// Headline numbers as boxed stat tiles (<StatGrid>, lib/report-pdf.js), not <ReportTable> — this
// document is deliberately not a ledger, see lib/reports/management-report.js's header comment.
import React from 'react';
import { Text } from '@react-pdf/renderer';
import { ReportDocument, StatGrid, renderReportPdf, fmt, tokens } from '../report-pdf.js';

function ManagementReportDoc({ company, result, generatedBy }) {
  const { asOf, fy, cash, arTotal, apTotal, inventoryValue, workingCapital, balanceSheet, mtdPnl, fytdPnl } = result;
  return (
    <ReportDocument
      company={company}
      title="MANAGEMENT REPORT"
      subtitle={`As of ${asOf}`}
      generatedBy={generatedBy}
    >
      <Text style={tokens.sectionTitle}>Liquidity</Text>
      <StatGrid
        stats={[
          ['Cash & Bank', fmt(cash, { currency: true })],
          ['Receivables Outstanding', fmt(arTotal, { currency: true })],
          ['Payables Outstanding', fmt(apTotal, { currency: true })],
          ['Inventory Value', fmt(inventoryValue, { currency: true })],
          ['Working Capital', fmt(workingCapital, { currency: true })],
        ]}
      />

      <Text style={tokens.sectionTitle}>Profit & Loss — Month to Date</Text>
      <StatGrid
        stats={[
          ['Revenue', fmt(mtdPnl.totalIncome, { currency: true })],
          ['Expense', fmt(mtdPnl.totalExpense, { currency: true })],
          ['Net Profit', fmt(mtdPnl.netProfit, { currency: true })],
        ]}
      />

      <Text style={tokens.sectionTitle}>Profit & Loss — FY {fy.from} to {asOf}</Text>
      <StatGrid
        stats={[
          ['Revenue', fmt(fytdPnl.totalIncome, { currency: true })],
          ['Expense', fmt(fytdPnl.totalExpense, { currency: true })],
          ['Net Profit', fmt(fytdPnl.netProfit, { currency: true })],
        ]}
      />

      <Text style={tokens.sectionTitle}>Balance Sheet — as of {asOf}</Text>
      <StatGrid
        stats={[
          ['Total Assets', fmt(balanceSheet.totalAssets, { currency: true })],
          ['Total Liabilities', fmt(balanceSheet.totalLiabilities, { currency: true })],
          ['Total Equity', fmt(balanceSheet.totalEquity, { currency: true })],
        ]}
      />
    </ReportDocument>
  );
}

export function renderManagementReportPdf({ company, result, generatedBy }) {
  return renderReportPdf(<ManagementReportDoc company={company} result={result} generatedBy={generatedBy} />);
}
