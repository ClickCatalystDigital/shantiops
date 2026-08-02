// Real generated Purchase Order PDF (§5a) — mirrors lib/packing-pdf.js exactly (same
// @react-pdf/renderer approach, pure Node, no headless browser) but matches the layout of the
// business's actual hand-made POs (samples: 578/SB/2025-26, 562/SB/2026-27 (split-po)): fixed
// Shanti header/GST, supplier block, PO meta, line table, terms + totals, sign-off.
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
  instructions: { marginTop: 12, fontSize: 7, fontWeight: 'bold' },
  footerNote: { marginTop: 8, fontSize: 7 },
  signRow: { flexDirection: 'row', marginTop: 26, justifyContent: 'space-between' },
  signBox: { width: '45%', borderTop: 1, borderColor: '#333', paddingTop: 4, textAlign: 'center', fontSize: 7 },
  addrBlock: { marginTop: 14, fontSize: 7, lineHeight: 1.4 },
});

// Column widths (sum = 100).
const COLS = [['S.No', 6], ['Description', 40], ['Qty', 10], ['UoM', 10], ['Rate', 16], ['Amount', 18]];

function Meta({ label, value }) {
  return (
    <View style={s.metaLine}>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={s.metaVal}>{value || '—'}</Text>
    </View>
  );
}

function Row({ it, i }) {
  const vals = [i + 1, it.description, it.qty, it.uom, fmt(it.rate), fmt(it.amount)];
  return (
    <View style={s.tRow} wrap={false}>
      {COLS.map(([, w], j) => (
        <Text key={j} style={[s.cell, { width: `${w}%` }]}>{vals[j] ?? '—'}</Text>
      ))}
    </View>
  );
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function PoDoc({ po, items }) {
  const subTotal = items.reduce((a, it) => a + Number(it.amount || 0), 0);
  const discountAmt = subTotal * (Number(po.discount_pct) || 0) / 100;
  const taxable = subTotal - discountAmt;
  const gstAmt = taxable * (Number(po.gst_pct) || 0) / 100;
  const grandTotal = taxable + gstAmt;

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.center}>
          <Text style={s.company}>SHANTI BOILERS &amp; PRESSURE VESSELS PVT LTD</Text>
          <Text style={s.sub}>P-10-10, I.D.A, Nacharam, Hyderabad - 500 056 · GST: 36AAECS7382N1ZN · Ph: 27174042 / 27152164</Text>
          <Text style={s.title}>PURCHASE ORDER{po.is_split ? ' (SPLIT-PO)' : ''}</Text>
        </View>

        <View style={s.metaRow}>
          <View style={s.metaCol}>
            <Text style={{ fontWeight: 'bold', marginBottom: 3 }}>M/s. {po.supplier_name}</Text>
            <Meta label="Address" value={po.supplier_address} />
            <Meta label="Phone" value={po.supplier_phone} />
            <Meta label="Email" value={po.supplier_email} />
            <Meta label="GST No" value={po.supplier_gst} />
          </View>
          <View style={s.metaCol}>
            <Meta label="PO No" value={po.po_no} />
            <Meta label="PO Date" value={fmtDate(po.created_at)} />
            <Meta label="Quotation" value={po.quote_source} />
            <Meta label="Quote Date" value={po.quote_date} />
            <Meta label="Indent / Job" value={po.indent_ref} />
          </View>
        </View>

        <Text style={{ marginBottom: 6 }}>
          Dear Sir, please supply the following material/services to the terms and conditions stated below:-
        </Text>

        <View style={s.tHead}>
          {COLS.map(([label, w], i) => (
            <Text key={i} style={[s.cell, { width: `${w}%`, fontWeight: 'bold' }]}>{label}</Text>
          ))}
        </View>
        {items.map((it, i) => <Row key={it.id} it={it} i={i} />)}

        <View style={s.termsRow}>
          <View style={s.termsCol}>
            <View style={s.termLine}><Text style={s.termLabel}>Payment Terms:-</Text><Text>{po.payment_terms || '—'}</Text></View>
            <View style={s.termLine}><Text style={s.termLabel}>Delivery Schedule:-</Text><Text>{po.delivery_schedule}</Text></View>
            <View style={s.termLine}><Text style={s.termLabel}>Transportation:-</Text><Text>{po.transportation}</Text></View>
            <View style={s.termLine}><Text style={s.termLabel}>Freight:-</Text><Text>{po.freight}</Text></View>
            <View style={s.termLine}><Text style={s.termLabel}>Guarantee:-</Text><Text>{po.guarantee}</Text></View>
          </View>
          <View style={s.totalsCol}>
            <View style={s.totalLine}><Text>Sub Total</Text><Text>{fmt(subTotal)}</Text></View>
            <View style={s.totalLine}><Text>Discount {po.discount_pct}%</Text><Text>{fmt(discountAmt)}</Text></View>
            <View style={s.totalLine}><Text>GST @ {po.gst_pct}%</Text><Text>{fmt(gstAmt)}</Text></View>
            <View style={s.grandTotal}><Text>GRAND TOTAL</Text><Text>{fmt(grandTotal)}</Text></View>
          </View>
        </View>

        <Text style={s.instructions}>
          {po.special_instructions ||
            'SPECIAL INSTRUCTIONS: ALL GOODS SHOULD BE SUPPLIED STRICTLY IN ACCORDANCE WITH THE SPECIFICATION MENTIONED IN THIS PURCHASE ORDER'}
        </Text>
        <Text style={s.footerNote}>
          PLEASE ACKNOWLEDGE THE RECEIPT OF THE ORDER &amp; INFORM US CONFIRMED DELIVERY DATE.
        </Text>

        <View style={s.addrBlock}>
          <Text style={{ fontWeight: 'bold' }}>DELIVERY &amp; INVOICE ADDRESS</Text>
          <Text>{po.delivery_address || 'SHANTI BOILERS & PRESSURE VESSELS PVT LTD, OFFICE / FACTORY: P-10-10, IDA NACHARAM, HYDERABAD - 500 056, Telangana (India). Ph. 27174042 / 27152164'}</Text>
        </View>

        <View style={s.signRow}>
          <Text style={s.signBox}>ACCEPTED</Text>
          <Text style={s.signBox}>For SHANTI BOILERS & PRESSURE VESSELS PVT LTD.{'\n'}Purchase Dept // Authorized Signatory</Text>
        </View>
      </Page>
    </Document>
  );
}

function fmtDate(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d)) return v;
  return d.toLocaleDateString('en-GB'); // dd/mm/yyyy, matches the sample POs' dd.mm.yyyy style closely enough
}

export async function renderPoPdf(po, items) {
  return renderToBuffer(<PoDoc po={po} items={items} />);
}
