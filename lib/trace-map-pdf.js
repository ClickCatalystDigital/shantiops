// lib/trace-map-pdf.js — Material Trace Map for one project (Data Book section 5): one row per heat used.
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { ReportDocument, ReportTable } from './report-pdf.js';

const list = (a, f) => [...new Set(a.map(f).filter(Boolean))].join(', ') || '—';
const COLS = [
  ['Heat', 10, r => r.heat],
  ['Certificate / spec / mill', 22, r => list(r.certificates, c => `${c.certificate_no} · ${c.material_spec} · ${c.steel_maker}`)],
  ['Received (supplier, PO)', 18, r => list(r.pieces, p => [p.supplier, p.po_no, p.grn_ref].filter(Boolean).join(' · '))],
  ['Pieces', 16, r => list(r.pieces, p => p.code)],
  ['Used on (BOM line)', 18, r => list(r.bom, b => `${b.material_description}${b.size_spec ? ` ${b.size_spec}` : ''}`)],
  ['Welds', 8, r => list(r.welds, w => w.weld_no)],
  ['QC documents', 8, r => list(r.documents, d => d.doc_id)],
];

export async function renderTraceMapPdf({ project, chains, company, generatedBy, footer = true }) {
  return renderToBuffer(
    <ReportDocument company={company} title="MATERIAL TRACE MAP" subtitle={`${project.project_no} · ${project.customer_name || ''}`}
      generatedBy={generatedBy} orientation="landscape" footer={footer}>
      <ReportTable cols={COLS} rows={chains} rowKey={(r, i) => `${r.heat}-${i}`} compact />
    </ReportDocument>,
  );
}
