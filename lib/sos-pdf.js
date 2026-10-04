// lib/sos-pdf.js — Scope of Supply / Order Acknowledgement PDF, laid out like the client's paper
// "Order Acknowledgement / Project Technical Details & Scope of Supply" form: company block, client
// and reference box, numbered product lines (name, type, full description, exclusions), totals,
// terms and the acceptance note. `prices: false` gives the technical copy for teams that don't see
// money (no Rate/Amount, no totals, no commercial terms).
import React from 'react';
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { companyProfile } from './company-profiles.js';
import { DocIdentity, docTitleStyle, DocFooterNote, footerPad } from './report-pdf.js';
import { sosLine } from './sos-format.mjs';

const NAVY = '#12263f';
const s = StyleSheet.create({
  page: { paddingTop: 34, paddingBottom: 46, paddingHorizontal: 34, fontSize: 8.5, fontFamily: 'Helvetica', color: '#1a1a1a' },
  company: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: NAVY, textAlign: 'center' },
  sub: { fontSize: 7.5, color: '#555', marginTop: 3, textAlign: 'center' },
  rule: { borderTopWidth: 1.5, borderBottomWidth: 0.5, borderColor: NAVY, height: 4, marginTop: 8 },
  title: { fontSize: 11.5, fontFamily: 'Helvetica-Bold', letterSpacing: 1, textAlign: 'center', marginTop: 10 },
  subtitle: { fontSize: 8.5, color: '#444', textAlign: 'center', marginTop: 2, marginBottom: 10 },
  box: { flexDirection: 'row', borderWidth: 0.75, borderColor: '#999' },
  boxLeft: { width: '56%', padding: 8, borderRightWidth: 0.75, borderColor: '#999' },
  boxRight: { width: '44%', padding: 8 },
  boxLabel: { fontSize: 7, color: '#777', letterSpacing: 0.8, marginBottom: 3 },
  clientName: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  kv: { flexDirection: 'row', paddingVertical: 1.5 },
  k: { width: 62, color: '#666' },
  v: { flex: 1, fontFamily: 'Helvetica-Bold' },
  tHead: { flexDirection: 'row', backgroundColor: NAVY, color: '#fff', marginTop: 12 },
  tRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderLeftWidth: 0.5, borderColor: '#bbb' },
  cell: { paddingVertical: 4, paddingHorizontal: 5, borderRightWidth: 0.5, borderColor: '#bbb' },
  hCell: { paddingVertical: 5, paddingHorizontal: 5, fontFamily: 'Helvetica-Bold', fontSize: 8 },
  pName: { fontFamily: 'Helvetica-Bold', fontSize: 9 },
  pType: { fontSize: 7, color: '#666', letterSpacing: 0.5, marginTop: 1.5 },
  pBody: { marginTop: 3, lineHeight: 0.62 },
  pExcl: { marginTop: 3, color: '#555', fontSize: 8 },
  bottom: { flexDirection: 'row', marginTop: 12 },
  terms: { width: '56%', paddingRight: 12 },
  totals: { width: '44%' },
  termLine: { flexDirection: 'row', paddingVertical: 2 },
  termK: { width: 72, color: '#666' },
  totalLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, paddingHorizontal: 6, borderBottomWidth: 0.5, borderColor: '#ccc' },
  grand: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, paddingHorizontal: 6, backgroundColor: '#eef1f5', fontFamily: 'Helvetica-Bold', fontSize: 9.5 },
  note: { marginTop: 16, fontSize: 7.5, color: '#555' },
  signRow: { flexDirection: 'row', marginTop: 34, justifyContent: 'space-between' },
  signBox: { width: '42%', borderTopWidth: 0.75, borderColor: '#333', paddingTop: 4, textAlign: 'center', fontSize: 7.5 },
  footer: { position: 'absolute', bottom: 20, left: 34, right: 34, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: '#888' },
});

const money = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function fmtDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d) ? String(v) : d.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });
}

function Kv({ k, v }) {
  return <View style={s.kv}><Text style={s.k}>{k}</Text><Text style={s.v}>{v || '—'}</Text></View>;
}

