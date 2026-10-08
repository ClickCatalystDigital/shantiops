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
import { DocIdentity, docTitleStyle, DocFooterNote, footerPad } from './report-pdf.js';
import { amountInWords } from './service-expense.mjs';

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 8, fontFamily: 'Helvetica', color: '#111' },
  center: { textAlign: 'center' },
  company: { fontSize: 13, fontWeight: 'bold' },
  sub: { fontSize: 7, color: '#555', marginTop: 2 },
  title: { fontSize: 10, fontWeight: 'bold', marginTop: 6, marginBottom: 10, textAlign: 'center' },
  metaRow: { flexDirection: 'row', marginBottom: 10 },
  metaCol: { width: '50%' },
  metaLine: { flexDirection: 'row', paddingVertical: 1 },
  metaLabel: { color: '#666', width: 90 },
  metaVal: { fontWeight: 'bold', flex: 1 },
  tHead: { flexDirection: 'row', backgroundColor: '#eee', borderTopWidth: 1, borderBottomWidth: 1, borderLeftWidth: 1, borderColor: '#999' },
  tRow: { flexDirection: 'row', borderBottomWidth: 1, borderLeftWidth: 1, borderColor: '#ddd', minHeight: 14 },
  cell: { paddingVertical: 3, paddingHorizontal: 3, borderRightWidth: 1, borderColor: '#ddd' },
  salute: { marginBottom: 8, lineHeight: 1.4 },
  termsHead: { fontWeight: 'bold', fontSize: 9, marginTop: 14, marginBottom: 3 },
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

// Columns follow the Commercial Offer layout; Discount only appears when some line has one.
function colsFor(items) {
  const hasDisc = items.some(it => Number(it.discount_pct) > 0);
  return hasDisc
    ? [['Sr No', 6], ['Particular', 38], ['Unit', 8], ['Quantity', 9], ['Rate', 13], ['Discount', 9], ['Amount', 17]]
    : [['Sr No', 6], ['Particular', 44], ['Unit', 9], ['Quantity', 10], ['Rate', 13], ['Amount', 18]];
}

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

function Row({ it, i, cols }) {
  const disc = Number(it.discount_pct) || 0;
  const all = { 'Sr No': i + 1, Particular: it.item_description, Unit: it.uom, Quantity: it.qty, Rate: fmt(it.rate), Discount: disc ? `${disc}%` : '—', Amount: fmt(it.amount) };
  return (
    <View style={s.tRow} wrap={false}>
      {cols.map(([label, w]) => (
        <Text key={label} style={[s.cell, { width: `${w}%`, textAlign: ['Rate', 'Amount', 'Quantity'].includes(label) ? 'right' : 'left' }]}>{all[label] ?? '—'}</Text>
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
  const cols = colsFor(items);
  const address = [quotation.customer_address, quotation.customer_city, quotation.customer_state, quotation.customer_pin].filter(Boolean).join(', ');
  const terms = String(quotation.terms_print || '').trim();
  return (
    <Document>
      <Page size="A4" style={[s.page, { paddingBottom: footerPad(profile, 'quotation') }]}>
        <View style={s.center}>
          <DocIdentity profile={profile} doc="quotation" />
          <Text style={[s.title, docTitleStyle(profile, 'quotation')]}>COMMERCIAL OFFER</Text>
        </View>

        <View style={s.metaRow}>
          <View style={[s.metaCol, { width: '60%' }]}>
            <Meta label="Customer Name:" value={quotation.customer_name} />
            <Meta label="Customer Address:" value={address} />
            <Meta label="Contact Mobile:" value={quotation.customer_phone} />
            <Meta label="Email ID:" value={quotation.customer_email} />
          </View>
          <View style={[s.metaCol, { width: '40%' }]}>
            <Meta label="Quotation Number:" value={quotation.quotation_no} />
            <Meta label="Quotation Date:" value={fmtDate(quotation.quotation_date)} />
          </View>
        </View>

        <Text style={s.salute}>Dear Sir,{'\n\n'}We thank you very much for your above enquiry for Boiler and take pleasure in submitting our most competitive offer consists of the following:</Text>

        <View style={s.tHead}>
          {cols.map(([label, w]) => (
            <Text key={label} style={[s.cell, { width: `${w}%`, fontWeight: 'bold' }]}>{label}</Text>
          ))}
        </View>
        {items.map((it, i) => <Row key={it.id} it={it} i={i} cols={cols} />)}

        <View style={s.termsRow} wrap={false}>
          <View style={s.termsCol}>
            <Text style={{ fontWeight: 'bold' }}>{amountInWords(quotation.total)}</Text>
          </View>
          <View style={s.totalsCol}>
            <View style={s.totalLine}><Text>Total</Text><Text>{fmt(quotation.subtotal)}</Text></View>
            {taxLines(quotation).map(([label, amount]) => (
              <View key={label} style={s.totalLine}><Text>{label}</Text><Text>{fmt(amount)}</Text></View>
            ))}
            <View style={s.grandTotal}><Text>Grand Total</Text><Text>{fmt(quotation.total)}</Text></View>
          </View>
        </View>

        {terms ? (
          <View>
            <Text style={s.termsHead} minPresenceAhead={40}>Terms and Conditions</Text>
            <Text style={{ lineHeight: 1.4 }}>{terms}</Text>
          </View>
        ) : null}

        <View style={s.signRow} wrap={false}>
          <Text style={s.signBox}>ACCEPTED</Text>
          <Text style={s.signBox}>For {profile.name}{'\n'}Sales Dept // Authorized Signatory</Text>
        </View>
        <DocFooterNote profile={profile} doc="quotation" />
      </Page>
    </Document>
  );
}

export async function renderQuotationPdf(quotation, items) {
  return renderToBuffer(<QuotationDoc quotation={quotation} items={items} />);
}
