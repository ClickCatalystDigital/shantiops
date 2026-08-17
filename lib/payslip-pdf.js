// lib/payslip-pdf.js — HR completion bundle. Salary slip PDF, modeled directly on
// lib/quotation-pdf.js/lib/po-pdf.js (same @react-pdf/renderer approach, same header/meta/table/
// totals shape). Every figure here is echoed from the already-computed salary_slips row/
// salary_slip_components — no arithmetic happens in this file (same "compute once, render the
// stored number" precedent quotation-pdf.js sets), consistent with the HARD BOUNDARY: this is a
// document render, never a ledger entry.
import React from 'react';
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { companyProfile } from './qc-doc-pdf.js';

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
  tHead: { flexDirection: 'row', backgroundColor: '#eee', borderTop: 1, borderBottom: 1, borderColor: '#999' },
  tRow: { flexDirection: 'row', borderBottom: 1, borderColor: '#ddd', minHeight: 14 },
  cell: { paddingVertical: 3, paddingHorizontal: 3, borderRight: 1, borderColor: '#ddd' },
  totalsCol: { width: '100%', marginTop: 4 },
  totalLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2, paddingHorizontal: 4 },
  grandTotal: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, paddingHorizontal: 4, borderTop: 1, borderColor: '#333', fontWeight: 'bold' },
  signRow: { flexDirection: 'row', marginTop: 26, justifyContent: 'space-between' },
  signBox: { width: '45%', borderTop: 1, borderColor: '#333', paddingTop: 4, textAlign: 'center', fontSize: 7 },
});

const COLS = [['S.No', 8], ['Component', 52], ['Type', 20], ['Amount', 20]];

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

function periodLabel(month, year) {
  const names = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${names[month]} ${year}`;
}

function Row({ it, i }) {
  const vals = [i + 1, it.name, it.component_type === 'earning' ? 'Earning' : 'Deduction', fmt(it.amount)];
  return (
    <View style={s.tRow} wrap={false}>
      {COLS.map(([, w], j) => (
        <Text key={j} style={[s.cell, { width: `${w}%` }]}>{vals[j] ?? '—'}</Text>
      ))}
    </View>
  );
}

function PayslipDoc({ slip, components }) {
  const earnings = components.filter(c => c.component_type === 'earning');
  const deductions = components.filter(c => c.component_type === 'deduction');
  const profile = companyProfile(slip.company);
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.center}>
          <Text style={s.company}>{profile.name}</Text>
          <Text style={s.sub}>{profile.sub}</Text>
          <Text style={s.title}>{slip.slip_type === 'final' ? 'FULL & FINAL SETTLEMENT' : 'PAYSLIP'} — {periodLabel(slip.period_month, slip.period_year)}</Text>
        </View>

        <View style={s.metaRow}>
          <View style={s.metaCol}>
            <Meta label="Employee" value={`${slip.employee_code} — ${slip.employee_name}`} />
            <Meta label="Payment Days" value={slip.payment_days != null ? `${slip.payment_days} / ${slip.working_days}` : null} />
          </View>
          <View style={s.metaCol}>
            <Meta label="Financial Year" value={slip.financial_year} />
            <Meta label="Bank" value={slip.bank_name ? `${slip.bank_name} · ${slip.bank_account_no || '—'} · ${slip.bank_ifsc || '—'}` : null} />
          </View>
        </View>

        <View style={s.tHead}>
          {COLS.map(([label, w], i) => (
            <Text key={i} style={[s.cell, { width: `${w}%`, fontWeight: 'bold' }]}>{label}</Text>
          ))}
        </View>
        {[...earnings, ...deductions].map((it, i) => <Row key={it.id ?? i} it={it} i={i} />)}

        <View style={s.totalsCol}>
          <View style={s.totalLine}><Text>Gross Earnings</Text><Text>{fmt(slip.gross_earnings)}</Text></View>
          <View style={s.totalLine}><Text>Total Deductions</Text><Text>{fmt(slip.total_deductions)}</Text></View>
          <View style={s.grandTotal}><Text>NET PAY</Text><Text>{fmt(slip.net_pay)}</Text></View>
        </View>

        <View style={s.signRow}>
          <Text style={s.signBox}>EMPLOYEE</Text>
          <Text style={s.signBox}>For {profile.name}.{'\n'}HR Dept // Authorized Signatory</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderPayslipPdf(slip, components) {
  return renderToBuffer(<PayslipDoc slip={slip} components={components} />);
}
