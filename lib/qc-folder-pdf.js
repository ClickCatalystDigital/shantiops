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
  // paddingBottom carved out for the fixed Footer (~40pt) so body content never collides with it.
  page: { paddingTop: 28, paddingHorizontal: 28, paddingBottom: 56, fontSize: 8, fontFamily: 'Helvetica', color: '#111', lineHeight: 1.4 },
  pageL: { paddingTop: 24, paddingHorizontal: 24, paddingBottom: 46, fontSize: 7, fontFamily: 'Helvetica', color: '#111' },
  center: { textAlign: 'center' },
  company: { fontSize: 12, fontWeight: 'bold' },
  sub: { fontSize: 7, color: '#555', marginTop: 2 },
  title: { fontSize: 10, fontWeight: 'bold', marginTop: 8, textAlign: 'center' },
  docId: { fontSize: 8, marginTop: 2, marginBottom: 8, textAlign: 'center', color: '#555' },
  // ---- shared page chrome: logo-inline header + contact footer ----
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  headerText: { marginLeft: 8 },
  companyLine1: { fontSize: 13, fontWeight: 'bold', letterSpacing: 0.5 },
  companyLine2: { fontSize: 10, fontWeight: 'bold', letterSpacing: 0.3, marginTop: 1 },
  footer: {
    position: 'absolute', left: 24, right: 24, bottom: 14,
    borderTop: 1, borderColor: '#ddd', paddingTop: 4,
    alignItems: 'center',
  },
  footerAddr: { fontSize: 6, color: '#555', marginBottom: 2, textAlign: 'center' },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  footerItem: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 5 },
  footerText: { fontSize: 6, color: '#555', marginLeft: 2 },
  footerWeb: { fontSize: 6, color: '#F45D20', fontWeight: 'bold' },
  // letter content was reading small/sparse — bigger type, more breathing room
  letterP: { marginBottom: 8, fontSize: 10, lineHeight: 1.6 },
  letterLi: { marginLeft: 14, marginBottom: 4, fontSize: 10, lineHeight: 1.5 },
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
});

const size = p => [p.size_t, p.size_w, p.size_l].filter(Boolean).join(' × ') || '—';

