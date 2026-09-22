// lib/sale-order-pdf.js — PO/Sale-Order wizard's own confirmation document (Phase 2.7),
// deliberately a genuinely separate document from lib/sos-pdf.js (the real, existing, project-
// scoped Scope of Supply PDF — a different feature this plan doesn't touch). Modeled visually on
// sos-pdf's own layout (client block, priced line table, terms, totals, signature block) but
// company-aware from the start via companyProfile(), same 2-line pattern as lib/po-pdf.js.
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
  metaLabel: { color: '#666', width: 90 },
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
  note: { marginTop: 14, fontSize: 7, color: '#555' },
  signRow: { flexDirection: 'row', marginTop: 26, justifyContent: 'space-between' },
  signBox: { width: '45%', borderTopWidth: 1, borderColor: '#333', paddingTop: 4, textAlign: 'center', fontSize: 7 },
});

const COLS = [['SL', 5], ['Description', 38], ['Qty', 10], ['Rate', 14], ['Tax %', 8], ['Amount', 15]];

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
  const vals = [i + 1, it.item_description, [it.qty, it.uom].filter(Boolean).join(' ') || '—',
    it.rate != null ? fmt(it.rate) : '—', it.item_tax_pct ? `${it.item_tax_pct}%` : '—', fmt(it.amount)];
  return (
    <View style={s.tRow} wrap={false}>
      {COLS.map(([, w], j) => (
        <Text key={j} style={[s.cell, { width: `${w}%` }]}>{vals[j] ?? '—'}</Text>
      ))}
    </View>
  );
}

function SaleOrderDoc({ so }) {
  const profile = companyProfile(so.company);
  const igstOnly = (so.igst_amount || 0) > 0;
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.center}>
          <Text style={s.company}>{profile.name}</Text>
          <Text style={s.sub}>{profile.sub}</Text>
          <Text style={s.title}>SALES ORDER{'\n'}{so.create_as || 'PO'}</Text>
        </View>

        <View style={s.metaRow}>
          <View style={s.metaCol}>
            <Text style={{ fontWeight: 'bold', marginBottom: 3 }}>CUSTOMER</Text>
            <Text style={{ fontWeight: 'bold' }}>{so.customer_name || '—'}</Text>
            {so.address_type === 'Other' && so.order_address && <Text>{so.order_address}</Text>}
            {so.contact_person && <Text>Contact: {so.contact_person}{so.contact_mobile ? ` (${so.contact_mobile})` : ''}</Text>}
          </View>
          <View style={s.metaCol}>
            <Meta label="Order ID" value={so.so_no} />
            <Meta label="Order Date" value={fmtDate(so.order_date)} />
            <Meta label="Branch" value={so.branch_name} />
            <Meta label="Br Order Control No" value={so.br_order_control_no} />
            <Meta label="Expected Delivery" value={fmtDate(so.expected_delivery_date)} />
          </View>
        </View>

        <View style={s.tHead}>
          {COLS.map(([label, w], i) => (
            <Text key={i} style={[s.cell, { width: `${w}%`, fontWeight: 'bold' }]}>{label}</Text>
          ))}
        </View>
        {(so.items || []).map((it, i) => <Row key={it.id} it={it} i={i} />)}

        <View style={s.termsRow}>
          <View style={s.termsCol}>
            <View style={s.termLine}><Text style={s.termLabel}>Payment Mode:-</Text><Text>{so.expected_payment_mode || '—'}</Text></View>
            <View style={s.termLine}><Text style={s.termLabel}>Advance:-</Text><Text>{so.advance_with_order != null ? fmt(so.advance_with_order) : '—'}</Text></View>
            <View style={s.termLine}><Text style={s.termLabel}>Dispatch:-</Text><Text>{so.dispatch_comment || '—'}</Text></View>
            <View style={s.termLine}><Text style={s.termLabel}>Installation:-</Text><Text>{so.installation_comment || '—'}</Text></View>
          </View>
          <View style={s.totalsCol}>
            <View style={s.totalLine}><Text>Sub Total</Text><Text>{fmt(so.subtotal)}</Text></View>
            {(so.discount_amount || 0) > 0 && <View style={s.totalLine}><Text>Discount ({so.discount_pct || 0}%)</Text><Text>-{fmt(so.discount_amount)}</Text></View>}
            {igstOnly
              ? <View style={s.totalLine}><Text>IGST</Text><Text>{fmt(so.igst_amount)}</Text></View>
              : (
                <>
                  <View style={s.totalLine}><Text>CGST</Text><Text>{fmt(so.cgst_amount)}</Text></View>
                  <View style={s.totalLine}><Text>SGST</Text><Text>{fmt(so.sgst_amount)}</Text></View>
                </>
              )}
            {(so.packing_forwarding_amount || 0) > 0 && <View style={s.totalLine}><Text>Pkg &amp; Fwd</Text><Text>{fmt(so.packing_forwarding_amount)}</Text></View>}
            {(so.insurance_amount || 0) > 0 && <View style={s.totalLine}><Text>Insurance</Text><Text>{fmt(so.insurance_amount)}</Text></View>}
            {(so.freight_amount || 0) > 0 && <View style={s.totalLine}><Text>Freight</Text><Text>{fmt(so.freight_amount)}</Text></View>}
            {(so.other_charges_amount || 0) > 0 && <View style={s.totalLine}><Text>Other Charges</Text><Text>{fmt(so.other_charges_amount)}</Text></View>}
            <View style={s.grandTotal}><Text>GRAND TOTAL</Text><Text>{fmt(so.total)}</Text></View>
          </View>
        </View>

        <Text style={s.note}>
          This order confirmation is generated from the details entered above — please review and confirm within one week of receipt.
        </Text>

        <View style={s.signRow}>
          <Text style={s.signBox}>ACCEPTED</Text>
          <Text style={s.signBox}>For {profile.name}{'\n'}Authorized Signatory</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderSaleOrderPdf(so) {
  return renderToBuffer(<SaleOrderDoc so={so} />);
}
