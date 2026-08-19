// lib/bom-pdf.js — Master BOM PDF, modeled directly on lib/sos-pdf.js (same @react-pdf/renderer
// approach, same header/meta/table shape) rather than a new layout system.
import React from 'react';
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from '@react-pdf/renderer';

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 8, fontFamily: 'Helvetica', color: '#111' },
  center: { textAlign: 'center' },
  company: { fontSize: 13, fontWeight: 'bold' },
  sub: { fontSize: 7, color: '#555', marginTop: 2 },
  title: { fontSize: 10, fontWeight: 'bold', marginTop: 6, marginBottom: 4, textAlign: 'center' },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, fontSize: 8 },
  tHead: { flexDirection: 'row', backgroundColor: '#eee', borderTop: 1, borderBottom: 1, borderColor: '#999' },
  tRow: { flexDirection: 'row', borderBottom: 1, borderColor: '#ddd', minHeight: 14 },
  cell: { paddingVertical: 3, paddingHorizontal: 3, borderRight: 1, borderColor: '#ddd' },
  sub2: { fontSize: 6, color: '#666' },
});

const COLS = [['#', 4], ['Description', 26], ['Item Code', 11], ['MOC', 11], ['Size / Spec', 15], ['Drawing', 13], ['Qty', 10], ['Status', 10]];

function Row({ it, i }) {
  const vals = [
    i + 1, it.material_description, it.catalog_item_code || '—', it.moc || '—', it.size_spec || '—',
    it.drawing_name ? `${it.drawing_name}${it.drawing_revision ? ` (${it.drawing_revision})` : ''}` : '—',
    it.qty_text || '—', it.purchase_status || 'Enquiry',
  ];
  return (
    <View style={s.tRow} wrap={false}>
      {COLS.map(([, w], j) => <Text key={j} style={[s.cell, { width: `${w}%` }]}>{vals[j]}</Text>)}
    </View>
  );
}

function BomDoc({ project, bom, revision }) {
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={s.page}>
        <View style={s.center}>
          <Text style={s.company}>SHANTI BOILERS &amp; PRESSURE VESSELS PVT LTD</Text>
          <Text style={s.sub}>P-10-10, I.D.A, Nacharam, Hyderabad - 500 056 · GST: 36AAECS7382N1ZN</Text>
          <Text style={s.title}>MASTER BILL OF MATERIALS</Text>
        </View>
        <View style={s.metaRow}>
          <Text>Project: {project.project_no} — {project.customer_name}</Text>
          <Text>{bom.length} item(s){revision ? ` · Released revision ${revision}` : ' · Not yet released'}</Text>
        </View>
        <View style={s.tHead}>
          {COLS.map(([label, w], i) => <Text key={i} style={[s.cell, { width: `${w}%`, fontWeight: 'bold' }]}>{label}</Text>)}
        </View>
        {bom.map((it, i) => <Row key={it.id} it={it} i={i} />)}
      </Page>
    </Document>
  );
}

export async function renderBomPdf({ project, bom, revision }) {
  return renderToBuffer(<BomDoc project={project} bom={bom} revision={revision} />);
}
