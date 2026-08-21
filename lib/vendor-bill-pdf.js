// lib/vendor-bill-pdf.js — REPORT-ENGINE-PLAN.md §7 Procurement ("Vendor Bill — new"). Mirror of
// lib/sales-invoice-pdf.js against vendor_bills/vendor_bill_items, plus the TDS line sales invoices
// don't have.
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

function BillDoc({ bill, items }) {
  return (
    <ReportDocument company={bill.company} title="VENDOR BILL" subtitle={`${bill.bill_no} · PO ${bill.po_no}`}>
      <View style={{ flexDirection: 'row', marginBottom: 10 }}>
        <View style={{ width: '50%' }}>
          <Text style={{ fontWeight: 'bold', marginBottom: 3 }}>Supplier: {bill.supplier_name}</Text>
          <Text style={{ color: '#666' }}>{bill.supplier_address || '—'}</Text>
          <Text style={{ color: '#666' }}>GSTIN: {bill.supplier_gst_no || '—'}</Text>
        </View>
        <View style={{ width: '50%' }}>
          <Text>Bill No: {bill.bill_no}</Text>
          <Text>Bill Date: {fmtDate(bill.bill_date)}</Text>
          <Text>Due Date: {fmtDate(bill.due_date) || '—'}</Text>
        </View>
      </View>

      <ReportTable cols={ITEM_COLS} rows={items} />

      <View style={{ marginTop: 8, alignItems: 'flex-end' }}>
        <View style={{ width: '40%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}><Text>Subtotal</Text><Text>{fmt(bill.subtotal)}</Text></View>
          {bill.cgst_amount > 0 && <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}><Text>CGST</Text><Text>{fmt(bill.cgst_amount)}</Text></View>}
          {bill.sgst_amount > 0 && <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}><Text>SGST</Text><Text>{fmt(bill.sgst_amount)}</Text></View>}
          {bill.igst_amount > 0 && <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}><Text>IGST</Text><Text>{fmt(bill.igst_amount)}</Text></View>}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}><Text>Total</Text><Text>{fmt(bill.total)}</Text></View>
          {bill.tds_amount > 0 && <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}><Text>TDS ({bill.tds_section})</Text><Text>-{fmt(bill.tds_amount)}</Text></View>}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderTop: 1, borderColor: '#333', fontWeight: 'bold' }}><Text>Payable</Text><Text>{fmt(bill.payable_amount)}</Text></View>
        </View>
      </View>

      <View style={{ flexDirection: 'row', marginTop: 26, justifyContent: 'flex-end' }}>
        <Text style={tokens.signBox}>For {bill.company}.{'\n'}Accounts Dept // Authorized Signatory</Text>
      </View>
    </ReportDocument>
  );
}

export async function renderVendorBillPdf(bill, items) {
  return renderToBuffer(<BillDoc bill={bill} items={items} />);
}
