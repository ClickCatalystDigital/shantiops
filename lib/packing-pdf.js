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
import { groupForms, boxGroups, PACK_TYPE_LABEL } from './packing-forms.mjs';

// "PL-1062 (List 2 for SB-1060)" when the project has more than one list. Never "of M": a printed
// paper must not go stale once another list is made.
function packingNoLabel(list) {
  return list.projectListCount > 1 && list.project_no ? `${list.packing_no} (List ${list.projectListNo} for ${list.project_no})` : list.packing_no;
}

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
        <Meta label="Packing No" value={packingNoLabel(list)} />
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


// ── Combined layout (one portrait page flow, continuous S.No, sections, packing groups) ──────────────
const C = StyleSheet.create({
  box: { borderWidth: 1, borderColor: '#333' },
  hRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#333' },
  hCell: { padding: 3, flexDirection: 'row' },
  lab: { fontWeight: 'bold', marginRight: 3 },
  secRow: { backgroundColor: '#e8e8e8', fontWeight: 'bold', paddingVertical: 3, paddingHorizontal: 4, borderBottomWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#333', fontSize: 9 },
  grp: { flexDirection: 'row', borderBottomWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#333' },
  grpLabel: { width: '14.5%', borderLeftWidth: 1, borderColor: '#333', padding: 3, fontWeight: 'bold', fontSize: 7, justifyContent: 'center', textAlign: 'center' },
  line: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#ccc', minHeight: 15 },
  c: { paddingVertical: 3, paddingHorizontal: 3, borderRightWidth: 1, borderColor: '#ccc' },
  chk: { flexDirection: 'row', borderBottomWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#333' },
});
// Percent of the full table width; the left block (everything but the packing label) is 85.5% wide.
const W = [['S.No', 6.4], ['Material Description', 21], ['MOC', 8.3], ['Size / Specification', 16.6], ['IBR No', 16.6], ['Qty', 14], ['Make', 8.3], ['Item Code', 8.8]];
const LEFT = 85.5;
const lw = w => `${(w / LEFT) * 100}%`;
const TH = { fontWeight: 'bold', backgroundColor: '#eee' };

// 'SB-1109-1-PACKAGE-3' -> two lines, so the label never hyphenates mid-word.
const labelBreak = l => String(l || '').replace(/^(.*-)((?:LOOSE|PACKAGE|BAG)-\d+)$/, '$1\n$2');

function CombinedDoc({ list, items, checklist }) {
  const prof = companyProfile(list.company);
  const tops = items.filter(i => !i.parent_item_id);
  const kids = id => items.filter(i => i.parent_item_id === id);
  const blocks = [];
  for (const it of tops) {
    const last = blocks[blocks.length - 1];
    if (last && last.section === (it.section || null) && last.label === (it.group_label || null)) last.rows.push(it);
    else blocks.push({ section: it.section || null, label: it.group_label || null, rows: [it] });
  }
  const header = (
    <View fixed style={[C.hRow, { borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1 }]}>
      {W.map(([l, w]) => <Text key={l} style={[C.c, TH, { width: `${w}%`, fontSize: 7 }]}>{l}</Text>)}
      <Text style={[C.c, TH, { width: '14.5%', fontSize: 7, borderRightWidth: 0 }]}>Packing No</Text>
    </View>
  );
  const meta = (a, b) => (
    <View style={C.hRow}>
      <View style={[C.hCell, { width: '55%' }]}><Text style={C.lab}>{a[0]}</Text><Text style={{ flex: 1 }}>{a[1] || ''}</Text></View>
      <View style={[C.hCell, { width: '45%', borderLeftWidth: 1, borderColor: '#333' }]}><Text style={C.lab}>{b[0]}</Text><Text style={{ flex: 1 }}>{b[1] || ''}</Text></View>
    </View>);
  return (
    <Document>
      <Page size="A4" style={[tokens.page, { padding: 30, paddingBottom: 56 }]}>
        <View style={tokens.center}>
          <Text style={[tokens.company, { fontSize: 15 }]}>{prof.name}</Text>
          <Text style={[tokens.title, { fontSize: 11 }]}>{list.title || 'MASTER PACKING LIST'}</Text>
          <Text style={tokens.sub}>{prof.sub.split(' · GST')[0]}{list.company === 'Shanti Boilers' || !list.company ? ' · Stores@shantiboilers.com' : ''}</Text>
        </View>
        <View style={[C.box, { marginTop: 8, marginBottom: 6 }]}>
          {meta(['Buyer Name:', list.customer_name], ['Invoice No.', list.invoice_no])}
          {meta(['Address :', list.customer_address], ['Date.', list.invoice_date])}
          {meta(['Dispatch Through.', list.dispatch_through], ['Packing No.', packingNoLabel(list)])}
          {meta(['VEHICLE NO.', list.vehicle_no], ['D. C. NO:-', list.dc_no])}
          <View style={[C.hRow, { borderBottomWidth: 0 }]}>
            <View style={[C.hCell, { width: '55%' }]}><Text style={C.lab}>Contact Person No :</Text><Text style={{ flex: 1 }}>{list.contact_person || ''}</Text></View>
            <View style={[C.hCell, { width: '45%', borderLeftWidth: 1, borderColor: '#333' }]}><Text style={C.lab}>D. C. DATE :-</Text><Text style={{ flex: 1 }}>{list.dc_date || ''}</Text></View>
          </View>
        </View>
        {list.model_code ? <Text style={{ fontWeight: 'bold', marginBottom: 4 }}>{list.model_code}</Text> : null}
        {header}
        {blocks.map((g, gi) => (
          <View key={gi}>
            {(gi === 0 || blocks[gi - 1].section !== g.section) && g.section ? <Text style={C.secRow}>{g.section}</Text> : null}
            {g.rows.flatMap(it => [it, ...kids(it.id)]).map((it, ri) => {
              const vals = [it.s_no, it.line_kind === 'sub' || it.line_kind === 'serial' ? '' : it.material_description, it.moc, it.size_spec, it.ibr_no,
                it.line_kind === 'serial' ? '' : `${it.qty} ${it.unit || ''}`.trim(), it.make, it.item_code];
              const last = ri === g.rows.flatMap(x => [x, ...kids(x.id)]).length - 1;
              return (
                <View key={it.id} style={[C.line, { borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#999' }, last ? { borderBottomColor: '#333' } : {}]} wrap={false}>
                  {W.map(([, w], i) => <Text key={i} style={[C.c, { width: `${w}%`, fontWeight: i === 1 ? 'bold' : 'normal' }]}>{vals[i] ?? ''}</Text>)}
                  <Text style={[C.c, { width: '14.5%', borderRightWidth: 0, fontWeight: 'bold', fontSize: 7 }]}>{ri === 0 ? labelBreak(g.label) : ''}</Text>
                </View>);
            })}
          </View>
        ))}
        {checklist?.length > 0 && (
          <View style={{ marginTop: 10 }} wrap={false}>
            <View style={[C.chk, { borderTopWidth: 1, backgroundColor: '#eee' }]}>
              {[['S.NO.', 8], ['DESCRIPTION', 56], ['PROD.', 12], ['QC', 12], ['STORES', 12]].map(([l, w]) => <Text key={l} style={[C.c, { width: `${w}%`, fontWeight: 'bold' }]}>{l}</Text>)}
            </View>
            {checklist.map((c, i) => (
              <View key={c.id} style={C.chk}>
                <Text style={[C.c, { width: '8%' }]}>{i + 1}</Text><Text style={[C.c, { width: '56%' }]}>{c.description}</Text>
                <Text style={[C.c, { width: '12%' }]}>{c.prod_ok ? 'OK' : ''}</Text><Text style={[C.c, { width: '12%' }]}>{c.qc_ok ? 'OK' : ''}</Text><Text style={[C.c, { width: '12%' }]}>{c.stores_ok ? 'OK' : ''}</Text>
              </View>))}
          </View>)}
        <Text style={s.decl}>
          Declaration: Dear Sir, kindly check all the above materials as per the packing list, item-wise, and confirm within 7 days if there are any
          discrepancies or missing items mentioned in the packing list but not received at your end.
        </Text>
        <View style={s.signRow} wrap={false}>
          {['STORES', 'PROD', 'QC', 'MANAGEMENT'].map(r => <Text key={r} style={[s.signBox, { fontWeight: 'bold' }]}>{r}</Text>)}
        </View>
        <ReportFooter />
      </Page>
    </Document>
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
  if (list.layout === 'combined') return renderToBuffer(<CombinedDoc list={list} items={items} checklist={checklist} />);
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