// Form IV A columns (mirrors lib/qc-doc-pdf.js) — also used by Form III A's per-group table (real
// sample SB-1097: 3A's table has the same columns as 4A; Process of Manufacture/Heat Treatment are
// in 3A's header block instead, see FormIIIAGroupPage below, not extra table columns).
const IVA_COLS = [
  ['P.No', 3, p => p.part_no], ['Part', 13, p => p.part_name], ['Cast No', 7, p => p.tc_cast_no || '—'],
  ['Plate No', 7, p => p.tc_plate_no || '—'], ['Size', 8, p => size(p)], ['Qty', 3, p => p.qty],
  ['Spec', 7, p => p.material_spec || '—'], ['Steel Maker', 8, p => p.steel_maker || '—'],
  ['Cert No', 13, p => p.certificate_no || '—'], ['C', 3, p => p.chem_c], ['Mn', 3, p => p.chem_mn],
  ['P', 3, p => p.chem_p], ['S', 3, p => p.chem_s], ['Si', 3, p => p.chem_si],
  ['Y.S', 4, p => p.ys], ['UTS', 4, p => p.uts], ['El %', 3, p => p.elongation], ['Bend', 3, p => p.bend_test],
];
// Form III-H (real sample, 2026-08-24, maker's no SB-IBR-SH-1100A/B) — a purpose-built certificate
// for a standalone Header/Desuperheater/Blowdown Tank/Feed Water Tank/Accumulator/Deaerator, simpler
// than IIIA/IVA since raw-material traceability is deferred to an attached Form IV-A/TC instead of
// being tabulated inline. "Melt No." is treated as the same value as tc_cast_no elsewhere in this
// app — an assumption, not confirmed with the client's QC contact.
const IIIH_COLS = [
  ['Item No', 5, p => p.part_no], ['Part Name', 30, p => p.part_name], ['Material Size', 20, p => size(p)],
  ['Quantity', 8, p => p.qty], ['Melt No', 15, p => p.tc_cast_no || '—'],
];
// Form III's own per-part table for a component (non-boiler) filing — distinct from IIIA/IVA/IIIH,
// matches the real sample's "MATERIALS OF MANUFACTURE" section exactly. "Inspecting officer" and
// "Remarks" have no backing data source anywhere in this app — rendered '—' rather than fabricated.
const FORM_III_PARTS_COLS = [
  ['P.No', 4, p => p.part_no], ['Part', 22, p => p.part_name], ['Qty', 6, p => p.qty], ['Size', 14, p => size(p)],
  ['Specification', 12, p => p.material_spec || '—'], ['Steel Making Process', 14, p => p.steel_making_process || '—'],
  ['Name of the Steel Maker', 16, p => p.steel_maker || '—'], ['Inspecting Officer', 6, () => '—'], ['Remarks', 6, () => '—'],
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

// Minimal line-icon glyphs for the footer contact row — drawn as vector primitives (same approach
// as Logo) since @react-pdf's Image only takes raster PNG/JPG and we want crisp small icons.
function ContactIcon({ kind, size = 7 }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24' };
  switch (kind) {
    case 'phone': // landline handset
      return <Svg {...p}><Path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.3 0 .7-.2 1L6.6 10.8Z" fill="#F45D20" /></Svg>;
    case 'mobile': // call/mobile
      return <Svg {...p}><Rect x={7} y={2} width={10} height={20} rx={2} fill="none" stroke="#F45D20" strokeWidth={1.6} /><Circle cx={12} cy={17.5} r={0.9} fill="#F45D20" /></Svg>;
    case 'whatsapp':
      return <Svg {...p}><Circle cx={12} cy={12} r={9.5} fill="none" stroke="#F45D20" strokeWidth={1.6} /><Path d="M8 16l1-3.2A5.4 5.4 0 1 1 12.4 17L8 16Z" fill="none" stroke="#F45D20" strokeWidth={1.4} /></Svg>;
    case 'mail':
      return <Svg {...p}><Rect x={2} y={5} width={20} height={14} rx={1.5} fill="none" stroke="#F45D20" strokeWidth={1.6} /><Path d="M3 6.5l9 6.5 9-6.5" fill="none" stroke="#F45D20" strokeWidth={1.6} /></Svg>;
    default: return null;
  }
}

// Logo + two-line ALL-CAPS company name, side by side — replaces the old stacked Head(). Splits on
// " & " so "Shanti Boilers & Pressure Vessels (P) Ltd" becomes "SHANTI BOILERS" / "& PRESSURE
// VESSELS (P) LTD"; entities with no "&" (e.g. Shanti Techno Fab) just get a single line.
function Header({ entity }) {
  const [first, ...rest] = entity.name.toUpperCase().split(' & ');
  const second = rest.length ? `& ${rest.join(' & ')}` : null;
  return (
    <View style={s.headerRow} fixed>
      <Logo size={32} />
      <View style={s.headerText}>
        <Text style={s.companyLine1}>{first}</Text>
        {second ? <Text style={s.companyLine2}>{second}</Text> : null}
      </View>
    </View>
  );
}

// Repeats on every generated page (react-pdf keeps `fixed` elements across auto-pagination too,
// so multi-page forms like Form III still get it on each page without extra wiring).
function Footer({ entity }) {
  const c = entity.contact;
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerAddr}>{entity.address}</Text>
      <View style={s.footerRow}>
        <View style={s.footerItem}><ContactIcon kind="mobile" /><Text style={s.footerText}>{c.mobile}</Text></View>
        <View style={s.footerItem}><ContactIcon kind="phone" /><Text style={s.footerText}>{c.landline}</Text></View>
        <View style={s.footerItem}><ContactIcon kind="whatsapp" /><Text style={s.footerText}>{c.whatsapp}</Text></View>
        <View style={s.footerItem}><ContactIcon kind="mail" /><Text style={s.footerText}>{c.emails.join(', ')}</Text></View>
      </View>
      <Text style={s.footerWeb}>{c.website}</Text>
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

// Form III's real component-filing sign-off (Sheet1 of the client's sample) — two roles per side,
// distinct from the generic Sign() above. Only used by FormIIIPage's component (non-boiler) branch —
// the existing boiler branch keeps using the generic Sign(), unchanged, per plan §3.
function SignFormIII({ entity }) {
  return (
    <>
      <View style={s.signRow}>
        <Text style={s.signBox}>Sign of Engineer</Text>
        <Text style={s.signBox}>Maker</Text>
      </View>
      <View style={[s.signRow, { marginTop: 8 }]}>
        <Text style={s.signBox}>Inspector of Boilers</Text>
        <Text style={s.signBox}>Director of Boilers</Text>
      </View>
    </>
  );
}

// Form III-H's real sign-off (both FORM3H sample sheets) — genuinely two independent stages, each
// with its own attestation paragraph, not one shared block like every other form here.
function SignIIIH({ entity, document: d }) {
  return (
    <>
      <Text style={{ marginTop: 14, fontSize: 8 }}>Final Inspection Date:</Text>
      <View style={s.signRow}>
        <Text style={s.signBox}>Signature and Seal of Maker's Representative</Text>
        <Text style={s.signBox}>Signature and Seal of Maker</Text>
      </View>
      <Text style={{ marginTop: 14, fontSize: 8 }}>Final Inspection Date:</Text>
      <Text style={{ marginTop: 6, fontSize: 8, lineHeight: 1.4 }}>
        We have satisfied ourselves that the {d.makers_no || '—'} {d.boiler_type || 'part'} have been
        constructed in accordance with Indian Boiler Regulations, 1950. The tests conducted have been
        witnessed by us, wherever applicable and the particulars entered herein are correct.
      </Text>
      <View style={[s.signRow, { marginTop: 10 }]}>
        <Text style={s.signBox}>Name and Signature of Competent Person</Text>
        <Text style={s.signBox}>Name and Signature of Inspecting Authority</Text>
      </View>
    </>
  );
}

// ---- Pages ---------------------------------------------------------------

// `range` is undefined for a form that ended up with zero physical pages (only possible for Form
// III A with zero groups defined — see renderQcFolderPdf) — that form's manifest line is skipped
// entirely rather than claiming a page number for content that isn't actually in the folder.
function pageRangeLabel(range) {
  if (!range) return '';
  return range.start === range.end ? ` (Page ${range.start})` : ` (Page ${range.start} to ${range.end})`;
}

function manifestLines(d, model, parts, mountings, pageRanges) {
  const lines = [];
  if (d.approved_drawing_codes?.length) {
    lines.push(`As built Drawings 1 set (Drawing No's ${d.approved_drawing_codes.join(', ')})`);
  }
  model.forms.forEach(f => {
    if (!pageRanges[f]) return; // zero pages actually rendered for this form — don't list it
    lines.push(`${FORM_LABELS[f] || f}${pageRangeLabel(pageRanges[f])}`);
  });
  const certCount = new Set(parts.map(p => p.test_certificate_id).filter(Boolean)).size;
  if (certCount) lines.push(`Test Certificates – ${certCount} no's${pageRangeLabel(pageRanges.certificates)}`);
  if (mountings.length) lines.push(`List of mountings${pageRangeLabel(pageRanges.mountings)}`);
  let extra = [];
  try { extra = d.manifest_extra ? JSON.parse(d.manifest_extra) : []; } catch { extra = []; }
  extra.forEach(e => lines.push(typeof e === 'string' ? e : `${e.label}${e.count != null ? ` – ${e.count}` : ''}`));
  return lines;
}

function CoveringLetterPage({ document: d, project, entity, model, parts, mountings, pageRanges }) {
  const recipient = d.recipient_name
    ? { name: d.recipient_name, address: d.recipient_address || '' }
    : DIRECTOR_OF_BOILERS;
  const refNo = `${entity.refPrefix}/${String(d.makers_no || '').replace(/[^0-9A-Za-z-]/g, '')}`;
  return (
    <Page size="A4" style={s.page}>
      <Header entity={entity} />
      <View style={{ marginTop: 14, fontSize: 10 }}>
        <Text style={{ marginBottom: 3 }}>Ref: {refNo}</Text>
        <Text style={{ marginBottom: 8 }}>Date: {d.submission_date || '—'}</Text>
        <Text style={{ marginBottom: 3 }}>To,</Text>
        <Text style={{ fontWeight: 'bold', marginBottom: 2 }}>{recipient.name}</Text>
        {recipient.address ? <Text style={{ marginBottom: 8 }}>{recipient.address}</Text> : null}
        <Text style={{ marginTop: 4, marginBottom: 10, fontWeight: 'bold' }}>
          SUB: Submission Of Original Documentation Folder For {model.noun} Maker No: {d.makers_no || '—'}
        </Text>
        <Text style={{ marginBottom: 8 }}>Dear Sir,</Text>
        <Text style={s.letterP}>
          With reference to the above subject we are enclosing herewith Set of Original Drawings and
          Original Documentation folder along with the Mountings and Fittings &amp; Test Certificates of {model.noun}.
        </Text>
        {manifestLines(d, model, parts, mountings, pageRanges || {}).map((l, i) => <Text key={i} style={s.letterLi}>{i + 1}. {l}</Text>)}
        <Text style={{ marginTop: 16, marginBottom: 4 }}>Please acknowledge receipt of the same.</Text>
        <Text style={{ marginBottom: 4 }}>Thank you,</Text>
        <Text>Yours Sincerely,</Text>
        <Text style={{ fontWeight: 'bold', marginTop: 6 }}>{entity.name}</Text>
        <Text style={{ marginTop: 22 }}>{d.signer_name || ''}</Text>
        <Text>QC Engineer</Text>
      </View>
      <Footer entity={entity} />
    </Page>
  );
}

function MountingListPage({ document: d, mountings, entity }) {
  const COLS = [['Sl', 4, (m, i) => String(i + 1)], ['Description', 30, m => m.description], ['Size', 12, m => m.size],
    ['MOC', 10, m => m.moc], ['Serial No(s)', 20, m => m.serial_numbers], ['Make', 14, m => m.make], ['Qty', 6, m => m.qty]];
  return (
    <Page size="A4" orientation="landscape" style={s.pageL}>
      <Header entity={entity} />
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
      <Footer entity={entity} />
    </Page>
  );
}

// Small-boiler variant (Form XVII) has no real sample on file — kept as the original plain KV
// summary. The Form II(1) boiler branch below is rebuilt against the real SB-1097 sample sheet: the
// original version was a bare KV list missing the inspecting-authority block, the certification
// paragraph naming the boiler/maker, and the stamp table — this restores that real structure.
function FormII1Page({ document: d, entity, small }) {
  if (small) {
    return (
      <Page size="A4" style={s.page}>
        <Header entity={entity} />
        <Text style={s.title}>FORM XVII — CERTIFICATE OF MANUFACTURE AND TEST FOR SMALL INDUSTRIAL BOILERS</Text>
        <Text style={s.docId}>{d.doc_id}</Text>
        <KV label="Maker's Name" value={entity.name} />
        <KV label="Maker's No." value={d.makers_no} />
        <KV label="Year of Make" value={d.year_of_make} />
        <KV label="Type of Boiler" value={d.boiler_type} />
        <KV label="Working Pressure" value={d.working_pressure} />
        <KV label="Hydro Test Pressure" value={d.hydro_test_pressure} />
        <KV label="Drawing No's" value={d.approved_drawing_codes?.join(', ')} />
        <Text style={s.p}>
          {'\n'}The boiler on completion was subjected to the hydrostatic test pressure shown above in the
          presence of the Inspecting Officer and satisfactorily withstood the test. All welded seams were
          subjected to non-destructive examination where applicable and found satisfactory.
        </Text>
        <Sign entity={entity} />
        <Footer entity={entity} />
      </Page>
    );
  }
  // The sample's own line is this short regulatory designation ("DIRECTOR OF BOILERS, TELANGANA,
  // HYDERABAD"), not DIRECTOR_OF_BOILERS.name ("The Director of Boilers") — that longer form is
  // right for the covering letter's own salutation, a different tone/purpose than this form's fixed
  // designation-of-authority line.
  const authorityDesignation = d.recipient_name || 'DIRECTOR OF BOILERS, TELANGANA, HYDERABAD';
  return (
    <Page size="A4" style={s.page}>
      <Header entity={entity} />
      <Text style={s.title}>FORM – II (1)</Text>
      <Text style={s.sub}>CERTIFICATE OF INSPECTION FOR SHOP ASSEMBLED BOILERS · [REGULATION 4 (C) (i)]</Text>
      <Text style={s.docId}>{d.doc_id}</Text>
      <Text style={{ marginTop: 8, fontWeight: 'bold', fontSize: 8 }}>DESIGNATION OF INSPECTING AUTHORITY</Text>
      <Text style={{ marginBottom: 8 }}>{authorityDesignation}</Text>
      <Text style={s.p}>
        We hereby certify that the {d.boiler_type || '—'} built by M/s. {entity.name}, {entity.address}. Under
        Maker's Number {d.makers_no || '—'} was constructed under our supervision at inspected at various
        stages of construction by the Competent person and that the construction and workmanship were
        satisfactory and in accordance with standard conditions for the design and construction of boilers
        as per regulation framed under boilers Act, 1923.
      </Text>
      <Text style={s.p}>The boiler is stamped on pressure part of shell plate with stamp as shown here under:</Text>
      <KV label="Maker's Name" value={entity.name} />
      <KV label="Maker's No." value={d.makers_no} />
      <KV label="Year of Make" value={d.year_of_make} />
      <KV label="Tested To" value={d.hydro_test_pressure ? `${d.hydro_test_pressure} Kg/cm²${d.hydro_test_date ? ` on ${d.hydro_test_date}` : ''}` : null} />
      <KV label="W.P." value={d.working_pressure} />
      <Text style={{ marginTop: 10, fontSize: 8 }}>Competent Person's or Inspecting Authority's Official Stamp:</Text>
      <Text style={s.p}>
        {'\n'}The boiler on completion was subjected to a Hydrostatic test pressure of {d.hydro_test_pressure || '—'} Kg/cm² (g)
        in the presence of Inspecting Officer{d.hydro_test_date ? ` on ${d.hydro_test_date}` : ''} and satisfactorily withstood the test.
      </Text>
      <Text style={s.p}>All welded seams were subjected to destructive and non-destructive examination where applicable and found satisfactory.</Text>
      <Sign entity={entity} />
      <Footer entity={entity} />
    </Page>
  );
}

function FormIIIPage({ document: d, entity, project, model, parts, mountingsPage }) {
  // Component (non-boiler) filing — real sample (2026-08-24): boiler-only fields (Heating Surface,
  // Evaporation Capacity, Grate Area) don't apply and are marked NA rather than omitted; the
  // "Description" field holds the component name (e.g. "STEAM HEADER") in the same boiler_type
  // column a boiler filing uses for its own type — reused, not a new column.
  if (model?.noun && model.noun !== 'Boiler') {
    return (
      <Page size="A4" style={s.page}>
        <Header entity={entity} />
        <Text style={s.title}>FORM III — CONSTRUCTOR'S CERTIFICATE OF MANUFACTURE AND TEST</Text>
        <Text style={s.docId}>{d.doc_id}</Text>
        <KV label="Description" value={d.boiler_type} />
        <KV label="Constructor's Name and Address" value={entity.name} />
        <KV label="Manufactured For" value={project?.customer_name} />
        <KV label="Leading Dimensions" value={d.length_overall} />
        <KV label="Working Pressure" value={d.design_pressure} />
        <KV label="Test Pressure" value={d.hydro_test_pressure} />
        <KV label="Maker's No." value={d.makers_no} />
        <KV label="Year of Manufacture" value={d.year_of_make} />
        <KV label="Heating Surface" value="NA" />
        <KV label="Final Temperature of Steam" value={d.steam_temp} />
        <KV label="Grate Area" value="NA" />
        <KV label="Total Evaporation Capacity" value="NA" />
        <Text style={s.h}>Parts Manufactured at the Constructor's Site</Text>
        <KV label="Name of the Parts" value={d.boiler_type} />
        <KV label="Leading Dimensions" value="As Per Drawing" />
        <KV label="Manufactured by" value={entity.name} />
        <KV label="Parts Manufactured and Inspected at all stages of Construction" value="YES" />
        <KV label="Certificates Furnished (Constructor's, Steel Maker's and Inspecting Authority's etc.)" value="YES" />
        <KV label="Parts Hydraulically Tested and Internally Inspected after Test" value="YES" />
        <Text style={s.h}>Parts Manufactured Outside</Text>
        <KV label="" value="NA" />
        <Text style={s.h}>Materials of Manufacture</Text>
        <Table cols={FORM_III_PARTS_COLS} parts={parts} />
        <SignFormIII entity={entity} />
        <Footer entity={entity} />
      </Page>
    );
  }
  // Boiler filing — real sample's 9 numbered sections, in order. One long <Page>, letting
  // @react-pdf/renderer auto-paginate (with Header/Footer repeating via `fixed`) rather than hand-
  // splitting into "FORM III Contd." pages — same mechanism renderSection's page-counting already
  // relies on elsewhere in this file. §8 (safety valve) is the sample's ~25 blank dotted fill-in
  // lines with no backing data anywhere in this app — reduced to the one line that states the actual
  // fact (a certificate is enclosed) rather than reproducing empty lines with no informational value.
  const partNames = parts.map(p => p.part_name).join(', ') || '—';
  const drawingRange = d.approved_drawing_codes?.join(', ') || '—';
  return (
    <Page size="A4" style={s.page}>
      <Header entity={entity} />
      <Text style={s.title}>FORM III</Text>
      <Text style={s.sub}>CONSTRUCTION CERTIFICATES OF MANUFACTURE AND TEST · (REGULATION 4 (C) II)</Text>
      <Text style={s.docId}>{d.doc_id}</Text>

      <Text style={s.h}>1. DESCRIPTION</Text>
      <KV label="Constructor's name and address" value={`${entity.name}, ${entity.address}`} />
      <KV label="Manufactured For/Stock Purposes" value={project?.customer_name || 'STOCK'} />
      <KV label="Type of Boiler" value={d.boiler_type} />
      <KV label="Length overall" value={d.length_overall} />
      <KV label="Diameter inside largest belt" value={d.internal_diameter} />
      <KV label="Design Pressure" value={d.design_pressure} />
      <KV label="Hydro Test pressure" value={d.hydro_test_pressure} />
      <KV label="Maker's No. of Boiler" value={d.makers_no} />
      <KV label="Year of Make" value={d.year_of_make} />
      <KV label="Total heating surface area" value={d.heating_surface} />
      <KV label="Evaporation Capacity" value={d.evaporation_capacity} />
      <KV label="Final Temp. of Steam (Superheater outlet)" value={d.steam_temp} />
      <KV label="Brief Description of Boiler" value={d.boiler_type} />

      <Text style={s.h}>2. Name of the part(s) manufactured at constructor's works</Text>
      <Text style={{ fontSize: 8, marginBottom: 6 }}>{partNames}</Text>
      <KV label="Drawing no." value={drawingRange} />
      <KV label="Manufactured by" value={entity.name} />
      <KV label="Identification Mark" value={d.makers_no} />
      <Text style={{ fontSize: 8, marginTop: 4 }}>Part(s) manufactured, Inspected at all stages of Construction by ……………………………….</Text>
      <Text style={{ fontSize: 8, marginTop: 6 }}>Part(s) hydraulically tested and inspected after test by ……………………………….</Text>

      <Text style={s.h}>3. PARTS MANUFACTURED OUTSIDE THE CONSTRUCTOR'S WORKS</Text>
      <Text style={{ fontSize: 8 }}>NOT APPLICABLE</Text>

      <Text style={s.h}>4. CONSTRUCTION</Text>
      <Text style={{ fontSize: 8 }}>The construction is in accordance with chapter III / V / X / XII / XIV of the Indian Boiler Regulations.</Text>
      <Text style={{ fontSize: 8 }}>No. of longitudinal seams in shell/drum in each belt – ONE</Text>
      <Text style={{ fontSize: 8 }}>No. of longitudinal seams in Furnace in each ring – ONE</Text>
      <Text style={{ fontSize: 8 }}>No. of circumferential seams in shell/drum (including end seams) – NO</Text>
      <Text style={{ fontSize: 8 }}>No. of circumferential seams in the furnace – NO</Text>
      <Text style={{ fontSize: 8, marginTop: 4 }}>All welded seams were subjected to Radiographic examination to the satisfaction of the Inspecting Authority where required.</Text>

      <Text style={s.h}>5. Details of Drums</Text>
      <Text style={{ fontSize: 8 }}>Not Applicable</Text>

      <Text style={s.h}>6. Headers and Boxes</Text>
      <Text style={{ fontSize: 8 }}>Not Applicable</Text>

      <Text style={s.h}>7. MOUNTINGS</Text>
      <Text style={{ fontSize: 8 }}>See the enclosed List of Mountings &amp; Fittings{pageRangeLabel(mountingsPage)}.</Text>

      <Text style={s.h}>8. Details of Safety Valves and Test Results (Regulation 4(c)(vii))</Text>
      <Text style={{ fontSize: 8 }}>Safety valve test certificate enclosed with annexure.</Text>

      <Text style={s.h}>9. Certificate</Text>
      <Text style={{ fontSize: 8, marginBottom: 4 }}>
        Certified that the particulars entered herein are correct and that parts and fittings against
        the names of which entries are made have been used in the construction and fitting of the boiler.
      </Text>
      <Text style={{ fontSize: 8, marginBottom: 4 }}>
        The particulars shown against the various parts used are in accordance with the enclosed
        certificate from the respective makers.
      </Text>
      <Text style={{ fontSize: 8, marginBottom: 4 }}>The design of the boiler is that shown in Drawing Nos. {drawingRange}.</Text>
      <Text style={{ fontSize: 8 }}>
        The boiler has been designed and constructed to comply with the regulations under the Indian
        Boilers Act, 1923 for a Working Pressure of {d.design_pressure || '—'} Kgf/cm²(g) at our works
        above named and satisfactorily withstood a water (Hydraulic) test of {d.hydro_test_pressure || '—'} Kgf/cm²(g)
        {d.hydro_test_date ? ` on ${d.hydro_test_date}` : ''} in the presence of our responsible
        representative whose signature is appended hereunder.
      </Text>
      {/* Sample's own line (e.g. "Least pressure of this component (Furnace) – 11.05 kgf/cm²") — the
          governing component and its least-pressure figure come from the design calc, which has no
          home on qc_documents; shown with a dash rather than fabricated or silently dropped. */}
      <Text style={{ fontSize: 8, marginTop: 4 }}>Least pressure of this component – —</Text>

      <SignFormIII entity={entity} />
      <Footer entity={entity} />
    </Page>
  );
}

// Form III-H's own page — NOT built on the generic FormTablePage below, because the real sample's
// header block (T.C. No, Design Pressure/Temp, Hydraulic Test Pressure, NDT, Inspecting Authority ID
// Mark) is genuinely richer than IIIA/IVA's plain "doc_id · Maker's No" line; forcing it through the
// generic page would silently drop real fields. Portrait, not landscape — IIIH_COLS is only 5 columns.
function FormIIIHPage({ document: d, entity, parts, project }) {
  return (
    <Page size="A4" style={s.page}>
      <Header entity={entity} />
      <Text style={s.title}>FORM III-H</Text>
      <Text style={[s.docId, { marginBottom: 4 }]}>
        Certificate of Manufacture and Test for (Headers, Desuperheaters/Attemperator, Blowdown Tank,{'\n'}
        Feed Water Tanks, Accumulator, Deaerator)
      </Text>
      {/* T.C. No.: the real samples show this as a specific linked certificate's own number in one
          case, not consistently the document's own id — defaulting to doc_id here, flagged to the
          user as unresolved (plan §3) rather than guessed differently. */}
      <KV label="T.C. No." value={d.doc_id} />
      <KV label="Name of the Part" value={d.boiler_type} />
      <KV label="Maker's Name & Address" value={entity.name} />
      <KV label="Customer's Name & Address" value={project?.customer_name} />
      <KV label="Drawing No." value={d.approved_drawing_codes?.join(', ')} />
      <KV label="Design Pressure (Kg/cm²)" value={d.design_pressure} />
      <KV label="Design Temp. (°C)" value={d.steam_temp} />
      <KV label="Heat Treatment" value="Refer enclosed Test certificates" />
      <KV label="Hydraulic Test Pressure" value={d.hydro_test_pressure} />
      <KV label="Non-destructive Testing" value="Refer enclosed Test certificates" />
      <KV label="Inspecting Authority Identification Mark" value="" />
      <Text style={{ marginTop: 6, marginBottom: 4, fontSize: 7, color: '#555' }}>
        Process of Manufacture, Material condition, chemical composition, Tensile Strength, Tolerances,
        Bend Test, Flattening Test etc. — Refer enclosed Raw material Test Certificates or Form IV-A in
        lieu of Raw material Test Certificates.
      </Text>
      <Table cols={IIIH_COLS} parts={parts} />
      <Text style={{ marginTop: 10, fontSize: 8, lineHeight: 1.4 }}>
        Certified that the particulars entered herein are correct. The parts have been constructed to
        comply with the Indian Boiler Regulations for a working pressure of {d.design_pressure || '—'} and
        temperature of {d.steam_temp || '—'} and satisfactorily withstood a water test of {d.hydro_test_pressure || '—'} in
        the presence of our responsible representative whose signature is appended hereunder.
      </Text>
      <SignIIIH entity={entity} document={d} />
      <Footer entity={entity} />
    </Page>
  );
}

// P.No is a stored sort key (see qc-bom-sync.js's sortOrder), not a display index — a form's own
// numbering must run 1..n within whatever subset of parts it actually shows (the sample's Form IV A
// numbering skips the rows pulled out into Form III A), so it's recomputed here per render, per form,
// never written back to qc_document_parts.
const renumber = parts => parts.map((p, i) => ({ ...p, part_no: String(i + 1) }));

function FormTablePage({ document: d, entity, title, cols, parts }) {
  return (
    <Page size="A4" orientation="landscape" style={s.pageL}>
      <Header entity={entity} />
      <Text style={s.title}>{title}</Text>
      <Text style={s.docId}>{d.doc_id} · Maker's No. {d.makers_no || '—'}</Text>
      <Table cols={cols} parts={renumber(parts)} />
      <Sign entity={entity} />
      <Footer entity={entity} />
    </Page>
  );
}

// Form III A — a per-named-sub-assembly certificate (real sample SB-1097's "Feed pipeline"), NOT a
// copy of Form IV A: its own header block (design pressure/temp genuinely differ from the boiler's —
// the sample's feed pipeline is 8.75 kg/cm² against a 7 kg/cm² boiler) plus a materials table scoped
// to only that group's own parts. Table columns are IVA_COLS (identical to Form IV A — the sample's
// 3A table has the same columns as 4A; Process of Manufacture/Heat Treatment live in the header here,
// not as extra table columns).
function FormIIIAGroupPage({ document: d, entity, group: g, parts }) {
  // parseFloat, not Number — design_pressure is a free-text field (QC may type "7 Kgf/cm2" rather
  // than a bare "7"); Number() on that returns NaN and would print the literal string "NaN" into the
  // PDF's attestation paragraph. Number.isFinite guards the derived value the same way.
  const designPressureNum = parseFloat(g.design_pressure);
  const derivedHydro = Number.isFinite(designPressureNum) ? (designPressureNum * 1.5).toFixed(3).replace(/0+$/, '').replace(/\.$/, '') : null;
  const hydroPressure = g.hydro_test_pressure || derivedHydro;
  return (
    <Page size="A4" orientation="landscape" style={s.pageL}>
      <Header entity={entity} />
      <Text style={s.title}>FORM III A — CERTIFICATE OF MANUFACTURE AND TEST</Text>
      <Text style={s.docId}>{d.doc_id} · Maker's No. {d.makers_no || '—'} · Name of the part: {g.name}</Text>
      <KV label="Maker's Name & Address" value={entity.name} />
      <KV label="Design Pressure" value={g.design_pressure ? `${g.design_pressure} Kgf/cm²(g)` : null} />
      <KV label="Design Temperature" value={g.design_temp} />
      <KV label="Process of Manufacture" value={g.process_of_manufacture} />
      <KV label="Mode of Attachment of Flanges" value={g.mode_of_flange_attachment} />
      <KV label="Flange Particulars" value={g.flange_particulars} />
      <KV label="Size of Branch & Attachment" value={g.size_of_branch} />
      <KV label="Heat Treatment" value={g.heat_treatment} />
      <KV label="Identification Marks" value={g.identification_marks} />
      <KV label="Drawing No." value={g.linked_drawing_dg_no || g.drawing_no} />
      <Table cols={IVA_COLS} parts={renumber(parts)} />
      <Text style={{ marginTop: 8, fontSize: 7, lineHeight: 1.4 }}>
        Certified that the particulars entered herein are correct. The part has been designed and
        constructed to comply with the Indian Boiler Regulations for a working pressure of {g.design_pressure || '—'} Kgf/cm²(g)
        {g.design_temp ? ` & temperature ${g.design_temp}` : ''} & satisfactorily withstood a water test of {hydroPressure || '—'} Kgf/cm²(g)
        {g.hydro_test_date ? ` on dated ${g.hydro_test_date}` : ''} in the presence of our responsible representative.
      </Text>
      <Sign entity={entity} />
      <Footer entity={entity} />
    </Page>
  );
}

// ---- Assembly ------------------------------------------------------------

// Renders one section (a form, or the mounting list) as its own tiny standalone PDF purely to learn
// how many PHYSICAL pages it becomes — a long Form IV A table auto-paginates across continuation
// pages inside @react-pdf/renderer, so the real count isn't knowable from row count alone, only by
// actually rendering it. The buffer is reused for the final merge below, so nothing renders twice.
async function renderSection(pageOrPages) {
  const pages = (Array.isArray(pageOrPages) ? pageOrPages : [pageOrPages]).filter(Boolean);
  if (!pages.length) return { buf: null, pageCount: 0 };
  const buf = await renderToBuffer(<Document>{pages}</Document>);
  const pageCount = (await PDFDocument.load(buf)).getPageCount();
  return { buf, pageCount };
}

// Client requirement: the folder ends with the source TC PDFs themselves, appended after the last
// statutory form. Our own pages come from @react-pdf/renderer (which only ever CREATES a PDF, never
// merges existing ones); each cert's own uploaded PDF is a separate file in R2, so pdf-lib does the
// actual append, in the same order parts appear on the document. A cert used by several parts is only
// appended once; a cert with no PDF on file is skipped silently (nothing to append).
//
// Split into load (fetch + parse, once) and merge (copy pages) so the manifest's own "Test
// Certificates (Page X to Y)" line can know the total page count BEFORE the covering letter is
// written, without fetching every cert's PDF from R2 twice.
async function loadCertPdfs(parts) {
  const seen = new Set();
  const files = [];
  for (const p of parts) {
    if (!p.test_certificate_id || !p.pdf_key || seen.has(p.test_certificate_id)) continue;
    seen.add(p.test_certificate_id);
    try {
      const bytes = await getObjectBuffer(p.pdf_key);
      const doc = await PDFDocument.load(bytes);
      files.push({ certificateId: p.test_certificate_id, doc, pageCount: doc.getPageCount() });
    } catch (err) {
      // A missing/corrupt R2 object for one cert shouldn't fail the whole folder — the statutory
      // forms are the legally-required part; the source TC copy is a convenience attachment.
      console.error(`qc-folder-pdf: couldn't load TC PDF for certificate ${p.test_certificate_id}`, err);
    }
  }
  return files;
}

async function mergeCertPdfs(out, certFiles) {
  for (const c of certFiles) {
    (await out.copyPages(c.doc, c.doc.getPageIndices())).forEach(pg => out.addPage(pg));
  }
}

export async function renderQcFolderPdf(document, parts, mountings, project, groups) {
  const d = document;
  mountings = mountings || [];
  groups = groups || [];
  const entity = entityForMaker(d.makers_no);
  // Form set follows the PROJECT's equipment model (projects.series); the document's own `series`
  // is a legacy default ('SF') and not authoritative here.
  const model = modelConfig(project?.series || d.series);
  // Mutually exclusive by construction (lib/qc-bom-sync.js's iiia_group_id) — a grouped part never
  // also appears on Form IV A, which is what stops the two forms from rendering identically.
  const ungrouped = parts.filter(p => !p.iiia_group_id);
  const formPage = (f, extra) => {
    switch (f) {
      case 'II1': return <FormII1Page key={f} document={d} entity={entity} />;
      case 'XVII': return <FormII1Page key={f} document={d} entity={entity} small />;
      case 'III': return <FormIIIPage key={f} document={d} entity={entity} project={project} model={model} parts={parts} mountingsPage={extra?.mountingsPage} />;
      // Zero groups -> render nothing for this form, never fall back to dumping every part (that
      // would silently reproduce Form III A == Form IV A, the exact bug this feature fixes).
      case 'IIIA': return groups.map(g => (
        <FormIIIAGroupPage key={`iiia-${g.id}`} document={d} entity={entity} group={g}
          parts={parts.filter(p => p.iiia_group_id === g.id)} />
      ));
      case 'IVA': return <FormTablePage key={f} document={d} entity={entity} title="FORM IV A — REGULATION 4 (c) (IV)" cols={IVA_COLS} parts={ungrouped} />;
      case 'IIIH': return <FormIIIHPage key={f} document={d} entity={entity} project={project} parts={parts} />;
      default: return null;
    }
  };

  // Render every form and the mounting list first — independently of the covering letter, which
  // needs to know their page numbers before it can be written. The covering letter is page 1 (the
  // client-requested label page has been removed), so everything else's numbering follows it. Form
  // III itself is a probe here too — its own page count feeds the cursor math below — since its
  // final content (referencing the mounting list's page number) isn't known until after that math
  // runs; it gets re-rendered further down once pageRanges.mountings exists.
  const formSections = await Promise.all(model.forms.map(async f => ({ key: f, ...(await renderSection(formPage(f))) })));
  const mountingsSection = await renderSection(<MountingListPage document={d} mountings={mountings} entity={entity} />);
  // Fetched once — reused for both the page-count math below and the final merge, never re-fetched.
  const certFiles = await loadCertPdfs(parts);
  const certPageCount = certFiles.reduce((n, c) => n + c.pageCount, 0);

  function computeRanges(letterPageCount) {
    let cursor = 1 + letterPageCount;
    const ranges = {};
    for (const sec of formSections) {
      if (!sec.pageCount) continue; // Form III A with zero groups — nothing to number
      ranges[sec.key] = { start: cursor, end: cursor + sec.pageCount - 1 };
      cursor += sec.pageCount;
    }
    if (mountingsSection.pageCount) {
      ranges.mountings = { start: cursor, end: cursor + mountingsSection.pageCount - 1 };
      cursor += mountingsSection.pageCount;
    }
    if (certPageCount) ranges.certificates = { start: cursor, end: cursor + certPageCount - 1 };
    return ranges;
  }

  // Two things reference page numbers that depend on the OVERALL layout, and can in turn change the
  // overall layout themselves: the letter's own manifest text (longer once real page ranges are
  // filled in, which could push it onto a second page) and Form III's one line citing the mounting
  // list's page (same risk, in principle). Either changing shifts every section that comes after it,
  // so both are re-rendered together in one joint fixed-point loop until NEITHER page count moves —
  // not just the letter — otherwise a shift in Form III's own page count would silently go unnoticed
  // and leave every later section's stated range off by however many pages it grew by. Capped at 5
  // tries as a guard against a pathological back-and-forth, not an expected case: a few digits of
  // page-number text changing a page count more than once in practice doesn't happen, but the loop
  // makes that guaranteed rather than assumed.
  const iiiSection = formSections.find(sec => sec.key === 'III');
  let letterPageCount = (await renderSection(
    <CoveringLetterPage document={d} project={project} entity={entity} model={model} parts={parts} mountings={mountings} />)).pageCount;
  let letter;
  let iiiFinalBuf = null;
  for (let i = 0; i < 5; i++) {
    const pageRanges = computeRanges(letterPageCount);
    letter = await renderSection(
      <CoveringLetterPage document={d} project={project} entity={entity} model={model} parts={parts} mountings={mountings} pageRanges={pageRanges} />);

    let iiiChanged = false;
    if (iiiSection?.pageCount && pageRanges.mountings) {
      const iiiFinal = await renderSection(formPage('III', { mountingsPage: pageRanges.mountings }));
      iiiFinalBuf = iiiFinal.buf;
      if (iiiFinal.pageCount !== iiiSection.pageCount) {
        iiiSection.pageCount = iiiFinal.pageCount; // feeds the next computeRanges() call
        iiiChanged = true;
      }
    }

    const letterChanged = letter.pageCount !== letterPageCount;
    letterPageCount = letter.pageCount;
    if (!letterChanged && !iiiChanged) break;
  }

  const finalSections = formSections.map(sec => (sec.key === 'III' && iiiFinalBuf ? { ...sec, buf: iiiFinalBuf } : sec));

  const out = await PDFDocument.load(letter.buf);
  for (const sec of finalSections) {
    if (!sec.buf) continue;
    const src = await PDFDocument.load(sec.buf);
    (await out.copyPages(src, src.getPageIndices())).forEach(pg => out.addPage(pg));
  }
  // Mountings & Fittings last — matches the sample workbook's sheet order (Form 2/3/3A/4, then
  // Mountings & Fittings), and the client's explicit instruction to close the folder with it.
  if (mountingsSection.buf) {
    const src = await PDFDocument.load(mountingsSection.buf);
    (await out.copyPages(src, src.getPageIndices())).forEach(pg => out.addPage(pg));
  }
  await mergeCertPdfs(out, certFiles);

  return Buffer.from(await out.save());
}