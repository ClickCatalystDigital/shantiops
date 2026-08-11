// lib/quotation-pdf.js — V3_CHANGES.md §12 Phase 2d. Customer-facing Quotation PDF, modeled
// directly on lib/po-pdf.js (same @react-pdf/renderer approach, same header/meta/table/totals
// shape) — a Quotation is the mirror-image commercial document (Ops→Customer) to the PO
// (Ops→Supplier). HARD BOUNDARY: totals are simple line-sum + one flat tax_pct, exactly the same
// "GST @ X%" precedent po-pdf.js already sets — never IGST vs CGST/SGST, never a ledger entry.
import React from 'react';
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from '@react-pdf/renderer';

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 8, fontFamily: 'Helvetica', color: '#111' },
  center: { textAlign: 'center' },
  company: { fontSize: 13, fontWeight: 'bold' },
  sub: { fontSize: 7, color: '#555', marginTop: 2 },
  title: { fontSize: 10, fontWeight: 'bold', marginTop: 6, marginBottom: 10, textAlign: 'center' },
  metaRow: { flexDirection: 'row', marginBottom: 10 },
  metaCol: { width: '50%' },
  metaLine: { flexDirection: 'row', paddingVertical: 1 },
  metaLabel: { color: '#666', width: 70 },
  metaVal: { fontWeight: 'bold', flex: 1 },
  tHead: { flexDirection: 'row', backgroundColor: '#eee', borderTop: 1, borderBottom: 1, borderColor: '#999' },
  tRow: { flexDirection: 'row', borderBottom: 1, borderColor: '#ddd', minHeight: 14 },
  cell: { paddingVertical: 3, paddingHorizontal: 3, borderRight: 1, borderColor: '#ddd' },
  termsRow: { flexDirection: 'row', marginTop: 10 },
  termsCol: { width: '55%' },
  totalsCol: { width: '45%' },
  termLine: { flexDirection: 'row', paddingVertical: 1 },
  termLabel: { color: '#666', width: 90 },
  totalLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2, paddingHorizontal: 4 },
  grandTotal: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, paddingHorizontal: 4, borderTop: 1, borderColor: '#333', fontWeight: 'bold' },
  signRow: { flexDirection: 'row', marginTop: 26, justifyContent: 'space-between' },
  signBox: { width: '45%', borderTop: 1, borderColor: '#333', paddingTop: 4, textAlign: 'center', fontSize: 7 },
});

const COLS = [['S.No', 6], ['Description', 42], ['HSN', 10], ['Qty', 8], ['UoM', 8], ['Rate', 12], ['Amount', 14]];

function Meta({ label, value }) {
  return (
    <View style={s.metaLine}>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={s.metaVal}>{value || '—'}</Text>
    </View>
  );
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d)) return v;
  return d.toLocaleDateString('en-GB');
}

function Row({ it, i }) {
  const vals = [i + 1, it.item_description, it.hsn_code, it.qty, it.uom, fmt(it.rate), fmt(it.amount)];
  return (
    <View style={s.tRow} wrap={false}>
      {COLS.map(([, w], j) => (
        <Text key={j} style={[s.cell, { width: `${w}%` }]}>{vals[j] ?? '—'}</Text>
      ))}
    </View>
  );
}

function QuotationDoc({ quotation, items }) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.center}>
          <Text style={s.company}>SHANTI BOILERS &amp; PRESSURE VESSELS PVT LTD</Text>
          <Text style={s.sub}>P-10-10, I.D.A, Nacharam, Hyderabad - 500 056 · GST: 36AAECS7382N1ZN · Ph: 27174042 / 27152164</Text>
          <Text style={s.title}>QUOTATION</Text>
        </View>

        <View style={s.metaRow}>
          <View style={s.metaCol}>
            <Text style={{ fontWeight: 'bold', marginBottom: 3 }}>M/s. {quotation.customer_name}</Text>
          </View>
          <View style={s.metaCol}>
            <Meta label="Quotation No" value={quotation.quotation_no} />
            <Meta label="Date" value={fmtDate(quotation.quotation_date)} />
            <Meta label="Valid Until" value={fmtDate(quotation.valid_until)} />
          </View>
        </View>

        <View style={s.tHead}>
          {COLS.map(([label, w], i) => (
            <Text key={i} style={[s.cell, { width: `${w}%`, fontWeight: 'bold' }]}>{label}</Text>
          ))}
        </View>
        {items.map((it, i) => <Row key={it.id} it={it} i={i} />)}

        <View style={s.termsRow}>
          <View style={s.termsCol}>
            <View style={s.termLine}><Text style={s.termLabel}>Terms:-</Text><Text>{quotation.terms || '—'}</Text></View>
          </View>
          <View style={s.totalsCol}>
            <View style={s.totalLine}><Text>Sub Total</Text><Text>{fmt(quotation.subtotal)}</Text></View>
            <View style={s.totalLine}><Text>GST @ {quotation.tax_pct}%</Text><Text>{fmt(quotation.tax_amount)}</Text></View>
            <View style={s.grandTotal}><Text>GRAND TOTAL</Text><Text>{fmt(quotation.total)}</Text></View>
          </View>
        </View>

        <View style={s.signRow}>
          <Text style={s.signBox}>ACCEPTED</Text>
          <Text style={s.signBox}>For SHANTI BOILERS & PRESSURE VESSELS PVT LTD.{'\n'}Sales Dept // Authorized Signatory</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderQuotationPdf(quotation, items) {
  return renderToBuffer(<QuotationDoc quotation={quotation} items={items} />);
}
