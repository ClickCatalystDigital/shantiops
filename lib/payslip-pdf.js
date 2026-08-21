// lib/payslip-pdf.js — HR completion bundle. Salary slip PDF, modeled directly on
// lib/quotation-pdf.js/lib/po-pdf.js (same @react-pdf/renderer approach, same header/meta/table/
// totals shape). Every figure here is echoed from the already-computed salary_slips row/
// salary_slip_components — no arithmetic happens in this file (same "compute once, render the
// stored number" precedent quotation-pdf.js sets), consistent with the HARD BOUNDARY: this is a
// document render, never a ledger entry.
//
// Migrated onto lib/report-pdf.js's shared frame (ReportDocument already used companyProfile
// exactly this way, so the header is byte-for-byte unchanged; ReportTable adds the repeating header
// this doc never needed before since it never spanned pages).
import React from 'react';
import { View, Text, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { ReportDocument, ReportTable, tokens, fmt } from './report-pdf.js';
import { companyProfile } from './company-profiles.js';

const s = StyleSheet.create({
  metaRow: { flexDirection: 'row', marginBottom: 10 },
  metaCol: { width: '50%' },
  metaLine: { flexDirection: 'row', paddingVertical: 1 },
  metaLabel: { color: '#666', width: 90 },
  metaVal: { fontWeight: 'bold', flex: 1 },
  totalsCol: { width: '100%', marginTop: 4 },
  totalLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2, paddingHorizontal: 4 },
  grandTotal: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, paddingHorizontal: 4, borderTop: 1, borderColor: '#333', fontWeight: 'bold' },
  signRow: { flexDirection: 'row', marginTop: 26, justifyContent: 'space-between' },
});

const COLS = [
  ['S.No', 8, (it, i) => i + 1],
  ['Component', 52, (it) => it.name],
  ['Type', 20, (it) => it.component_type === 'earning' ? 'Earning' : 'Deduction'],
  ['Amount', 20, (it) => fmt(it.amount)],
];

function Meta({ label, value }) {
  return (
    <View style={s.metaLine}>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={s.metaVal}>{value || '—'}</Text>
    </View>
  );
}

function periodLabel(month, year) {
  const names = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${names[month]} ${year}`;
}

function PayslipDoc({ slip, components }) {
  const earnings = components.filter(c => c.component_type === 'earning');
  const deductions = components.filter(c => c.component_type === 'deduction');
  const rows = [...earnings, ...deductions].map((it, i) => ({ ...it, id: it.id ?? i }));
  const title = `${slip.slip_type === 'final' ? 'FULL & FINAL SETTLEMENT' : 'PAYSLIP'} — ${periodLabel(slip.period_month, slip.period_year)}`;
  const profile = companyProfile(slip.company);

  return (
    <ReportDocument company={slip.company} title={title}>
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

      <ReportTable cols={COLS} rows={rows} />

      <View style={s.totalsCol}>
        <View style={s.totalLine}><Text>Gross Earnings</Text><Text>{fmt(slip.gross_earnings)}</Text></View>
        <View style={s.totalLine}><Text>Total Deductions</Text><Text>{fmt(slip.total_deductions)}</Text></View>
        <View style={s.grandTotal}><Text>NET PAY</Text><Text>{fmt(slip.net_pay)}</Text></View>
      </View>

      <View style={s.signRow}>
        <Text style={tokens.signBox}>EMPLOYEE</Text>
        <Text style={tokens.signBox}>For {profile.name}.{'\n'}HR Dept // Authorized Signatory</Text>
      </View>
    </ReportDocument>
  );
}

export async function renderPayslipPdf(slip, components) {
  return renderToBuffer(<PayslipDoc slip={slip} components={components} />);
}
