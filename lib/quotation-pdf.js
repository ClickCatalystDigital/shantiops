// lib/quotation-pdf.js — V3_CHANGES.md §12 Phase 2d. Customer-facing Quotation PDF, modeled
// directly on lib/po-pdf.js (same @react-pdf/renderer approach, same header/meta/table/totals
// shape) — a Quotation is the mirror-image commercial document (Ops→Customer) to the PO
// (Ops→Supplier). Sales CRM plan 1g: each line has its own GST %, and the quotation stores its
// CGST+SGST / IGST split (computed once at creation by lib/sales-lines.mjs — this file only prints
// it, never recomputes tax). Quotations made before that print the old single "GST @ X%" line.
// Still never a ledger entry — a quotation is an offer, not a tax document.
import React from 'react';
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { companyProfile } from './company-profiles.js';

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
  tHead: { flexDirection: 'row', backgroundColor: '#eee', borderTopWidth: 1, borderBottomWidth: 1, borderLeftWidth: 1, borderColor: '#999' },
  tRow: { flexDirection: 'row', borderBottomWidth: 1, borderLeftWidth: 1, borderColor: '#ddd', minHeight: 14 },
  cell: { paddingVertical: 3, paddingHorizontal: 3, borderRightWidth: 1, borderColor: '#ddd' },
  termsRow: { flexDirection: 'row', marginTop: 10 },
  termsCol: { width: '55%' },
  totalsCol: { width: '45%' },
  termLine: { flexDirection: 'row', paddingVertical: 1 },
  termLabel: { color: '#666', width: 90 },
  totalLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2, paddingHorizontal: 4 },
  grandTotal: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, paddingHorizontal: 4, borderTopWidth: 1, borderColor: '#333', fontWeight: 'bold' },
  signRow: { flexDirection: 'row', marginTop: 26, justifyContent: 'space-between' },
  signBox: { width: '45%', borderTopWidth: 1, borderColor: '#333', paddingTop: 4, textAlign: 'center', fontSize: 7 },
});

const COLS = [['Sr No', 5], ['Particular', 29], ['HSN', 8], ['Unit', 6], ['Qty', 6], ['Rate', 11], ['Disc %', 7], ['Rate after Disc', 11], ['GST %', 6], ['Amount', 11]];

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
  const rate = Number(it.rate) || 0;
  const discountPct = Number(it.discount_pct) || 0;
  const rateAfterDiscount = rate * (1 - discountPct / 100);
  const vals = [i + 1, it.item_description, it.hsn_code, it.uom, it.qty, fmt(rate),
    discountPct ? `${discountPct}%` : '—', fmt(rateAfterDiscount), it.gst_pct != null ? `${it.gst_pct}%` : '—', fmt(it.amount)];
  return (
    <View style={s.tRow} wrap={false}>
      {COLS.map(([, w], j) => (
        <Text key={j} style={[s.cell, { width: `${w}%` }]}>{vals[j] ?? '—'}</Text>
      ))}
    </View>
  );
}

// CGST+SGST or IGST as stored on the quotation; the rate is shown only when every line shares one.
function taxLines(q) {
  const cgst = Number(q.cgst_amount) || 0, sgst = Number(q.sgst_amount) || 0, igst = Number(q.igst_amount) || 0;
  if (!cgst && !sgst && !igst) return [[`GST @ ${q.tax_pct}%`, q.tax_amount]];
  const rate = Number(q.tax_pct) || 0;
  const lines = [];
  if (cgst || sgst) {
    lines.push([rate ? `CGST @ ${rate / 2}%` : 'CGST', cgst], [rate ? `SGST @ ${rate / 2}%` : 'SGST', sgst]);
  }
  if (igst) lines.push([rate ? `IGST @ ${rate}%` : 'IGST', igst]);
  return lines;
}

function QuotationDoc({ quotation, items }) {
  const profile = companyProfile(quotation.company);
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.center}>
          <Text style={s.company}>{profile.name}</Text>
          <Text style={s.sub}>{profile.sub}</Text>
          <Text style={s.title}>COMMERCIAL OFFER</Text>
        </View>

        <View style={s.metaRow}>
          <View style={s.metaCol}>
            <Text style={{ fontWeight: 'bold', marginBottom: 3 }}>M/s. {quotation.customer_name}</Text>
          </View>
          <View style={s.metaCol}>
            <Meta label="Quotation No" value={quotation.quotation_no} />
            <Meta label="Date" value={fmtDate(quotation.quotation_date)} />
            <Meta label="Valid Until" value={fmtDate(quotation.valid_until)} />
            <Meta label="Type" value={quotation.quotation_type} />
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
            {taxLines(quotation).map(([label, amount]) => (
              <View key={label} style={s.totalLine}><Text>{label}</Text><Text>{fmt(amount)}</Text></View>
            ))}
            <View style={s.grandTotal}><Text>GRAND TOTAL</Text><Text>{fmt(quotation.total)}</Text></View>
          </View>
        </View>

        <View style={s.signRow}>
          <Text style={s.signBox}>ACCEPTED</Text>
          <Text style={s.signBox}>For {profile.name}{'\n'}Sales Dept // Authorized Signatory</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderQuotationPdf(quotation, items) {
  return renderToBuffer(<QuotationDoc quotation={quotation} items={items} />);
}
