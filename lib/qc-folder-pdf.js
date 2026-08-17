// Full statutory folder PDF (QC-FOLDER-DESIGN.md) — one combined multi-page document, ordered
// Label → Covering letter → Mounting list → the model's statutory forms. The entity (letterhead,
// ref prefix, signatory) is derived from the maker-number prefix, the form set from the model.
// First-pass layouts: faithful to the sample content/field order, not yet pixel-matched to the
// government sheets. Reuses the Form IV A table from lib/qc-doc-pdf.js's column model.
// ponytail: layouts are first-pass; refine per form against the samples as needed.
import React from 'react';
import { Document, Page, View, Text, StyleSheet, Svg, G, Rect, Path, Circle, renderToBuffer } from '@react-pdf/renderer';
import { PDFDocument } from 'pdf-lib';
import { modelConfig, FORM_LABELS } from './qc-models.js';
import { entityForMaker, DIRECTOR_OF_BOILERS } from './qc-entities.js';
import { getObjectBuffer } from './r2.js';

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 8, fontFamily: 'Helvetica', color: '#111', lineHeight: 1.4 },
  pageL: { padding: 24, fontSize: 7, fontFamily: 'Helvetica', color: '#111' },
  center: { textAlign: 'center' },
  company: { fontSize: 12, fontWeight: 'bold' },
  sub: { fontSize: 7, color: '#555', marginTop: 2 },
  title: { fontSize: 10, fontWeight: 'bold', marginTop: 8, textAlign: 'center' },
  docId: { fontSize: 8, marginTop: 2, marginBottom: 8, textAlign: 'center', color: '#555' },
  h: { fontSize: 9, fontWeight: 'bold', marginTop: 10, marginBottom: 4 },
  row: { flexDirection: 'row', paddingVertical: 1 },
  lbl: { color: '#555', width: 150 },
  val: { fontWeight: 'bold', flex: 1 },
  p: { marginBottom: 6 },
  li: { marginLeft: 10, marginBottom: 1 },
  tHead: { flexDirection: 'row', backgroundColor: '#eee', borderTop: 1, borderBottom: 1, borderColor: '#999' },
  tRow: { flexDirection: 'row', borderBottom: 1, borderColor: '#ddd', minHeight: 12 },
  cell: { paddingVertical: 2, paddingHorizontal: 2, borderRight: 1, borderColor: '#ddd' },
  signRow: { flexDirection: 'row', marginTop: 28, justifyContent: 'space-between' },
  signBox: { width: '40%', borderTop: 1, borderColor: '#333', paddingTop: 4, textAlign: 'center', fontSize: 7 },
  labelBox: { border: 1, borderColor: '#333', padding: 12, marginBottom: 16 },
});

const size = p => [p.size_t, p.size_w, p.size_l].filter(Boolean).join(' × ') || '—';

// Form IV A columns (mirrors lib/qc-doc-pdf.js). Form III A adds two columns.
const IVA_COLS = [
  ['P.No', 3, p => p.part_no], ['Part', 13, p => p.part_name], ['Cast No', 7, p => p.tc_cast_no || '—'],
  ['Plate No', 7, p => p.tc_plate_no || '—'], ['Size', 8, p => size(p)], ['Qty', 3, p => p.qty],
  ['Spec', 7, p => p.material_spec || '—'], ['Steel Maker', 8, p => p.steel_maker || '—'],
  ['Cert No', 13, p => p.certificate_no || '—'], ['C', 3, p => p.chem_c], ['Mn', 3, p => p.chem_mn],
  ['P', 3, p => p.chem_p], ['S', 3, p => p.chem_s], ['Si', 3, p => p.chem_si],
  ['Y.S', 4, p => p.ys], ['UTS', 4, p => p.uts], ['El %', 3, p => p.elongation], ['Bend', 3, p => p.bend_test],
];
const IIIA_COLS = [
  ['P.No', 3, p => p.part_no], ['Part', 11, p => p.part_name], ['Cast No', 6, p => p.tc_cast_no || '—'],
  ['Plate No', 6, p => p.tc_plate_no || '—'], ['Size', 7, p => size(p)], ['Qty', 3, p => p.qty],
  ['Spec', 6, p => p.material_spec || '—'], ['Steel Maker', 7, p => p.steel_maker || '—'],
  ['Cert No', 11, p => p.certificate_no || '—'], ['Process', 6, p => p.steel_making_process || '—'],
  ['C', 3, p => p.chem_c], ['Mn', 3, p => p.chem_mn], ['P', 3, p => p.chem_p], ['S', 3, p => p.chem_s], ['Si', 3, p => p.chem_si],
  ['H.T.', 5, p => p.heat_treatment || '—'], ['Y.S', 4, p => p.ys], ['UTS', 4, p => p.uts], ['El %', 3, p => p.elongation], ['Bend', 3, p => p.bend_test],
];

