// lib/stock-receipt-tag-pdf.js — the physical identification tag (Feature A): Qty + GRN Number +
// Supplier + Invoice Number, printable per material line or for the whole receipt. Mirrors
// lib/po-pdf.js's shape exactly (small single-record @react-pdf/renderer doc, not the tabular
// Report Engine) — a real line table below the header, never a single guessed "dominant" quantity.
import React from 'react';
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { companyProfile } from './qc-doc-pdf.js';

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: 'Helvetica', color: '#111' },
  center: { textAlign: 'center' },
  company: { fontSize: 13, fontWeight: 'bold' },
  sub: { fontSize: 7, color: '#555', marginTop: 2 },
  title: { fontSize: 11, fontWeight: 'bold', marginTop: 10, marginBottom: 14, textAlign: 'center' },
  metaLine: { flexDirection: 'row', paddingVertical: 3 },
  metaLabel: { color: '#666', width: 110, fontSize: 9 },
  metaVal: { fontWeight: 'bold', flex: 1, fontSize: 10 },
  metaBlock: { marginBottom: 16 },
  tHead: { flexDirection: 'row', backgroundColor: '#eee', borderTop: 1, borderBottom: 1, borderColor: '#999' },
  tRow: { flexDirection: 'row', borderBottom: 1, borderColor: '#ddd', minHeight: 16 },
  cell: { paddingVertical: 4, paddingHorizontal: 4, borderRight: 1, borderColor: '#ddd' },
});

const COLS = [['S.No', 8], ['Description', 62], ['Qty', 30]];

function Meta({ label, value }) {
  return (
    <View style={s.metaLine}>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={s.metaVal}>{value || '—'}</Text>
    </View>
  );
}

function TagDoc({ receipt, lines }) {
  const profile = companyProfile(receipt.company);
  return (
    <Document>
      <Page size="A5" style={s.page}>
        <View style={s.center}>
          <Text style={s.company}>{profile.name}</Text>
          <Text style={s.sub}>{profile.sub}</Text>
          <Text style={s.title}>MATERIAL IDENTIFICATION TAG</Text>
        </View>
        <View style={s.metaBlock}>
          <Meta label="GRN Number" value={receipt.grn_ref} />
          <Meta label="Supplier" value={receipt.supplier_name} />
          <Meta label="Invoice Number" value={receipt.invoice_no} />
          <Meta label="Inward Batch No" value={receipt.inward_batch_no} />
        </View>

        <View style={s.tHead}>
          {COLS.map(([label, w], i) => (
            <Text key={i} style={[s.cell, { width: `${w}%`, fontWeight: 'bold' }]}>{label}</Text>
          ))}
        </View>
        {lines.map((l, i) => (
          <View key={l.id ?? i} style={s.tRow} wrap={false}>
            <Text style={[s.cell, { width: `${COLS[0][1]}%` }]}>{i + 1}</Text>
            <Text style={[s.cell, { width: `${COLS[1][1]}%` }]}>{l.description || '—'}</Text>
            <Text style={[s.cell, { width: `${COLS[2][1]}%` }]}>{l.qty ?? '—'}</Text>
          </View>
        ))}
      </Page>
    </Document>
  );
}

export async function renderStockReceiptTagPdf(receipt, lines) {
  return renderToBuffer(<TagDoc receipt={receipt} lines={lines} />);
}
