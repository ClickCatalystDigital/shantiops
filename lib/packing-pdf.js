// Real generated packing-list PDF (redesign §8) — matches the SB-IBR-1018 sample layout:
// company header, buyer/invoice/DC block, item table, 7-day declaration, sign-off row.
// Uses @react-pdf/renderer (pure Node, no headless browser). renderToBuffer streams a real file.
//
// Opportunistically migrated onto lib/report-pdf.js's shared tokens/footer — but keeps its own
// header (the Stores contact line replaces the standard GST/phone sub on every other document,
// intentionally, so recipients have a discrepancy-reporting contact) rather than ReportPage's
// uniform header, which would silently drop that. See REPORT-ENGINE-PLAN: uniform chrome, never a
// uniform document — this is exactly the "legitimately different" case that rule carves out.
import React from 'react';
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { tokens, ReportFooter } from './report-pdf.js';

const s = StyleSheet.create({
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 },
  metaCell: { width: '50%', paddingVertical: 2, flexDirection: 'row' },
  metaLabel: { color: '#666', width: 80 },
  metaVal: { fontWeight: 'bold', flex: 1 },
  section: { fontWeight: 'bold', backgroundColor: '#f4f4f4', paddingVertical: 3, paddingHorizontal: 3, borderBottom: 1, borderColor: '#ddd' },
  decl: { marginTop: 14, fontSize: 7, lineHeight: 1.4 },
  signRow: { flexDirection: 'row', marginTop: 26, justifyContent: 'space-between' },
  // Not tokens.signBox (45%, sized for 2-box rows like PO/payslip) — this row has 4 boxes.
  signBox: { width: '22%', borderTop: 1, borderColor: '#333', paddingTop: 4, textAlign: 'center', fontSize: 7 },
});

// Column widths (sum ≈ 100).
const COLS = [
  ['#', 4], ['Description', 26], ['MOC', 8], ['Size / Spec', 22],
  ['IBR No', 10], ['Item Code', 12], ['Box', 8], ['Qty', 6], ['Make', 8],
];

function Meta({ label, value }) {
  return (
    <View style={s.metaCell}>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={s.metaVal}>{value || '—'}</Text>
    </View>
  );
}

function Row({ it }) {
  const vals = [it.s_no, it.material_description, it.moc, it.size_spec, it.ibr_no, it.item_code, it.box_no, `${it.qty} ${it.unit || ''}`.trim(), it.make];
  return (
    <View style={tokens.tRow} wrap={false}>
      {COLS.map(([, w], i) => (
        <Text key={i} style={[tokens.cell, { width: `${w}%` }]}>{vals[i] ?? '—'}</Text>
      ))}
    </View>
  );
}

// Group items by their free-text section (Boiler / Chimney / Ducting), if any (§8).
function grouped(items) {
  const groups = {};
  for (const it of items) (groups[it.section || ''] ||= []).push(it);
  return groups;
}

function PackingDoc({ list, items, title = 'MASTER PACKING LIST' }) {
  const groups = grouped(items);
  const sections = Object.keys(groups);
  const single = sections.length === 1 && sections[0] === '';

  return (
    <Document>
      <Page size="A4" style={tokens.page}>
        <View style={tokens.center}>
          <Text style={tokens.company}>SHANTI BOILERS &amp; PRESSURE VESSELS PVT LTD</Text>
          <Text style={tokens.sub}>P-10-10, I.D.A, Nacharam, Hyderabad - 500 056 · Stores@shantiboilers.com</Text>
          <Text style={tokens.title}>{title}</Text>
        </View>

        <View style={s.metaRow}>
          <Meta label="Buyer" value={list.customer_name} />
          <Meta label="Packing No" value={list.packing_no} />
          <Meta label="Address" value={list.customer_address} />
          <Meta label="Package Type" value={list.package_type} />
          <Meta label="Invoice No" value={list.invoice_no} />
          <Meta label="Invoice Date" value={list.invoice_date} />
          <Meta label="D.C. No" value={list.dc_no} />
          <Meta label="D.C. Date" value={list.dc_date} />
          <Meta label="Dispatch Through" value={list.dispatch_through} />
          <Meta label="Vehicle No" value={list.vehicle_no} />
        </View>

        <View style={tokens.tHead} fixed>
          {COLS.map(([label, w], i) => (
            <Text key={i} style={[tokens.cell, { width: `${w}%`, fontWeight: 'bold' }]}>{label}</Text>
          ))}
        </View>
        {single
          ? groups[''].map(it => <Row key={it.id} it={it} />)
          : sections.map(sec => (
              <View key={sec || 'ungrouped'}>
                <Text style={s.section}>{sec || 'Other'}</Text>
                {groups[sec].map(it => <Row key={it.id} it={it} />)}
              </View>
            ))}

        <Text style={s.decl}>
          Declaration: Dear Sir, kindly check all the above materials as per the packing list,
          item-wise, and confirm within 7 days if there are any discrepancies or missing items
          mentioned in the packing list but not received at your end.
        </Text>

        <View style={s.signRow}>
          {['Stores', 'Production', 'QC', 'Management'].map(r => (
            <Text key={r} style={s.signBox}>{r}</Text>
          ))}
        </View>

        <ReportFooter />
      </Page>
    </Document>
  );
}

export async function renderPackingPdf(list, items) {
  return renderToBuffer(<PackingDoc list={list} items={items} />);
}

// Pending-list PDF — the still-unpacked BOM lines for a project (§8).
export async function renderPendingPdf(project, pending) {
  const items = pending.map((b, i) => ({
    id: b.id, s_no: i + 1, material_description: b.material_description,
    moc: b.moc, size_spec: b.size_spec, qty: '', unit: '',
  }));
  const list = { customer_name: project.customer_name, packing_no: `PENDING / ${project.project_no}` };
  return renderToBuffer(<PackingDoc list={list} items={items} title="PENDING PACKING LIST" />);
}
