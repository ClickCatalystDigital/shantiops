// lib/pending-to-send-pdf.js — the customer's list of ordered items that have not been dispatched
// yet (portal "Pending Items" stage). Same report frame as the other PDFs.
import React from 'react';
import { View, Text, StyleSheet } from '@react-pdf/renderer';
import { ReportDocument, ReportTable, renderReportPdf } from './report-pdf.js';

const s = StyleSheet.create({ meta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, fontSize: 8 } });

const COLS = [
  ['SL', 6, (r) => String(r._i)],
  ['Item', 46, (r) => r.material_description],
  ['Size / Spec', 24, (r) => r.size_spec || '—'],
  ['Material', 14, (r) => r.moc || '—'],
  ['Qty', 10, (r) => r.qty_text || '—', 'right'],
];

export async function renderPendingToSendPdf({ project, items }) {
  const rows = items.map((it, i) => ({ ...it, _i: i + 1 }));
  return renderReportPdf(
    <ReportDocument doc="bom" company={project.company} title="ITEMS PENDING DISPATCH">
      <View style={s.meta}>
        <Text>Order: {project.project_no} — {project.customer_name}</Text>
        <Text>{rows.length} item(s) pending</Text>
      </View>
      <ReportTable cols={COLS} rows={rows} rowKey={(r) => r.id} />
    </ReportDocument>
  );
}