function Table({ cols, parts }) {
  return (
    <View>
      <View style={s.tHead}>
        {cols.map(([label, w], i) => <Text key={i} style={[s.cell, { width: `${w}%`, fontWeight: 'bold' }]}>{label}</Text>)}
      </View>
      {parts.map((p, i) => (
        <View key={p.id ?? i} style={s.tRow} wrap={false}>
          {cols.map(([, w, get], j) => <Text key={j} style={[s.cell, { width: `${w}%` }]}>{get(p) ?? '—'}</Text>)}
        </View>
      ))}
    </View>
  );
}

// The client confirmed the SBOPS app mark IS the Shanti Boilers company logo (same brand), so it's
// the right thing to print on the letterhead — ported from public/logo.svg's own coordinates/paths
// into @react-pdf/renderer's native shape primitives, since Image only takes PNG/JPG and this app
// keeps only the .svg source.
function Logo({ size = 36 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 500 500">
      <G>
        <Rect x={370} y={297} width={15} height={64} transform="rotate(-90 370 297)" fill="#F45D20" />
        <Rect x={83} y={200.99} width={15} height={64} transform="rotate(-60 83 200.99)" fill="#F45D20" />
        <Rect x={361.945} y={234.95} width={15} height={64} transform="rotate(-119 361.945 234.95)" fill="#F45D20" />
        <Rect x={141} y={132.235} width={15} height={64} transform="rotate(-38 141 132.235)" fill="#F45D20" />
        <Rect x={323.343} y={182.904} width={15} height={64} transform="rotate(-143 323.343 182.904)" fill="#F45D20" />
        <Rect x={65} y={297} width={15} height={64} transform="rotate(-90 65 297)" fill="#F45D20" />
      </G>
      <G>
        <Path d="M249.5 185C300.85 185 344 230.906 344 289.5C344 348.094 300.85 394 249.5 394C198.15 394 155 348.094 155 289.5C155 230.906 198.15 185 249.5 185Z" stroke="#F45D20" strokeWidth={20} fill="none" />
        <Rect x={242} y={198} width={15} height={188} fill="#F45D20" />
        <Rect x={244} y={96} width={15} height={64} fill="#F45D20" />
        <Circle cx={193} cy={341} r={29} fill="#F45D20" />
        <Circle cx={250} cy={225} r={29} fill="#F45D20" />
        <Path d="M279 333C279 349.016 266.016 362 250 362C233.984 362 250 349.016 250 333C250 316.984 233.984 304 250 304C266.016 304 279 316.984 279 333Z" fill="#F45D20" />
      </G>
    </Svg>
  );
}

function Head({ entity, title }) {
  return (
    <View style={s.center}>
      <View style={{ alignItems: 'center', marginBottom: 2 }}><Logo size={34} /></View>
      <Text style={s.company}>{entity.name.toUpperCase()}</Text>
      <Text style={s.sub}>{entity.address}</Text>
      {title ? <Text style={s.title}>{title}</Text> : null}
    </View>
  );
}

