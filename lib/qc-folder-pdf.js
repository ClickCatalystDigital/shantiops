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
import { buildLetteredSections } from './qc-form4a-sections.mjs';

const s = StyleSheet.create({
  // paddingBottom carved out for the fixed Footer (~40pt) so body content never collides with it.
  page: { paddingTop: 28, paddingHorizontal: 28, paddingBottom: 56, fontSize: 8, fontFamily: 'Helvetica', color: '#111', lineHeight: 1.4 },
  pageL: { paddingTop: 24, paddingHorizontal: 24, paddingBottom: 46, fontSize: 7, fontFamily: 'Helvetica', color: '#111' },
  center: { textAlign: 'center' },
  company: { fontSize: 12, fontWeight: 'bold' },
  sub: { fontSize: 7, color: '#555', marginTop: 2, textAlign: 'center' },
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
  // Form II(1)'s real sign-off has no border line above the captions, unlike every other form's
  // Sign()/SignFormIII() boxes — a plain variant instead of a signBox override per call site.
  signBoxPlain: { width: '40%', textAlign: 'center', fontSize: 7 },
  // A real printed rule, e.g. the box framing Form II(1)'s Maker's-info block — distinct from the
  // lighter #ddd/#999 table borders above.
  // A real printed rule (e.g. framing Form II(1)'s Maker's-info block). Checked across three live
  // renders — an empty View relying on `borderTop` alone never rendered visibly at this size, so
  // this is a guaranteed-visible filled 1pt bar instead of a border on zero content.
  hr: { height: 1, backgroundColor: '#000', marginVertical: 4 },
  // The right-aligned project-code line (e.g. "STF-IBR-045-CF-400-15") every real sample shows
  // below its title block — deliberately its OWN style, never touching the shared `docId` above,
  // which 8 other page renders already use for unrelated content (see SYSTEM.md's own audit of this).
  code: { fontSize: 9, fontWeight: 'bold', textAlign: 'right', marginTop: 6, marginBottom: 8 },
  // A genuinely filled-in/variable value — bold black, not colored (direct instruction: nothing in
  // this generator should render in red). Opt-in via this style (KV's own `filled` prop), never the
  // default, so out-of-scope pages/forms that reuse KV/Table are untouched.
  filled: { fontWeight: 'bold' },
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
// Form III A's own table — the real sample has 2 more columns than Form IV A (Steel Making Process,
// Heat Treatment), both already real, stored per-certificate columns (test_certificates.
// steel_making_process/heat_treatment) already joined onto every part row — this is a column-list
// fix only, no schema/data change. Built by splicing a fresh copy of IVA_COLS's cell getters (same
// data source, same order) rather than duplicating them by hand, so a future shared getter/label
// change only has to happen once — but with its own, narrower width numbers, since 20 columns need
// to sum to 100% where 18 summed to ~98%. IVA_COLS itself is never mutated — Form IV A must keep
// rendering its own unchanged 18 columns at their own unchanged widths.
const IIIA_WIDTHS = { 'P.No': 3, Part: 11, 'Cast No': 6, 'Plate No': 6, Size: 7, Qty: 3, Spec: 6,
  'Steel Maker': 7, 'Cert No': 10, C: 3, Mn: 3, P: 3, S: 3, Si: 3, 'Y.S': 3, UTS: 3, 'El %': 3, Bend: 3 };
const IIIA_COLS = (() => {
  const cols = IVA_COLS.map(([label, , get]) => [label, IIIA_WIDTHS[label], get]);
  const certNoIdx = cols.findIndex(c => c[0] === 'Cert No');
  cols.splice(certNoIdx + 1, 0, ['Steel Making Process', 8, p => p.steel_making_process || '—']);
  const siIdx = cols.findIndex(c => c[0] === 'Si');
  cols.splice(siIdx + 1, 0, ['Heat Treatment', 6, p => p.heat_treatment || '—']);
  return cols;
})();
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
      {/* `fixed` repeats this header row on every physical page this table's own auto-pagination
          spans (react-pdf scopes `fixed` to the enclosing <Page>, same mechanism Header/Footer
          already use) — a long Form IV A/III A table used to lose its column headers on every
          continuation page after the first. */}
      <View style={s.tHead} fixed>
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

// `labelWidth` overrides `s.lbl`'s default 150pt for a call site with short labels (Form II(1)'s
// "Maker's Name"/"W.P." etc), so the value sits close to its label instead of stranded after a wide
// fixed gap — never changing `s.lbl` itself, since other callers (e.g. Form III's much longer labels)
// genuinely need the wider default.
function KV({ label, value, filled, labelWidth }) {
  return <View style={s.row}><Text style={labelWidth ? [s.lbl, { width: labelWidth }] : s.lbl}>{label}</Text><Text style={filled ? [s.val, s.filled] : s.val}>: {value || '—'}</Text></View>;
}

// Two label:value pairs sharing one row — the real Form II(1) sample does this twice (Maker's No. /
// Year of Make; Tested To / its date) instead of KV's usual one-pair-per-row layout.
function KV2({ a, b, labelWidth }) {
  const lblStyle = labelWidth ? [s.lbl, { width: labelWidth }] : s.lbl;
  return (
    <View style={{ flexDirection: 'row' }}>
      <View style={{ flexDirection: 'row', flex: 1 }}>
        <Text style={lblStyle}>{a.label}</Text>
        <Text style={[s.val, s.filled]}>: {a.value || '—'}</Text>
      </View>
      {b ? (
        <View style={{ flexDirection: 'row', flex: 1 }}>
          <Text style={lblStyle}>{b.label}</Text>
          <Text style={[s.val, s.filled]}>: {b.value || '—'}</Text>
        </View>
      ) : null}
    </View>
  );
}

function Sign({ entity }) {
  return (
    <View style={s.signRow} wrap={false}>
      <Text style={s.signBox}>Maker's Representative</Text>
      <Text style={s.signBox}>For {entity.name}.{'\n'}Maker / Authorized Signatory</Text>
    </View>
  );
}

// Form III's COMPONENT (non-boiler) filing sign-off — the original real captions, sourced from that
// filing's own sample sheet (per the original comment here: "Sheet1 of the client's sample"), which
// this session never re-verified. Kept byte-for-byte as it was, only adding the same pagination
// guard every sign-off in this file now gets. Used ONLY by FormIIIPage's component branch.
function SignFormIIIComponent({ entity }) {
  return (
    <View wrap={false}>
      <View style={s.signRow}>
        <Text style={s.signBox}>Sign of Engineer</Text>
        <Text style={s.signBox}>Maker</Text>
      </View>
      <View style={[s.signRow, { marginTop: 8 }]}>
        <Text style={s.signBox}>Inspector of Boilers</Text>
        <Text style={s.signBox}>Director of Boilers</Text>
      </View>
    </View>
  );
}

// Form III's BOILER filing sign-off — TWO distinct blocks in the real CF boiler sample (a maker's-
// own-representative pair, then a separate competent-person/inspecting-authority pair + a "Dated...
// the day of..." line). Used ONLY by FormIIIPage's boiler branch — this used to share one function
// (and one, wrong, set of captions) with the component branch above; split apart once the real
// boiler-sample captions turned out to be genuinely different from the component-filing ones.
function SignFormIII({ entity }) {
  return (
    <View wrap={false}>
      <View style={s.signRow}>
        <Text style={s.signBox}>Maker's Representative{'\n'}(Name, signature and Stamp)</Text>
        <Text style={s.signBox}>Maker{'\n'}(Name, signature and Stamp)</Text>
      </View>
      <View style={[s.signRow, { marginTop: 20 }]}>
        <Text style={s.signBox}>Name, signature and Stamp{'\n'}of Competent person</Text>
        <Text style={s.signBox}>Name, signature and Stamp of{'\n'}Inspecting authority</Text>
      </View>
      <Text style={{ fontSize: 7, marginTop: 10, textAlign: 'center' }}>Dated ................... the day of .................</Text>
    </View>
  );
}

// Form III-H's real sign-off (both FORM3H sample sheets) — genuinely two independent stages, each
// with its own attestation paragraph, not one shared block like every other form here.
function SignIIIH({ entity, document: d }) {
  return (
    <View wrap={false}>
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
    </View>
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
  // Physical order is forms -> mountings -> appended TC PDFs (renderQcFolderPdf's own assembly),
  // so the manifest must list mountings before test certificates too — it previously listed them
  // in the opposite order, disagreeing with the real page numbers right next to each line.
  if (mountings.length) lines.push(`List of mountings${pageRangeLabel(pageRanges.mountings)}`);
  // Only count a certificate the letter can actually back up with a real enclosed page — a part
  // linked to a certificate record that has no pdf_key yet (a normal, supported state, see TcBank's
  // "PDF not uploaded" badge) must not be claimed as enclosed. Same two-field gate loadCertPdfs()
  // already uses on this identical `parts` array, just applied here too instead of only there.
  const certCount = new Set(parts.filter(p => p.test_certificate_id && p.pdf_key).map(p => p.test_certificate_id)).size;
  if (certCount) lines.push(`Test Certificates – ${certCount} no's${pageRangeLabel(pageRanges.certificates)}`);
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
      {/* This page renders its own header row instead of reusing the shared `Table` component, so
          the `fixed` fix applied there for Form IV A/III A's multi-page tables never reached this
          one — same bug, same fix, applied directly here since this list also regularly spans
          several pages. */}
      <View style={s.tHead} fixed>
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
  const drawingRange = d.approved_drawing_codes?.join(', ') || '—';
  return (
    <Page size="A4" style={s.page}>
      <Header entity={entity} />
      {/* Real sample: one centered 5-line title stack (title, sub-heading, regulation cite,
          authority designation, authority name) with no letterhead of its own — this app keeps the
          shared company Header above it (a deliberate app-wide choice, not changed here) but folds
          the rest into one centered stack, matching the real arrangement below it. */}
      <Text style={s.title}>FORM – II (1)</Text>
      <Text style={s.sub}>CERTIFICATE OF INSPECTION FOR SHOP ASSEMBLED BOILERS</Text>
      <Text style={s.sub}>[REGULATION 4 (C) (i)]</Text>
      <Text style={[s.sub, { fontWeight: 'bold', marginTop: 6 }]}>DESIGNATION OF INSPECTING AUTHORITY</Text>
      <Text style={[s.sub, { fontWeight: 'bold' }]}>{authorityDesignation}</Text>
      <Text style={s.code}>{d.doc_id}</Text>
      <Text style={s.p}>
        We hereby certify that the <Text style={s.filled}>{d.boiler_type || '—'}</Text> built by M/s. <Text style={s.filled}>{entity.name}, {entity.address}</Text>. Under
        Maker's Number <Text style={s.filled}>{d.makers_no || '—'}</Text> was constructed under our supervision at inspected at various
        stages of construction by the Competent person and that the construction and workmanship were
        satisfactory and in accordance with standard conditions for the design and construction of boilers
        as per regulation framed under boilers Act, 1923.
      </Text>
      <Text style={s.p}>The boiler is stamped on the............ shell plate with stamp as shown here under:</Text>
      <View style={s.hr} />
      <KV label="Maker's Name" value={entity.name} filled labelWidth={95} />
      <Text style={{ fontSize: 8, marginLeft: 95, marginTop: -3, fontWeight: 'bold' }}>{entity.address}</Text>
      <KV2 a={{ label: "Maker's No.", value: d.makers_no }} b={{ label: 'Year of Make', value: d.year_of_make }} labelWidth={95} />
      <KV2 a={{ label: 'Tested To', value: d.hydro_test_pressure ? `${d.hydro_test_pressure} Kg/cm²` : null }} b={{ label: 'On', value: d.hydro_test_date }} labelWidth={95} />
      <KV label="W.P." value={d.working_pressure} filled labelWidth={95} />
      <Text style={[s.sub, { fontWeight: 'bold', marginTop: 8 }]}>COMPETENT PERSON'S OR INSPECTING</Text>
      <Text style={[s.sub, { fontWeight: 'bold' }]}>AUTHORITY'S OFFICIAL STAMP:</Text>
      <View style={s.hr} />
      <Text style={s.p}>
        {'\n'}The boiler on completion was subjected to a Hydrostatic test pressure of <Text style={s.filled}>{d.hydro_test_pressure || '—'} Kg/cm² (g)</Text>
        in the presence of Inspecting Officer{d.hydro_test_date ? <Text style={s.filled}> on {d.hydro_test_date}</Text> : null} and satisfactorily withstood the test.
      </Text>
      <Text style={s.p}>All welded seams were subjected to destructive and non-destructive examination where applicable and found satisfactory.</Text>
      {/* Previously missing entirely — the real sample's closing paragraph before signatures. */}
      <View wrap={false}>
        <Text style={s.p}>
          We have satisfied ourselves that the construction and dimension of the boiler are as shown in
          the Maker's Drawing number <Text style={s.filled}>{drawingRange}</Text> signed by us, and that the particulars entered in
          the maker's certificate of manufacture in Form III countersigned by us, are correct to the
          best of our knowledge and belief. Strike out what is not applicable.
        </Text>
        {/* Form II(1) is the INSPECTION certificate — signed by the Competent Person and Inspecting
            Authority, not the constructor's own maker's-rep/maker pair the generic Sign() renders
            (that one is correct on Form III/IV A/III A, wrong here) — its own real captions, no
            border box, matching the real sample exactly. */}
        <View style={s.signRow}>
          <Text style={s.signBoxPlain}>Signature of Competent Person</Text>
          <Text style={s.signBoxPlain}>Signature of inspecting Authority</Text>
        </View>
        {/* Sits under the right (Inspecting Authority) column specifically, not centered/left across
            the whole row — matching the real sample's placement. */}
        <View style={{ flexDirection: 'row', marginTop: 10 }}>
          <Text style={{ width: '60%' }}> </Text>
          <Text style={{ width: '40%', fontSize: 7, textAlign: 'center' }}>Date And Seal</Text>
        </View>
      </View>
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
        <SignFormIIIComponent entity={entity} />
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
      <Text style={s.sub}>CONSTRUCTION CERTIFICATES OF MANUFACTURE AND TEST</Text>
      <Text style={s.sub}>(REGULATION 4 (C) II)</Text>
      <Text style={s.code}>{d.doc_id}</Text>

      {/* Real sample indents every field label one tab right of its own "N. HEADING" — a two-level
          outline, not the flat single-margin list this used to be. */}
      <Text style={s.h}>1. DESCRIPTION</Text>
      <View style={{ marginLeft: 20 }}>
        <KV label="Constructor's name and address" value={`${entity.name}, ${entity.address}`} filled />
        <KV label="Manufactured For/Stock Purposes" value={project?.customer_name || 'STOCK'} filled />
        <KV label="Type of Boiler" value={d.boiler_type} filled />
        <KV label="Length overall" value={d.length_overall} filled />
        <KV label="Diameter inside largest belt" value={d.internal_diameter} filled />
        <KV label="Design Pressure" value={d.design_pressure} filled />
        <KV label="Hydro Test pressure" value={d.hydro_test_pressure} filled />
        <KV label="Maker's No. of Boiler" value={d.makers_no} filled />
        <KV label="Year of Make" value={d.year_of_make} filled />
        <KV label="Total heating surface area" value={d.heating_surface} filled />
        <KV label="Evaporation Capacity" value={d.evaporation_capacity} filled />
        <KV label="Final Temp. of Steam (Superheater outlet)" value={d.steam_temp} filled />
        <KV label="Brief Description of Boiler" value={d.boiler_type} filled />
      </View>

      {/* Real sample runs the heading, colon, and full part-name list into one wrapping sentence
          rather than a heading line followed by a separate value line. */}
      <Text style={{ fontSize: 8, marginTop: 8, marginBottom: 4 }}>
        <Text style={{ fontWeight: 'bold' }}>2. Name of the part(s) manufactured at constructor's works: </Text>
        <Text style={s.filled}>{partNames}</Text>
      </Text>
      <KV label="Drawing no." value={drawingRange} filled />
      <KV label="Manufactured by" value={entity.name} filled />
      <KV label="Identification Mark" value={d.makers_no} filled />
      <Text style={{ fontSize: 8, marginTop: 4 }}>Part(s) manufactured, Inspected at all stages of Construction by ………………………………. (Inspecting authority)</Text>
      <Text style={{ fontSize: 8, marginTop: 6 }}>Part(s) hydraulically tested and inspected after test by ……………………………….</Text>

      <Text style={s.h}>3. PARTS MANUFACTURED OUTSIDE THE CONSTRUCTOR'S WORKS</Text>
      <Text style={{ fontSize: 8 }}>NOT APPLICABLE</Text>

      <Text style={s.h}>4. CONSTRUCTION</Text>
      <Text style={{ fontSize: 8 }}>The construction is in accordance with chapter III / V / X / XII / XIV of the Indian Boiler Regulations.</Text>
      {/* These used to be hardcoded (ONE/ONE/NO/NO) and didn't even match the real reference sample
          (ONE/TWO/NA/ONE/NA) — no per-belt/furnace/circumferential seam data exists on qc_documents
          today, so an honest "—" replaces the invented values (same pattern as "Least pressure of
          this component" below) rather than certifying a fact this app doesn't actually know. */}
      <Text style={{ fontSize: 8 }}>No. of longitudinal seams in shell/drum in each belt – —</Text>
      <Text style={{ fontSize: 8 }}>No. of longitudinal seams in Furnace in each ring – —</Text>
      <Text style={{ fontSize: 8 }}>No. of circumferential seams in shell/drum (including end seams) – —</Text>
      <Text style={{ fontSize: 8 }}>No. of circumferential seams in the furnace – —</Text>
      <Text style={{ fontSize: 8 }}>Details of repair, if any, carried out to seams during construction – —</Text>
      <Text style={{ fontSize: 8 }}>Details of heat treatment – —</Text>
      <Text style={{ fontSize: 8, marginTop: 4 }}>All welded seams were subjected to Radiographic examination to the satisfaction of the Inspecting Authority where required.</Text>

      <Text style={s.h}>5. Details of Drums</Text>
      <Text style={{ fontSize: 8 }}>Not Applicable</Text>

      <Text style={s.h}>6. Headers and Boxes</Text>
      <Text style={{ fontSize: 8 }}>Not Applicable</Text>

      <Text style={s.h}>7. MOUNTINGS</Text>
      {/* Real sample names an enclosed "Form III C" explicitly, not a generic "list" phrase — SYSTEM.md
          flags this as an unconfirmed form name (no sample of it exists), so the wording matches the
          real sample's own phrasing without implying a distinct generator exists yet. */}
      <Text style={{ fontSize: 8 }}>Mountings' Form III C are enclosed{pageRangeLabel(mountingsPage)}.</Text>

      <Text style={s.h}>8. Details of Safety Valves and Test Results (Regulation 4(c)(vii))</Text>
      {/* The real sample keeps this whole blank field template even when the actual data lives in an
          attached Annexure — restoring it (was reduced to one summary sentence) so the section reads
          the same as the government form. No real field on qc_documents backs any of these individual
          values, so every line stays a dotted blank, same convention as the rest of this page. */}
      {/* Each labeled sub-block wrapped in wrap={false} — a long single <Page> auto-paginating this
          much text was splitting mid-list (e.g. REMARKS' 7 lines torn across two pages) the first
          time this was checked against a real render; keeping each group atomic reads far more like
          a real printed form. */}
      <View wrap={false}>
        <Text style={{ fontSize: 8 }}>Manufacturer ........................................................</Text>
        <Text style={{ fontSize: 8 }}>Identification marks of Valves........................................</Text>
        <Text style={{ fontSize: 8 }}>Maker's no. ............................................................</Text>
        <Text style={{ fontSize: 8 }}>Type....................................................................</Text>
        <Text style={{ fontSize: 8 }}>Life(mm) ................................................................</Text>
        <Text style={{ fontSize: 8, fontWeight: 'bold', marginTop: 2 }}>Safety valve test certificate enclosed with annexure.</Text>
      </View>

      <View wrap={false}>
        <Text style={{ fontSize: 8, fontWeight: 'bold', marginTop: 6 }}>Valves Details:</Text>
        <Text style={{ fontSize: 8 }}>Material.................................................................</Text>
        <Text style={{ fontSize: 8 }}>Valve seat...............................................................</Text>
        <Text style={{ fontSize: 8 }}>Flat/Bevel...............................................................</Text>
        <Text style={{ fontSize: 8 }}>Diameter of valves seating...............................................</Text>
      </View>

      <View wrap={false}>
        <Text style={{ fontSize: 8, fontWeight: 'bold', marginTop: 6 }}>Valve Body:</Text>
        <Text style={{ fontSize: 8 }}>Material.................................................................</Text>
        <Text style={{ fontSize: 8, marginTop: 4 }}>Opening at Neck..........................................................</Text>
        <Text style={{ fontSize: 8 }}>Opening at outlet........................................................</Text>
      </View>

      <View wrap={false}>
        <Text style={{ fontSize: 8, fontWeight: 'bold', marginTop: 6 }}>Spring:</Text>
        <Text style={{ fontSize: 8 }}>Material.................................................................</Text>
        <Text style={{ fontSize: 8 }}>Process of manufacture...................................................</Text>
        <Text style={{ fontSize: 8 }}>Chemical composition.....................................................</Text>
      </View>

      <View wrap={false}>
        <Text style={{ fontSize: 8, fontWeight: 'bold', marginTop: 6 }}>Dimensions:</Text>
        <Text style={{ fontSize: 8 }}>Out side diameter of coil.................................................</Text>
        <Text style={{ fontSize: 8 }}>Section of wire...........................................................</Text>
        <Text style={{ fontSize: 8 }}>Number of free coils......................................................</Text>
        <Text style={{ fontSize: 8 }}>Free length of coil.......................................................</Text>
      </View>

      <View wrap={false}>
        <Text style={{ fontSize: 8, fontWeight: 'bold', marginTop: 6 }}>TEST RESULTS:</Text>
        <Text style={{ fontSize: 8 }}>Place of test.................................... Date....................</Text>
        <Text style={{ fontSize: 8 }}>Closing down pressure.....................................................</Text>
      </View>

      <View wrap={false}>
        <Text style={{ fontSize: 8, fontWeight: 'bold', marginTop: 6 }}>REMARKS</Text>
        <Text style={{ fontSize: 8 }}>Does the valve chatter?...................................................</Text>
        <Text style={{ fontSize: 8 }}>Does valve steam leak?....................................................</Text>
        <Text style={{ fontSize: 8 }}>Blow off pressure.........................................................</Text>
        <Text style={{ fontSize: 8 }}>Type of valves.............................................................</Text>
        <Text style={{ fontSize: 8 }}>Place of test..............................................................</Text>
        <Text style={{ fontSize: 8 }}>Constant 'C' By test results...............................................</Text>
        <Text style={{ fontSize: 8 }}>Capacity of the valve for the intended Blow off pressure .................</Text>
      </View>

      <Text style={s.h}>9. Certificate</Text>
      <Text style={{ fontSize: 8, marginBottom: 4 }}>
        Certified that the particulars entered herein are correct and that parts and fittings in
        sections 2,3,4,5,6,7,8,9,10&amp;11 against the names of which entries are made have been used in
        the construction and fitting of the boiler.
      </Text>
      <Text style={{ fontSize: 8, marginBottom: 4 }}>
        The particulars shown against the various parts used are in accordance with the enclosed
        certificate from the respective makers.
      </Text>
      <Text style={{ fontSize: 8, marginBottom: 4 }}>The design of the boiler is that shown in Drawing Nos. <Text style={s.filled}>{drawingRange}</Text>.</Text>
      <Text style={{ fontSize: 8 }}>
        The boiler has been designed and constructed to comply with the regulations under the Indian
        Boilers Act, 1923 for a Working Pressure of <Text style={s.filled}>{d.design_pressure || '—'} Kgf/cm²(g)</Text> at our works
        above named and satisfactorily withstood a water (Hydraulic) test of <Text style={s.filled}>{d.hydro_test_pressure || '—'} Kgf/cm²(g)</Text>
        {d.hydro_test_date ? <Text style={s.filled}> on {d.hydro_test_date}</Text> : null} in the presence of our responsible
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

// sectionLabel (Phase 3 — BOM-tree-driven Form IV A lettered sections) is optional and additive:
// omitted, this renders byte-identical to before the feature existed — the exact "no tree ->
// unchanged flat table" fallback the plan requires.
function FormTablePage({ document: d, entity, title, sectionLabel, cols, parts }) {
  return (
    <Page size="A4" orientation="landscape" style={s.pageL}>
      <Header entity={entity} />
      <Text style={s.title}>{title}</Text>
      <Text style={s.docId}>{d.doc_id} · Maker's No. {d.makers_no || '—'}</Text>
      {sectionLabel && <Text style={{ fontSize: 9, fontWeight: 'bold', marginBottom: 4 }}>{sectionLabel}</Text>}
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
  // Real sample: a numbered "1-" through "10-" list, not plain unnumbered KV rows.
  const items = [
    ['Makers name & Address', entity.name],
    ['Design Pressure', g.design_pressure ? `${g.design_pressure} Kgf/cm²(g)` : null],
    ['Design Temperature', g.design_temp],
    ['Process of manufacture', g.process_of_manufacture],
    ['Mode of attachment of flanges', g.mode_of_flange_attachment],
    ['Flange particulars', g.flange_particulars],
    ['Size of branch & Attachment', g.size_of_branch],
    ['Heat treatment', g.heat_treatment],
    ['Identification marks', g.identification_marks],
    ['Drawing No.', g.linked_drawing_dg_no || g.drawing_no],
  ];
  return (
    <Page size="A4" orientation="landscape" style={s.pageL}>
      <Header entity={entity} />
      <Text style={s.title}>FORM III A</Text>
      <Text style={s.sub}>Certificate of manufacture and Test</Text>
      <Text style={s.sub}>Regulations 4(e)</Text>
      <Text style={s.code}>{d.doc_id}</Text>
      {/* Real sample: its own standalone bold line, not merged into a doc-id/maker's-no identifier
          line the way the old docId-based version did (neither actually appears on this page). */}
      <Text style={{ fontSize: 8, fontWeight: 'bold', marginTop: 4, marginBottom: 4 }}>Name of the part: {g.name}</Text>
      {items.map(([label, value], i) => (
        <View key={i} style={s.row}>
          <Text style={{ width: 14 }}>{i + 1}-</Text>
          <Text style={s.lbl}>{label}</Text>
          <Text style={[s.val, s.filled]}>: {value || '—'}</Text>
        </View>
      ))}
      <Table cols={IIIA_COLS} parts={renumber(parts)} />
      {/* Real sample's closing certification is three separate "*"-bulleted lines, and the sign-off
          has a third line (Inspecting Authority) plus Place/Date the old version dropped — all
          wrapped together so a page break can't tear the block apart. */}
      <View wrap={false}>
        <Text style={{ marginTop: 8, fontSize: 7, lineHeight: 1.4 }}>* Certified that the particulars entered herein are correct.</Text>
        <Text style={{ fontSize: 7, lineHeight: 1.4 }}>* The particulars of fabricated components shown in the drawing no. <Text style={s.filled}>{g.linked_drawing_dg_no || g.drawing_no || '—'}</Text>.</Text>
        <Text style={{ fontSize: 7, lineHeight: 1.4, marginBottom: 6 }}>
          * The part has been designed and constructed to comply with the Indian Boiler Regulations for a working pressure of <Text style={s.filled}>{g.design_pressure || '—'} Kgf/cm²(g)</Text>
          {g.design_temp ? <Text style={s.filled}> & temperature {g.design_temp}</Text> : null} & satisfactorily withstood a water test of <Text style={s.filled}>{hydroPressure || '—'} Kgf/cm²(g)</Text>
          {g.hydro_test_date ? <Text style={s.filled}> on dated {g.hydro_test_date}</Text> : null} in the presence of our responsible representative.
        </Text>
        <Sign entity={entity} />
        <View style={{ marginTop: 8, alignItems: 'flex-end' }}>
          <Text style={{ fontSize: 7 }}>Name & Signature of Inspecting Authority</Text>
        </View>
        <Text style={{ fontSize: 7, marginTop: 10 }}>Place:</Text>
        <Text style={{ fontSize: 7 }}>Date:</Text>
      </View>
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

export async function renderQcFolderPdf(document, parts, mountings, project, groups, assemblies) {
  const d = document;
  mountings = mountings || [];
  groups = groups || [];
  assemblies = assemblies || [];
  const entity = entityForMaker(d.makers_no);
  // Form set follows the PROJECT's equipment model (projects.series); the document's own `series`
  // is a legacy default ('SF') and not authoritative here.
  const model = modelConfig(project?.series || d.series);
  // Mutually exclusive by construction (lib/qc-bom-sync.js's iiia_group_id) — a grouped part never
  // also appears on Form IV A, which is what stops the two forms from rendering identically.
  const ungrouped = parts.filter(p => !p.iiia_group_id);
  // Phase 3 — BOM-tree-driven Form IV A lettered sections. `assemblies` empty (no tree structured
  // for this project yet) -> ivaSections.sections is empty and every part falls into ivaSections
  // .ungrouped, rendered exactly as the single flat table this generator always produced — zero
  // regression for any project that hasn't adopted the tree feature.
  const ivaSections = buildLetteredSections(assemblies, ungrouped);
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
      // Zero real bom_assemblies sections (no tree structured, or nothing resolved) -> one plain
      // page identical to before this feature — the "byte-identical fallback" the plan requires.
      // Otherwise: one full page per lettered section (Table + Sign + Footer each, same per-page
      // shape the already-shipped Form III A per-group pages use), plus a trailing unlettered
      // "Ungrouped Materials" page for anything that didn't resolve to a section — labeled only
      // when real lettered sections exist alongside it, so a mixed project never reads as if the
      // ungrouped bucket were itself a numbered/lettered section.
      case 'IVA': {
        const ivaTitle = 'FORM IV A — REGULATION 4 (c) (IV)';
        if (!ivaSections.sections.length) {
          return <FormTablePage key={f} document={d} entity={entity} title={ivaTitle} cols={IVA_COLS} parts={ivaSections.ungrouped} />;
        }
        const pages = ivaSections.sections.map(sec => (
          <FormTablePage key={`iva-${sec.letter}`} document={d} entity={entity} title={ivaTitle}
            sectionLabel={`${sec.letter}. ${sec.name}`} cols={IVA_COLS} parts={sec.parts} />
        ));
        if (ivaSections.ungrouped.length) {
          pages.push(
            <FormTablePage key="iva-ungrouped" document={d} entity={entity} title={ivaTitle}
              sectionLabel="Ungrouped Materials" cols={IVA_COLS} parts={ivaSections.ungrouped} />
          );
        }
        return pages;
      }
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