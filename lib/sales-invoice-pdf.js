// lib/sales-invoice-pdf.js — REPORT-ENGINE-PLAN.md §7 Sales/CRM ("Sales Invoice — new"). Per-record
// PDF like lib/po-pdf.js (same shape: party block, item table with HSN/GST, totals, sign-off),
// built on the shared lib/report-pdf.js frame from day one since this is a new document, not a
// migration.
import React from 'react';
import { View, Text, renderToBuffer } from '@react-pdf/renderer';
import { ReportDocument, ReportTable, tokens, fmt, fmtDate } from './report-pdf.js';

const ITEM_COLS = [
  ['S.No', 6, (it, i) => i + 1],
  ['Description', 32, (it) => it.item_description],
  ['HSN', 10, (it) => it.hsn_code || '—'],
  ['Qty', 8, (it) => it.qty],
  ['UoM', 8, (it) => it.uom || '—'],
  ['Rate', 12, (it) => fmt(it.rate)],
  ['GST%', 8, (it) => it.gst_rate_pct],
  ['Amount', 16, (it) => fmt(it.amount)],
];

function InvoiceDoc({ invoice, items }) {
  return (
    <ReportDocument company={invoice.company} title="TAX INVOICE" subtitle={invoice.invoice_no}>
      <View style={{ flexDirection: 'row', marginBottom: 10 }}>
        <View style={{ width: '50%' }}>
          <Text style={{ fontWeight: 'bold', marginBottom: 3 }}>Bill To: {invoice.customer_name}</Text>
          <Text style={{ color: '#666' }}>{invoice.customer_address || '—'}</Text>
          <Text style={{ color: '#666' }}>GSTIN: {invoice.customer_gst_no || '—'}</Text>
        </View>
        <View style={{ width: '50%' }}>
          <Text>Invoice No: {invoice.invoice_no}</Text>
          <Text>Invoice Date: {fmtDate(invoice.invoice_date)}</Text>
          <Text>Due Date: {fmtDate(invoice.due_date) || '—'}</Text>
        </View>
      </View>

      <ReportTable cols={ITEM_COLS} rows={items} />

      <View style={{ marginTop: 8, alignItems: 'flex-end' }}>
        <View style={{ width: '40%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}><Text>Subtotal</Text><Text>{fmt(invoice.subtotal)}</Text></View>
          {invoice.cgst_amount > 0 && <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}><Text>CGST</Text><Text>{fmt(invoice.cgst_amount)}</Text></View>}
          {invoice.sgst_amount > 0 && <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}><Text>SGST</Text><Text>{fmt(invoice.sgst_amount)}</Text></View>}
          {invoice.igst_amount > 0 && <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}><Text>IGST</Text><Text>{fmt(invoice.igst_amount)}</Text></View>}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderTop: 1, borderColor: '#333', fontWeight: 'bold' }}><Text>Total</Text><Text>{fmt(invoice.total)}</Text></View>
        </View>
      </View>

      <View style={{ flexDirection: 'row', marginTop: 26, justifyContent: 'flex-end' }}>
        <Text style={tokens.signBox}>For {invoice.company}.{'\n'}Authorized Signatory</Text>
      </View>
    </ReportDocument>
  );
}

export async function renderSalesInvoicePdf(invoice, items) {
  return renderToBuffer(<InvoiceDoc invoice={invoice} items={items} />);
}
