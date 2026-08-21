// lib/project-costing-pdf.js — REPORT-ENGINE-PLAN.md §10 Phase 2 (Project/WIP Cost). Per-project
// document like every other lib/*-pdf.js (BOM, packing, ...), not a lib/reports/catalog.js entry —
// reached from a project's own page, not picked off the Reports-tab list, same reason BOM's PDF
// isn't in that catalog either. Reuses lib/report-pdf.js's shared frame for visual consistency.
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { ReportDocument, ReportTable, fmt } from './report-pdf.js';

const METRIC_COLS = [
  ['Metric', 50, (p) => p[0]],
  ['Value', 50, (p) => p[1]],
];

function ProjectCostingDoc({ project, costing, company }) {
  const rows = [
    ['Material Cost (issued POs)', fmt(costing.materialCost)],
    ['Labor Cost (logged time)', fmt(costing.laborCost)],
    ['Total Cost', fmt(costing.totalCost)],
    ['Selling Value', fmt(costing.sellingValue)],
    ['Margin', fmt(costing.margin)],
    ['Margin %', costing.marginPct != null ? `${costing.marginPct}%` : '—'],
  ];
  return (
    <ReportDocument company={company} title="PROJECT COSTING" subtitle={`${project.project_no} — ${project.customer_name}`}>
      <ReportTable cols={METRIC_COLS} rows={rows} rowKey={(r, i) => i} />
    </ReportDocument>
  );
}

export async function renderProjectCostingPdf(project, costing, company) {
  return renderToBuffer(<ProjectCostingDoc project={project} costing={costing} company={company} />);
}