function KV({ label, value }) {
  return <View style={s.row}><Text style={s.lbl}>{label}</Text><Text style={s.val}>: {value || '—'}</Text></View>;
}

function Sign({ entity }) {
  return (
    <View style={s.signRow}>
      <Text style={s.signBox}>Maker's Representative</Text>
      <Text style={s.signBox}>For {entity.name}.{'\n'}Maker / Authorized Signatory</Text>
    </View>
  );
}

// ---- Pages ---------------------------------------------------------------

function LabelPage({ document: d, project, entity }) {
  const block = (
    <View style={s.labelBox}>
      <View style={{ alignItems: 'center', marginBottom: 6 }}><Logo size={30} /></View>
      <Text style={{ fontWeight: 'bold', marginBottom: 6 }}>DOCUMENTATION</Text>
      <KV label="Makers Name" value={entity.name} />
      <KV label="Type of Boiler" value={d.boiler_type} />
      <KV label="Model" value={d.label_model_code} />
      <KV label="Maker Number" value={d.makers_no} />
      <KV label="Working Pressure" value={d.working_pressure} />
      <KV label="M.C.R" value={d.evaporation_capacity} />
      <KV label="Year of Make" value={d.year_of_make} />
      <KV label="Client" value={project?.customer_name} />
    </View>
  );
  return <Page size="A4" style={s.page}>{block}{block}</Page>;
}

function manifestLines(d, model, parts, mountings) {
  const lines = [];
  if (d.drawing_no_from || d.drawing_no_to || d.drawing_no) {
    const range = d.drawing_no_from && d.drawing_no_to ? `${d.drawing_no_from} TO ${d.drawing_no_to}` : (d.drawing_no || d.drawing_no_from || d.drawing_no_to);
    lines.push(`As built Drawings 1 set (Drawing No's ${range})`);
  }
  model.forms.forEach(f => lines.push(FORM_LABELS[f] || f));
  const certCount = new Set(parts.map(p => p.test_certificate_id).filter(Boolean)).size;
  if (certCount) lines.push(`Test Certificates – ${certCount} no's`);
  if (mountings.length) lines.push(`List of mountings – 1 page`);
  let extra = [];
  try { extra = d.manifest_extra ? JSON.parse(d.manifest_extra) : []; } catch { extra = []; }
  extra.forEach(e => lines.push(typeof e === 'string' ? e : `${e.label}${e.count != null ? ` – ${e.count}` : ''}`));
  return lines;
}

function CoveringLetterPage({ document: d, project, entity, model, parts, mountings }) {
  const recipient = d.recipient_name
    ? { name: d.recipient_name, address: d.recipient_address || '' }
    : DIRECTOR_OF_BOILERS;
  const refNo = `${entity.refPrefix}/${String(d.makers_no || '').replace(/[^0-9A-Za-z-]/g, '')}`;
  return (
    <Page size="A4" style={s.page}>
      <Head entity={entity} />
      <View style={{ marginTop: 10 }}>
        <Text>Ref: {refNo}</Text>
        <Text>Date: {d.submission_date || '—'}</Text>
        <Text style={{ marginTop: 8 }}>To,</Text>
        <Text style={{ fontWeight: 'bold' }}>{recipient.name}</Text>
        {recipient.address ? <Text>{recipient.address}</Text> : null}
        <Text style={{ marginTop: 8, fontWeight: 'bold' }}>
          SUB: Submission Of Original Documentation Folder For {model.noun} Maker No: {d.makers_no || '—'}
        </Text>
        <Text style={{ marginTop: 8 }}>Dear Sir,</Text>
        <Text style={s.p}>
          With reference to the above subject we are enclosing herewith Set of Original Drawings and
          Original Documentation folder along with the Mountings and Fittings &amp; Test Certificates of {model.noun}.
        </Text>
        {manifestLines(d, model, parts, mountings).map((l, i) => <Text key={i} style={s.li}>• {l}</Text>)}
        <Text style={{ marginTop: 10 }}>Please acknowledge receipt of the same.</Text>
        <Text style={{ marginTop: 10 }}>Thank you,</Text>
        <Text>Yours Sincerely,</Text>
        <Text style={{ fontWeight: 'bold', marginTop: 4 }}>{entity.name}</Text>
        <Text>{d.signer_name || ''}</Text>
        <Text>QC Engineer</Text>
      </View>
    </Page>
  );
}

