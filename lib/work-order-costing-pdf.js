// lib/work-order-costing-pdf.js — REPORT-ENGINE-PLAN.md §10 Phase 2 (Work Order Costing). Per-work
// order document, same reasoning as lib/project-costing-pdf.js: reached from the Work Order's own
// page, not the Reports-tab catalog.
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { Text } from '@react-pdf/renderer';
import { ReportDocument, ReportTable, tokens, fmt } from './report-pdf.js';

const METRIC_COLS = [
  ['Metric', 30, (p) => p[0]],
  ['Planned', 35, (p) => p[1]],
  ['Actual', 35, (p) => p[2]],
];

const OUTSIDE_CARD_COLS = [
  ['Section', 40, (c) => c.section],
  ['Vendor', 35, (c) => c.outside_vendor || '—'],
  ['Status', 25, (c) => c.status],
];

function WorkOrderCostingDoc({ workOrder, costing, company }) {
  const rows = [
    ['Material Cost', fmt(costing.plannedMaterialCost), fmt(costing.actualMaterialCost)],
    ['Labor Cost', fmt(costing.plannedLaborCost), fmt(costing.actualLaborCost)],
    ['Total', fmt(costing.plannedTotal), fmt(costing.actualTotal)],
  ];
  return (
    <ReportDocument company={company} title="WORK ORDER COSTING" subtitle={`${workOrder.wo_no} · Material scope: ${costing.materialScope}`}>
      <ReportTable cols={METRIC_COLS} rows={rows} rowKey={(r, i) => i} />
      {costing.outsideJobCards.length > 0 && (
        <>
          <Text style={tokens.sectionTitle}>Outside Job Cards (subcontract — no cost field exists to price these)</Text>
          <ReportTable cols={OUTSIDE_CARD_COLS} rows={costing.outsideJobCards} />
        </>
      )}
    </ReportDocument>
  );
}

export async function renderWorkOrderCostingPdf(workOrder, costing, company) {
  return renderToBuffer(<WorkOrderCostingDoc workOrder={workOrder} costing={costing} company={company} />);
}
