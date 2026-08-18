// lib/sos-pdf.js — Scope of Supply / Order Acknowledgement PDF, modeled directly on
// lib/quotation-pdf.js (same @react-pdf/renderer approach, same header/meta/table/totals shape)
// — matches the client's real paper "Order Acknowledgement / Project Technical Details & Scope
// of Supply" form: client block, Job No/Offer/PO refs, priced line items, totals, then
// payment/freight/delivery terms and a prepared-by line.
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
  note: { marginTop: 14, fontSize: 7, color: '#555' },
  signRow: { flexDirection: 'row', marginTop: 26, justifyContent: 'space-between' },
  signBox: { width: '45%', borderTop: 1, borderColor: '#333', paddingTop: 4, textAlign: 'center', fontSize: 7 },
});

const COLS = [['SL', 6], ['Product', 52], ['Qty', 8], ['Unit / Price', 14], ['Basic Value', 20]];

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
  const qty = [it.qty, it.uom].filter(Boolean).join(' ');
  const vals = [i + 1, it.description, qty || '—', it.unit_price != null ? fmt(it.unit_price) : '—', fmt(it.amount)];
  return (
    <View style={s.tRow} wrap={false}>
      {COLS.map(([, w], j) => (
        <Text key={j} style={[s.cell, { width: `${w}%` }]}>{vals[j] ?? '—'}</Text>
      ))}
    </View>
  );
}

function SosDoc({ sos }) {
  const c = sos.customer || {};
  const clientAddress = [c.address, c.address2, c.city, c.state].filter(Boolean).join(', ');
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.center}>
          <Text style={s.company}>SHANTI BOILERS &amp; PRESSURE VESSELS PVT LTD</Text>
          <Text style={s.sub}>P-10-10, I.D.A, Nacharam, Hyderabad - 500 056 · GST: 36AAECS7382N1ZN · Ph: 27174042 / 27152164</Text>
          <Text style={s.title}>ORDER ACKNOWLEDGEMENT{'\n'}PROJECT TECHNICAL DETAILS &amp; SCOPE OF SUPPLY</Text>
        </View>

        <View style={s.metaRow}>
          <View style={s.metaCol}>
            <Text style={{ fontWeight: 'bold', marginBottom: 3 }}>CLIENT</Text>
            <Text style={{ fontWeight: 'bold' }}>{c.name || sos.customer_name || '—'}</Text>
            {clientAddress && <Text>{clientAddress}</Text>}
            {c.email && <Text>Email: {c.email}</Text>}
            {c.phone && <Text>Cell: {c.phone}</Text>}
          </View>
          <View style={s.metaCol}>
            <Meta label="Date" value={fmtDate(sos.created_at)} />
            <Meta label="Job No" value={sos.jobNo} />
            <Meta label="Offer" value={sos.offerNo} />
            <Meta label="Offer Date" value={fmtDate(sos.offerDate)} />
            <Meta label="PO No" value={sos.po_no} />
            <Meta label="PO Date" value={fmtDate(sos.po_date)} />
            <Meta label="GST No" value={c.gst_no} />
          </View>
        </View>

        <View style={s.tHead}>
          {COLS.map(([label, w], i) => (
            <Text key={i} style={[s.cell, { width: `${w}%`, fontWeight: 'bold' }]}>{label}</Text>
          ))}
        </View>
        {sos.items.map((it, i) => <Row key={it.id} it={it} i={i} />)}

        <View style={s.termsRow}>
          <View style={s.termsCol}>
            <View style={s.termLine}><Text style={s.termLabel}>Payment:-</Text><Text>{sos.payment_terms || '—'}</Text></View>
            <View style={s.termLine}><Text style={s.termLabel}>Freight:-</Text><Text>{sos.freight_terms || '—'}</Text></View>
            <View style={s.termLine}><Text style={s.termLabel}>Delivery:-</Text><Text>{sos.delivery_terms || '—'}</Text></View>
            <View style={s.termLine}><Text style={s.termLabel}>Prepared By:-</Text><Text>{sos.prepared_by || '—'}</Text></View>
          </View>
          <View style={s.totalsCol}>
            <View style={s.totalLine}><Text>Basic Total</Text><Text>{fmt(sos.basicTotal)}</Text></View>
            <View style={s.totalLine}><Text>GST @ {sos.tax_pct}%</Text><Text>{fmt(sos.taxAmount)}</Text></View>
            <View style={s.grandTotal}><Text>GRAND TOTAL</Text><Text>{fmt(sos.grandTotal)}</Text></View>
          </View>
        </View>

        <Text style={s.note}>
          Note: Please acknowledge the SB copy as a token of acceptance if found in order, within one week — if not received, it would be deemed to be accepted by you.
        </Text>

        <View style={s.signRow}>
          <Text style={s.signBox}>ACCEPTED</Text>
          <Text style={s.signBox}>For SHANTI BOILERS & PRESSURE VESSELS PVT LTD.{'\n'}Authorized Signatory</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderSosPdf(sos) {
  return renderToBuffer(<SosDoc sos={sos} />);
}