function MountingListPage({ document: d, mountings }) {
  const COLS = [['Sl', 4, (m, i) => String(i + 1)], ['Description', 30, m => m.description], ['Size', 12, m => m.size],
    ['MOC', 10, m => m.moc], ['Serial No(s)', 20, m => m.serial_numbers], ['Make', 14, m => m.make], ['Qty', 6, m => m.qty]];
  return (
    <Page size="A4" style={s.page}>
      <Text style={[s.title, { marginTop: 0 }]}>LIST OF MOUNTINGS AND FITTINGS</Text>
      <Text style={s.docId}>JOB NO: {d.makers_no || d.doc_id}</Text>
      <View style={s.tHead}>
        {COLS.map(([l, w], i) => <Text key={i} style={[s.cell, { width: `${w}%`, fontWeight: 'bold' }]}>{l}</Text>)}
      </View>
      {mountings.map((m, i) => (
        <View key={m.id ?? i} style={s.tRow} wrap={false}>
          {COLS.map(([, w, get], j) => <Text key={j} style={[s.cell, { width: `${w}%` }]}>{get(m, i) || '—'}</Text>)}
        </View>
      ))}
      {mountings.length === 0 && <Text style={{ marginTop: 8, color: '#777' }}>No mountings listed.</Text>}
    </Page>
  );
}

function FormII1Page({ document: d, entity, small }) {
  return (
    <Page size="A4" style={s.page}>
      <Head entity={entity} title={small ? 'FORM XVII — CERTIFICATE OF MANUFACTURE AND TEST FOR SMALL INDUSTRIAL BOILERS'
        : 'FORM II (1) — CERTIFICATE OF INSPECTION'} />
      <Text style={s.docId}>{d.doc_id}</Text>
      <KV label="Maker's Name" value={entity.name} />
      <KV label="Maker's No." value={d.makers_no} />
      <KV label="Year of Make" value={d.year_of_make} />
      <KV label="Type of Boiler" value={d.boiler_type} />
      <KV label="Working Pressure" value={d.working_pressure} />
      <KV label="Hydro Test Pressure" value={d.hydro_test_pressure} />
      <KV label="Drawing No's" value={[d.drawing_no_from, d.drawing_no_to].filter(Boolean).join(' TO ') || d.drawing_no} />
      <Text style={s.p}>
        {'\n'}The boiler on completion was subjected to the hydrostatic test pressure shown above in the
        presence of the Inspecting Officer and satisfactorily withstood the test. All welded seams were
        subjected to non-destructive examination where applicable and found satisfactory.
      </Text>
      <Sign entity={entity} />
    </Page>
  );
}

function FormIIIPage({ document: d, entity, project }) {
  return (
    <Page size="A4" style={s.page}>
      <Head entity={entity} title="FORM III — CONSTRUCTION CERTIFICATE OF MANUFACTURE AND TEST" />
      <Text style={s.docId}>{d.doc_id}</Text>
      <KV label="Constructor's Name" value={entity.name} />
      <KV label="Manufactured For" value={project?.customer_name} />
      <KV label="Type of Boiler" value={d.boiler_type} />
      <KV label="Length Overall" value={d.length_overall} />
      <KV label="Diameter (largest belt)" value={d.internal_diameter} />
      <KV label="Design Pressure" value={d.design_pressure} />
      <KV label="Hydro Test Pressure" value={d.hydro_test_pressure} />
      <KV label="Maker's No." value={d.makers_no} />
      <KV label="Year of Make" value={d.year_of_make} />
      <KV label="Total Heating Surface" value={d.heating_surface} />
      <KV label="Evaporation Capacity" value={d.evaporation_capacity} />
      <KV label="Steam Outlet Temp." value={d.steam_temp} />
      <Text style={s.p}>{'\n'}Mountings — see the enclosed List of Mountings & Fittings. Drums / Headers &amp; Boxes: as applicable to this model. Safety valve test certificate enclosed with annexure.</Text>
      <Sign entity={entity} />
    </Page>
  );
}

