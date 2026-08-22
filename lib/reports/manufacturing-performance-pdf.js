// lib/reports/manufacturing-performance-pdf.js — PDF rendering for
// computeManufacturingPerformance()'s result. Headline stat tiles (<StatGrid>), same shape as
// management-report-pdf.js — this is deliberately not a ledger either.
import React from 'react';
import { Text } from '@react-pdf/renderer';
import { ReportDocument, StatGrid, renderReportPdf, fmt, tokens } from '../report-pdf.js';

function ManufacturingPerformanceDoc({ company, result, subtitle, generatedBy }) {
  const {
    totalWO, completedWO, inProgressWO, delayedWO,
    totalQtyDone, totalQtyRejected, rejectionRatePct, qcFailures,
    totalUsedWt, totalRemnantWt, totalScrapWt, overallYieldPct,
    totalPlannedCost, totalActualCost, totalCostVariance,
    totalLabourHours, totalLabourCost, outstandingMaterialLines,
  } = result;
  return (
    <ReportDocument
      company={company}
      title="MANUFACTURING PERFORMANCE SUMMARY"
      subtitle={subtitle}
      generatedBy={generatedBy}
    >
      <Text style={tokens.sectionTitle}>Work Order Throughput</Text>
      <StatGrid
        stats={[
          ['Total Work Orders', String(totalWO)],
          ['In Progress', String(inProgressWO)],
          ['Delayed', String(delayedWO)],
          ['Completed', String(completedWO)],
        ]}
      />

      <Text style={tokens.sectionTitle}>Quality</Text>
      <StatGrid
        stats={[
          ['Qty Done', String(totalQtyDone)],
          ['Qty Rejected', String(totalQtyRejected)],
          ['Rejection Rate', rejectionRatePct == null ? '—' : `${rejectionRatePct}%`],
          ['QC Failures', String(qcFailures)],
        ]}
      />

      <Text style={tokens.sectionTitle}>Material Yield</Text>
      <StatGrid
        stats={[
          ['Used', `${totalUsedWt} kg`],
          ['Remnant Recovered', `${totalRemnantWt} kg`],
          ['Scrap', `${totalScrapWt} kg`],
          ['Overall Yield', overallYieldPct == null ? '—' : `${overallYieldPct}%`],
        ]}
      />

      <Text style={tokens.sectionTitle}>Labour</Text>
      <StatGrid
        stats={[
          ['Hours Logged', String(totalLabourHours)],
          ['Labour Cost', fmt(totalLabourCost, { currency: true })],
        ]}
      />

      <Text style={tokens.sectionTitle}>Cost Variance</Text>
      <StatGrid
        stats={[
          ['Planned Cost', fmt(totalPlannedCost, { currency: true })],
          ['Actual Cost', fmt(totalActualCost, { currency: true })],
          ['Variance', fmt(totalCostVariance, { currency: true })],
        ]}
      />

      <Text style={tokens.sectionTitle}>Material Availability</Text>
      <StatGrid
        stats={[
          ['Material Lines Blocking Production (next 30d)', String(outstandingMaterialLines)],
        ]}
      />
    </ReportDocument>
  );
}

export function renderManufacturingPerformancePdf({ company, result, subtitle, generatedBy }) {
  return renderReportPdf(<ManufacturingPerformanceDoc company={company} result={result} subtitle={subtitle} generatedBy={generatedBy} />);
}
