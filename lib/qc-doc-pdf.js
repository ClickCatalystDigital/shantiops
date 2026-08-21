// Statutory QC document PDF (QC-CHANGES.md) — Form IV A only in V1 (the master Test Certificate
// summary), landscape to fit its 18 columns. Same approach as lib/po-pdf.js (@react-pdf/renderer,
// pure Node) and modeled on the real Form IV A layout from the client's own sample
// (qc_master_folder.xlsx, Maker's No. SB-1037): company header, boiler meta block, then the full
// parts-to-certificate table, then a sign-off block.
import React from 'react';
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from '@react-pdf/renderer';

const s = StyleSheet.create({
  page: { padding: 24, fontSize: 7, fontFamily: 'Helvetica', color: '#111' },
  center: { textAlign: 'center' },
  company: { fontSize: 12, fontWeight: 'bold' },
  sub: { fontSize: 7, color: '#555', marginTop: 2 },
  title: { fontSize: 9, fontWeight: 'bold', marginTop: 6, textAlign: 'center' },
  docId: { fontSize: 8, marginTop: 2, marginBottom: 8, textAlign: 'center', color: '#555' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8, gap: 0 },
  metaItem: { width: '25%', flexDirection: 'row', paddingVertical: 1 },
  metaLabel: { color: '#666', width: 78 },
  metaVal: { fontWeight: 'bold', flex: 1 },
  intro: { marginBottom: 6 },
  tHead: { flexDirection: 'row', backgroundColor: '#eee', borderTop: 1, borderBottom: 1, borderColor: '#999' },
  tRow: { flexDirection: 'row', borderBottom: 1, borderColor: '#ddd', minHeight: 12 },
  cell: { paddingVertical: 2, paddingHorizontal: 2, borderRight: 1, borderColor: '#ddd' },
  signRow: { flexDirection: 'row', marginTop: 20, justifyContent: 'space-between' },
  signBox: { width: '40%', borderTop: 1, borderColor: '#333', paddingTop: 4, textAlign: 'center', fontSize: 7 },
});

// Column widths (label, width%, value(part)) — sum ~100. Cert No needs real room: its values
// (e.g. "RCL/MTL/PLM/80839164") are one unbroken token with no spaces to wrap on, so unlike every
// other text column it can't fall back to a second line if the box is too narrow — it just
// overflows into whatever sits to its right. Cast No/Plate No/Steel Maker/Part gave up a little
// width to make room since their values are shorter or (Part, Steel Maker) do have spaces to wrap.
const COLS = [
  ['P.No', 3, p => p.part_no],
  ['Part', 13, p => p.part_name],
  ['Cast No', 7, p => p.tc_cast_no || '—'],
  ['Plate No', 7, p => p.tc_plate_no || '—'],
  ['Size', 8, p => [p.size_t, p.size_w, p.size_l].filter(Boolean).join(' × ') || '—'],
  ['Qty', 3, p => p.qty],
  ['Spec', 7, p => p.material_spec || '—'],
  ['Steel Maker', 8, p => p.steel_maker || '—'],
  ['Cert No', 13, p => p.certificate_no || '—'],
  ['C', 3, p => p.chem_c],
  ['Mn', 3, p => p.chem_mn],
  ['P', 3, p => p.chem_p],
  ['S', 3, p => p.chem_s],
  ['Si', 3, p => p.chem_si],
  ['Y.S', 4, p => p.ys],
  ['UTS', 4, p => p.uts],
  ['El %', 3, p => p.elongation],
  ['Bend', 3, p => p.bend_test],
];

// Moved to lib/company-profiles.js (pure data/no JSX, needed by lib/report-pdf.js which must also
// load under plain `node`, not just Next's JSX-transformed runtime) — re-exported here so every
// existing `import { companyProfile } from './qc-doc-pdf.js'` (po-pdf, payslip-pdf, 20+ API routes
// via COMPANY_NAMES) keeps working unchanged. Zero behavior change, same data.
export { COMPANY_PROFILES, companyProfile, COMPANY_NAMES } from './company-profiles.js';

function Meta({ label, value }) {
  return (
    <View style={s.metaItem}>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={s.metaVal}>{value || '—'}</Text>
    </View>
  );
}

function Row({ p, i }) {
  return (
    <View style={s.tRow} wrap={false}>
      {COLS.map(([, w, get], j) => (
        <Text key={j} style={[s.cell, { width: `${w}%` }]}>{get(p) ?? '—'}</Text>
      ))}
    </View>
  );
}

function QcDocPdf({ document, parts }) {
  const profile = companyProfile(document.company);
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={s.page}>
        <View style={s.center}>
          <Text style={s.company}>{profile.name}</Text>
          <Text style={s.sub}>{profile.sub}</Text>
          <Text style={s.title}>FORM – IV A · REGULATION 4 (c) (IV)</Text>
          <Text style={s.docId}>{document.doc_id}</Text>
        </View>

        <View style={s.metaRow}>
          <Meta label="Maker's No." value={document.makers_no} />
          <Meta label="Year of Make" value={document.year_of_make} />
          <Meta label="Design Pressure" value={document.design_pressure} />
          <Meta label="Hydro Test" value={document.hydro_test_pressure} />
          <Meta label="Boiler Type" value={document.boiler_type} />
          <Meta label="Length Overall" value={document.length_overall} />
          <Meta label="Internal Dia" value={document.internal_diameter} />
          <Meta label="Heating Surface" value={document.heating_surface} />
          <Meta label="Evaporation Cap." value={document.evaporation_capacity} />
          <Meta label="Steam Temp." value={document.steam_temp} />
          <Meta label="Drawing No." value={document.drawing_no} />
        </View>

        <Text style={s.intro}>
          It is hereby certified that the original steel makers' certificates in Form IV contain the
          following information in respect of the material used in the manufacture of the boiler or
          parts thereof bearing maker's no. {document.makers_no || '—'}.
        </Text>

        <View style={s.tHead}>
          {COLS.map(([label, w], i) => (
            <Text key={i} style={[s.cell, { width: `${w}%`, fontWeight: 'bold' }]}>{label}</Text>
          ))}
        </View>
        {parts.map((p, i) => <Row key={p.id} p={p} i={i} />)}

        <View style={s.signRow}>
          <Text style={s.signBox}>Maker's Representative</Text>
          <Text style={s.signBox}>For {profile.name}.{'\n'}Maker / Authorized Signatory</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderQcDocPdf(document, parts) {
  return renderToBuffer(<QcDocPdf document={document} parts={parts} />);
}