function FormTablePage({ document: d, entity, title, cols, parts }) {
  return (
    <Page size="A4" orientation="landscape" style={s.pageL}>
      <Head entity={entity} title={title} />
      <Text style={s.docId}>{d.doc_id} · Maker's No. {d.makers_no || '—'}</Text>
      <Table cols={cols} parts={parts} />
      <Sign entity={entity} />
    </Page>
  );
}

// ---- Assembly ------------------------------------------------------------

function Folder({ document: d, parts, mountings, project }) {
  const entity = entityForMaker(d.makers_no);
  // Form set follows the PROJECT's equipment model (projects.series); the document's own `series`
  // is a legacy default ('SF') and not authoritative here.
  const model = modelConfig(project?.series || d.series);
  const formPage = f => {
    switch (f) {
      case 'II1': return <FormII1Page key={f} document={d} entity={entity} />;
      case 'XVII': return <FormII1Page key={f} document={d} entity={entity} small />;
      case 'III': return <FormIIIPage key={f} document={d} entity={entity} project={project} />;
      case 'IIIA': return <FormTablePage key={f} document={d} entity={entity} title="FORM III A — CERTIFICATE OF MANUFACTURE AND TEST" cols={IIIA_COLS} parts={parts} />;
      case 'IVA': return <FormTablePage key={f} document={d} entity={entity} title="FORM IV A — REGULATION 4 (c) (IV)" cols={IVA_COLS} parts={parts} />;
      default: return null;
    }
  };
  return (
    <Document>
      <LabelPage document={d} project={project} entity={entity} />
      <CoveringLetterPage document={d} project={project} entity={entity} model={model} parts={parts} mountings={mountings} />
      <MountingListPage document={d} mountings={mountings} />
      {model.forms.map(formPage)}
    </Document>
  );
}

// Client requirement: the folder ends with the source TC PDFs themselves, appended after the last
// statutory form. Our own pages come from @react-pdf/renderer (which only ever CREATES a PDF, never
// merges existing ones); each cert's own uploaded PDF is a separate file in R2, so pdf-lib does the
// actual append — load our rendered buffer, then copy every page of every linked cert's PDF onto it,
// in the same order parts appear on the document. A cert used by several parts is only appended once;
// a cert with no PDF on file is skipped silently (nothing to append).
async function appendCertificatePdfs(baseBuffer, parts) {
  const seen = new Set();
  const certs = [];
  for (const p of parts) {
    if (!p.test_certificate_id || !p.pdf_key || seen.has(p.test_certificate_id)) continue;
    seen.add(p.test_certificate_id);
    certs.push(p);
  }
  if (!certs.length) return baseBuffer;

  const out = await PDFDocument.load(baseBuffer);
  for (const c of certs) {
    try {
      const bytes = await getObjectBuffer(c.pdf_key);
      const src = await PDFDocument.load(bytes);
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach(pg => out.addPage(pg));
    } catch (err) {
      // A missing/corrupt R2 object for one cert shouldn't fail the whole folder — the statutory
      // forms are the legally-required part; the source TC copy is a convenience attachment.
      console.error(`qc-folder-pdf: couldn't append TC PDF for certificate ${c.test_certificate_id}`, err);
    }
  }
  return Buffer.from(await out.save());
}

export async function renderQcFolderPdf(document, parts, mountings, project) {
  const base = await renderToBuffer(<Folder document={document} parts={parts} mountings={mountings || []} project={project} />);
  // Parts carry pdf_key only if the query selecting them joined it in — see getQcDocumentDetail.
  return appendCertificatePdfs(base, parts);
}
