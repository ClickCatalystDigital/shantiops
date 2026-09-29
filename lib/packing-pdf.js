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
import { companyProfile } from './company-profiles.js';
import { groupForms, boxGroups } from './packing-forms.mjs';

const s = StyleSheet.create({
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 },
  metaCell: { width: '50%', paddingVertical: 2, flexDirection: 'row' },
  metaLabel: { color: '#666', width: 80 },
  metaVal: { fontWeight: 'bold', flex: 1 },
  boxRow: { fontWeight: 'bold', textAlign: 'center', paddingVertical: 3, borderBottomWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#999', backgroundColor: '#f4f4f4' },
  section: { fontWeight: 'bold', backgroundColor: '#f4f4f4', paddingVertical: 3, paddingHorizontal: 3, borderBottomWidth: 1, borderColor: '#ddd' },
  decl: { marginTop: 14, fontSize: 7, lineHeight: 1.4 },
  signRow: { flexDirection: 'row', marginTop: 26, justifyContent: 'space-between' },
  // Not tokens.signBox (45%, sized for 2-box rows like PO/payslip) — this row has 4 boxes.
  signBox: { width: '22%', borderTopWidth: 1, borderColor: '#333', paddingTop: 4, textAlign: 'center', fontSize: 7 },
});

// Column widths (sum ≈ 100) — the client's sheet: S.No, Material, MOC, Size/Spec, IBR No, Qty, Make, Item Code.
const COLS = [
  ['S.No', 5], ['Material Description', 30], ['MOC', 9], ['Size / Specification', 25],
  ['IBR No', 9], ['Qty', 8], ['Make', 8], ['Item Code', 6],
];

function Meta({ label, value }) {
  return (
    <View style={s.metaCell}>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={s.metaVal}>{value || ''}</Text>
    </View>
  );
}

function Row({ it }) {
  const vals = [it.s_no, it.material_description, it.moc, it.size_spec, it.ibr_no, `${it.qty} ${it.unit || ''}`.trim(), it.make, it.item_code];
  return (
    <View style={tokens.tRow} wrap={false}>
      {COLS.map(([, w], i) => (
        <Text key={i} style={[tokens.cell, { width: `${w}%` }]}>{vals[i] ?? ''}</Text>
      ))}
    </View>
  );
}

function Form({ list, form, checklist, single }) {
  const prof = companyProfile(list.company);
  const title = form.kind === 'master' ? 'MASTER PACKING LIST' : 'ANNEXURE TO DELIVERY CHALLAN/PACKING LIST';
  return (
    <Page size="A4" orientation="landscape" style={tokens.page}>
      <View style={tokens.center}>
        <Text style={tokens.company}>{prof.name}</Text>
        <Text style={tokens.title}>{title}</Text>
        <Text style={tokens.sub}>{prof.sub.split(' · GST')[0]}{list.company === 'Shanti Boilers' || !list.company ? ' · Stores@shantiboilers.com' : ''}</Text>
      </View>

      <View style={s.metaRow}>
        <Meta label="Buyer" value={list.customer_name} />
        <Meta label="Invoice No" value={list.invoice_no} />
        <Meta label="Address" value={list.customer_address} />
        <Meta label="Date" value={list.invoice_date} />
        <Meta label="Contact Person No" value={list.contact_person} />
        <Meta label="Dispatch Through" value={list.dispatch_through} />
        <Meta label="Packing No" value={list.packing_no} />
        <Meta label="Vehicle No" value={list.vehicle_no} />
        <Meta label="" value="" />
        <Meta label="D.C. No / Date" value={[list.dc_no, list.dc_date].filter(Boolean).join(' / ')} />
      </View>

      {!single && <Text style={s.section}>{form.name}</Text>}
      <View style={tokens.tHead} fixed>
        {COLS.map(([label, w], i) => (
          <Text key={i} style={[tokens.cell, { width: `${w}%`, fontWeight: 'bold' }]}>{label}</Text>
        ))}
      </View>
      {boxGroups(form.items).map((g, gi) => (
        <View key={gi}>
          {g.box ? <Text style={s.boxRow}>{g.box}</Text> : null}
          {g.items.map(it => <Row key={it.id} it={it} />)}
        </View>
      ))}

      {form.kind === 'master' && checklist?.length > 0 && (
        <View wrap={false}>
          <Text style={s.section}>Checklist</Text>
          {checklist.map((c, i) => (
            <View key={c.id} style={tokens.tRow}>
              <Text style={[tokens.cell, { width: '5%' }]}>{i + 1}</Text>
              <Text style={[tokens.cell, { width: '65%' }]}>{c.description}</Text>
              <Text style={[tokens.cell, { width: '10%' }]}>{c.prod_ok ? 'Prod [x]' : 'Prod [ ]'}</Text>
              <Text style={[tokens.cell, { width: '10%' }]}>{c.qc_ok ? 'QC [x]' : 'QC [ ]'}</Text>
              <Text style={[tokens.cell, { width: '10%' }]}>{c.stores_ok ? 'Stores [x]' : 'Stores [ ]'}</Text>
            </View>
          ))}
        </View>
      )}

      {form.kind === 'master' && (
        <Text style={s.decl}>
          Declaration: Dear Sir, kindly check all the above materials as per the packing list,
          item-wise, and confirm within 7 days if there are any discrepancies or missing items
          mentioned in the packing list but not received at your end.
        </Text>
      )}

      <View style={s.signRow} wrap={false}>
        {['Stores', 'Prod.', 'QC', 'Management'].map(r => (
          <Text key={r} style={s.signBox}>{r}</Text>
        ))}
      </View>
      <ReportFooter />
    </Page>
  );
}

function PackingDoc({ list, items, checklist, only }) {
  let forms = groupForms(items, list.master_section);
  if (only != null) forms = forms.filter(f => f.name === only);
  if (!forms.length) forms = [{ name: 'Other', kind: 'master', items: [] }];
  const single = forms.length === 1 && forms[0].name === 'Other';
  return (
    <Document>
      {forms.map(f => <Form key={f.name} list={list} form={f} checklist={checklist} single={single} />)}
    </Document>
  );
}

// only = a section name to print just that form; omitted = every form in filed order.
export async function renderPackingPdf(list, items, { checklist = [], only = null } = {}) {
  return renderToBuffer(<PackingDoc list={list} items={items} checklist={checklist} only={only} />);
}

// Pending-list PDF — the still-unpacked BOM lines for a project (§8).
export async function renderPendingPdf(project, pending) {
  const items = pending.map((b, i) => ({
    id: b.id, s_no: i + 1, material_description: b.material_description,
    moc: b.moc, size_spec: b.size_spec, qty: '', unit: '',
  }));
  const list = { customer_name: project.customer_name, packing_no: `PENDING / ${project.project_no}`, company: project.company };
  return renderToBuffer(<PackingDoc list={list} items={items} checklist={[]} only={null} />);
}