function SosDoc({ sos, prices }) {
  const c = sos.customer || {};
  const co = companyProfile(sos.company);
  const addr = [c.address, c.address2, c.address3, [c.city, c.pin_code].filter(Boolean).join(' - '), c.state].filter(Boolean).join(', ');
  const W = prices ? { sl: 6, desc: 56, qty: 10, rate: 12, amt: 16 } : { sl: 6, desc: 84, qty: 10 };
  const cols = prices
    ? [['SL', W.sl], ['Description', W.desc], ['Qty', W.qty], ['Rate', W.rate], ['Amount', W.amt]]
    : [['SL', W.sl], ['Description', W.desc], ['Qty', W.qty]];
  return (
    <Document title={sos.title}>
      <Page size="A4" style={[s.page, { paddingBottom: footerPad(co, 'sos', 32, 46) }]}>
        <DocIdentity profile={co} doc="sos" nameStyle={s.company} subStyle={s.sub} />
        <View style={s.rule} />
        <Text style={[s.title, docTitleStyle(co, 'sos')]}>ORDER ACKNOWLEDGEMENT</Text>
        <Text style={s.subtitle}>Project Technical Details &amp; Scope of Supply</Text>

        <View style={s.box}>
          <View style={s.boxLeft}>
            <Text style={s.boxLabel}>CLIENT DETAILS</Text>
            <Text style={s.clientName}>{c.name || sos.customer_name || '—'}</Text>
            {addr ? <Text>{addr}</Text> : null}
            {c.phone ? <Text style={{ marginTop: 3 }}>Tel: {c.phone}</Text> : null}
            {c.email ? <Text>Email: {c.email}</Text> : null}
            {c.gst_no ? <Text>GSTIN: {c.gst_no}</Text> : null}
          </View>
          <View style={s.boxRight}>
            <Kv k="Date" v={fmtDate(sos.created_at)} />
            <Kv k="Job No" v={sos.jobNo} />
            <Kv k="Order No" v={sos.soNo} />
            <Kv k="Offer" v={sos.offerNo} />
            <Kv k="Offer Date" v={fmtDate(sos.offerDate)} />
            <Kv k="PO No" v={sos.po_no} />
            <Kv k="PO Date" v={fmtDate(sos.po_date)} />
          </View>
        </View>

        <View style={s.tHead} fixed>
          {cols.map(([label, w], i) => (
            <Text key={i} style={[s.hCell, { width: `${w}%`, textAlign: i >= 2 ? 'right' : 'left' }]}>{label}</Text>
          ))}
        </View>
        {sos.items.map((it, i) => {
          const l = sosLine(it);
          const qty = [it.qty, it.uom].filter(v => v != null && v !== '').join(' ');
          return (
            <View key={it.id} style={s.tRow} wrap={false}>
              <Text style={[s.cell, { width: `${W.sl}%` }]}>{i + 1}</Text>
              <View style={[s.cell, { width: `${W.desc}%` }]}>
                <Text style={s.pName}>{l.name}</Text>
                {(l.type || l.hsn) ? <Text style={s.pType}>{[l.type, l.hsn && `HSN ${l.hsn}`].filter(Boolean).join('  ·  ').toUpperCase()}</Text> : null}
                {l.body ? <Text style={s.pBody}>{l.body}</Text> : null}
                {l.exclusions ? <Text style={s.pExcl}><Text style={{ fontFamily: 'Helvetica-Bold' }}>Exclusions: </Text>{l.exclusions}</Text> : null}
              </View>
              <Text style={[s.cell, { width: `${W.qty}%`, textAlign: 'right' }]}>{qty || '—'}</Text>
              {prices && <Text style={[s.cell, { width: `${W.rate}%`, textAlign: 'right' }]}>{it.unit_price != null ? money(it.unit_price) : '—'}</Text>}
              {prices && <Text style={[s.cell, { width: `${W.amt}%`, textAlign: 'right' }]}>{money(it.amount)}</Text>}
            </View>
          );
        })}

        {prices ? (
          <View style={s.bottom} wrap={false}>
            <View style={s.terms}>
              <View style={s.termLine}><Text style={s.termK}>Payment</Text><Text style={{ flex: 1 }}>{sos.payment_terms || '—'}</Text></View>
              <View style={s.termLine}><Text style={s.termK}>Freight</Text><Text style={{ flex: 1 }}>{sos.freight_terms || '—'}</Text></View>
              <View style={s.termLine}><Text style={s.termK}>Delivery</Text><Text style={{ flex: 1 }}>{sos.delivery_terms || '—'}</Text></View>
              <View style={s.termLine}><Text style={s.termK}>Prepared By</Text><Text style={{ flex: 1 }}>{sos.prepared_by || '—'}</Text></View>
            </View>
            <View style={s.totals}>
              <View style={s.totalLine}><Text>Total</Text><Text>{money(sos.basicTotal)}</Text></View>
              <View style={s.totalLine}><Text>Add: IGST / GST @ {sos.tax_pct}%</Text><Text>{money(sos.taxAmount)}</Text></View>
              <View style={s.grand}><Text>TOTAL VALUE</Text><Text>{money(sos.grandTotal)}</Text></View>
            </View>
          </View>
        ) : (
          <View style={{ marginTop: 10 }}><Text style={s.termK}>Prepared By: {sos.prepared_by || '—'}</Text></View>
        )}

        <Text style={s.note}>
          Note: Please acknowledge the SB copy as a token of acceptance if found in order, within one week — if not received, it would be deemed to be accepted by you.
        </Text>
        <View style={s.signRow} wrap={false}>
          <Text style={s.signBox}>ACCEPTED{'\n'}(Customer signature &amp; seal)</Text>
          <Text style={s.signBox}>For {co.name}{'\n'}Authorized Signatory</Text>
        </View>

        <DocFooterNote profile={co} doc="sos" bottom={32} side={34} />
        <View style={s.footer} fixed>
          <Text>{sos.jobNo || ''} · Scope of Supply</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderSosPdf(sos, { prices = true } = {}) {
  return renderToBuffer(<SosDoc sos={sos} prices={prices} />);
}
