// lib/bom-pdf.js — Master BOM PDF. Migrated onto the shared lib/report-pdf.js frame (identity
// header + repeating footer + fixed table header) — opportunistic migration per REPORT-ENGINE-PLAN
// (a report table that can now span multiple pages needs the repeating header report-pdf.js adds).
import React from 'react';
import { View, Text, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { ReportDocument, ReportTable } from './report-pdf.js';

const s = StyleSheet.create({
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, fontSize: 8 },
});

const COLS = [
  ['#', 4, (it, i) => i + 1],
  ['Description', 26, (it) => it.material_description],
  ['Item Code', 11, (it) => it.catalog_item_code || '—'],
  ['MOC', 11, (it) => it.moc || '—'],
  ['Size / Spec', 15, (it) => it.size_spec || '—'],
  ['Drawing', 13, (it) => it.drawing_name ? `${it.drawing_name}${it.drawing_revision ? ` (${it.drawing_revision})` : ''}` : '—'],
  ['Qty', 10, (it) => it.qty_text || '—'],
  ['Status', 10, (it) => it.purchase_status || 'Enquiry'],
];

function BomDoc({ project, bom, revision }) {
  return (
    <ReportDocument company="Shanti Boilers" title="MASTER BILL OF MATERIALS" orientation="landscape">
      <View style={s.metaRow}>
        <Text>Project: {project.project_no} — {project.customer_name}</Text>
        <Text>{bom.length} item(s){revision ? ` · Released revision ${revision}` : ' · Not yet released'}</Text>
      </View>
      <ReportTable cols={COLS} rows={bom} />
    </ReportDocument>
  );
}

export async function renderBomPdf({ project, bom, revision }) {
  return renderToBuffer(<BomDoc project={project} bom={bom} revision={revision} />);
}
