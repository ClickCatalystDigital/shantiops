// Full statutory folder PDF (QC-FOLDER-DESIGN.md) — one combined multi-page document, ordered
// Label → Covering letter → Mounting list → the model's statutory forms. The entity (letterhead,
// ref prefix, signatory) is derived from the maker-number prefix, the form set from the model.
// First-pass layouts: faithful to the sample content/field order, not yet pixel-matched to the
// government sheets. Reuses the Form IV A table from lib/qc-doc-pdf.js's column model.
// ponytail: layouts are first-pass; refine per form against the samples as needed.
import path from 'node:path';
import React from 'react';
import { Document, Page, View, Text, StyleSheet, Svg, G, Rect, Path, Circle, Font, renderToBuffer } from '@react-pdf/renderer';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { modelConfig, FORM_LABELS } from './qc-models.js';
import { entityForMaker, DIRECTOR_OF_BOILERS } from './qc-entities.js';
import { getObjectBuffer } from './r2.js';
import { buildManualSections } from './qc-form4a-sections.mjs';
import { todayISO } from './date.js';

// Document-wide typeface — a real static (non-variable) Google Font, registered once at module
// load. PT Serif, not Lora/Merriweather: those are only distributed as variable fonts today, and
// @react-pdf/renderer's own maintainers confirm variable fonts don't reliably switch weight (the
// PDF spec has no variable-weight axis concept) — the documented failure is a font rendering
// all-bold or none. PT Serif genuinely ships separate static Regular/Bold TrueType files.
Font.register({
  family: 'PT Serif',
  fonts: [
    { src: path.join(process.cwd(), 'assets/fonts/pt-serif/PT_Serif-Web-Regular.ttf'), fontWeight: 'normal' },
    { src: path.join(process.cwd(), 'assets/fonts/pt-serif/PT_Serif-Web-Bold.ttf'), fontWeight: 'bold' },
  ],
});
// react-pdf's default hyphenation engine breaks a long word mid-syllable when a line runs tight
// ("Hyder-" / "abad") — wrong for a statutory document (names, addresses, part descriptions should
// never split). A word that doesn't fit now wraps whole onto the next line instead.
Font.registerHyphenationCallback(word => [word]);

const s = StyleSheet.create({
  // paddingBottom carved out for the fixed Footer (~40pt) so body content never collides with it.
  // fontFamily is the document-wide default (PT Serif) — every page's prose/labels/headings/sign-
  // offs inherit it. The one deliberate exception is `cell` below (dense material-data tables),
  // pinned back to Helvetica since those column widths were sized for Helvetica's tighter glyphs.
  page: { paddingTop: 28, paddingHorizontal: 28, paddingBottom: 56, fontSize: 8, fontFamily: 'PT Serif', color: '#111', lineHeight: 1.4 },
  pageL: { paddingTop: 24, paddingHorizontal: 24, paddingBottom: 46, fontSize: 7, fontFamily: 'PT Serif', color: '#111' },
  // Same as page/pageL, minus the bottom padding those reserve for the fixed Footer — used by every
  // page except the covering letter, which is now the only page still carrying the Header/Footer
  // company letterhead. Top padding is unchanged: it's a plain page margin, not header-reserved
  // space (Header was a normal-flow element, so removing it already reclaims its own height).
  pageNoLetterhead: { paddingTop: 28, paddingHorizontal: 28, paddingBottom: 28, fontSize: 8, fontFamily: 'PT Serif', color: '#111', lineHeight: 1.4 },
  pageLNoLetterhead: { paddingTop: 24, paddingHorizontal: 24, paddingBottom: 24, fontSize: 7, fontFamily: 'PT Serif', color: '#111' },
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
    borderTopWidth: 1, borderColor: '#ddd', paddingTop: 4,
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
  // See KV/KV2's `tight` prop — auto-width label, small fixed gap before the colon.
  lblTight: { color: '#555', marginRight: 6 },
  val: { fontWeight: 'bold', flex: 1 },
  p: { marginBottom: 6 },
  li: { marginLeft: 10, marginBottom: 1 },
  // borderLeft closes the grid's own left edge — every cell already carries its own borderRight
  // (below), and tRow its own borderBottom, so top+left on the header plus right+bottom per cell/row
  // is what actually completes a full grey grid instead of an outline open on the left.
  tHead: { flexDirection: 'row', backgroundColor: '#eee', borderTopWidth: 1, borderBottomWidth: 1, borderLeftWidth: 1, borderColor: '#999' },
  tRow: { flexDirection: 'row', borderBottomWidth: 1, borderLeftWidth: 1, borderColor: '#ddd', minHeight: 12 },
  // Pinned to Helvetica — the one deliberate exception to the page-wide PT Serif default (see
  // `page`/`pageL` above). Form IV A/III A's 18-20 column tables and the mounting list were sized
  // for Helvetica's tighter character width; switching them to a wider serif risks real column
  // overflow on already-tight columns.
  cell: { paddingVertical: 2, paddingHorizontal: 2, borderRightWidth: 1, borderColor: '#ddd', fontFamily: 'Helvetica', fontSize: 6.5 },
  signRow: { flexDirection: 'row', marginTop: 28, justifyContent: 'space-between' },
  // Was a solid #333 (near-black) rule — read as a heavy bar next to the rest of the page's #ddd/#999
  // table borders. Lightened + dotted to match every other rule in the doc, global (every sign-off
  // block in the file shares this one style).
  signBox: { width: '40%', borderTopWidth: 1, borderColor: '#999', borderStyle: 'dotted', paddingTop: 6, textAlign: 'center', fontSize: 7 },
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

// Extra breathing room for Form III §1's 14-line block (KV's optional `style` prop) — that section
// previously packed all 14 lines into `s.row`'s bare 1pt paddingVertical, leaving the whole rest of
// the page blank below "Brief Description of Boiler" instead of spreading the real content out.
const s1Row = { marginBottom: 10 };

// Form IV A / Form III A's shared materials-certificate columns — real government-form labels and
// grouping (2026-09-16 real sample, Form 3A/Form 4 PDFs), not the old flat single-row header: Size
// splits into 3 real sub-columns (T/W/L, not a joined "3.38 × 33.4 × 6000" string), and C/Mn/P/S/Si
// and Y.S/UTS/Elongation/Bend test sit under real "Chemical analysis"/"Physical analysis." group
// headers (see MaterialTableHeader below). Keyed by a stable `key`, not the display `label` — a
// label can be reworded again later without silently breaking a width lookup. `group` tags which of
// the 3 government-form groups a leaf belongs to (undefined = a plain, ungrouped column); `unit1`/
// `unit2` are Physical analysis's own two stacked unit lines (Kg/mm²/MPA under Y.S & UTS, blank/%
// under Elongation, Flat test/blank under Bend test) — the one group needing a 3rd header level.
const MATERIAL_BASE_COLS = [
  { key: 'partNo', label: 'Part No.', get: p => p.part_no },
  { key: 'partOfBoiler', label: 'Part of boiler', get: p => p.part_name },
  { key: 'castNo', label: 'Cast No.', get: p => p.tc_cast_no || '—' },
  { key: 'plateNo', label: 'Plate No.', get: p => p.tc_plate_no || '—' },
  { key: 'sizeT', label: 'T', get: p => p.size_t || '—', group: 'size' },
  { key: 'sizeW', label: 'W', get: p => p.size_w || '—', group: 'size' },
  { key: 'sizeL', label: 'L', get: p => p.size_l || '—', group: 'size' },
  { key: 'qty', label: 'Qty', get: p => p.qty },
  // A colon-separated standard reference (e.g. "BS:3059:Part1:1987") has no real space anywhere
  // inside it — react-pdf's own word-wrap only ever breaks at a literal space (hyphenation is
  // disabled document-wide, see the Font.registerHyphenationCallback comment above, and a
  // zero-width space is invisible to that step either way — confirmed live, not just reasoned
  // through), so the whole run renders as one unbroken block and overflows past this column's own
  // width into Name of Steel Maker next to it. A real space after each colon (only where one isn't
  // already there) gives it an actual break point, without touching any column's width — every
  // character of the original value is still printed, just with real, natural spacing after each
  // colon (the same way anyone would type "BS: 3059: Part1: 1987" by hand).
  { key: 'materialSpec', label: 'Material Spec.', get: p => (p.material_spec || '—').replace(/:(?!\s)/g, ': ') },
  { key: 'steelMaker', label: 'Name of Steel Maker', get: p => p.steel_maker || '—' },
  // A real certificate number can run 25-30+ chars (e.g. "JSL/TSPM/IBR/2026/0000012955") with no
  // spaces to wrap at, which at this column's own width overflows into the next cell instead of
  // wrapping — a zero-width space after every "/" gives react-pdf's text layout a real break point
  // without changing what's actually printed.
  { key: 'certNo', label: 'Certificate No.', get: p => (p.certificate_no ? p.certificate_no.replace(/\//g, '/​') : '—') },
  { key: 'chemC', label: 'C', get: p => p.chem_c, group: 'chem' },
  { key: 'chemMn', label: 'Mn', get: p => p.chem_mn, group: 'chem' },
  { key: 'chemP', label: 'P', get: p => p.chem_p, group: 'chem' },
  { key: 'chemS', label: 'S', get: p => p.chem_s, group: 'chem' },
  { key: 'chemSi', label: 'Si', get: p => p.chem_si, group: 'chem' },
  { key: 'ys', label: 'Y.S', get: p => p.ys, group: 'phys', unit1: 'Kg/mm²', unit2: 'MPA' },
  { key: 'uts', label: 'UTS', get: p => p.uts, group: 'phys', unit1: 'Kg/mm²', unit2: 'MPA' },
  { key: 'elongation', label: 'Elongation', get: p => p.elongation, group: 'phys', unit1: '', unit2: '%' },
  { key: 'bendTest', label: 'Bend test', get: p => p.bend_test, group: 'phys', unit1: 'Flat test', unit2: '' },
];
// Form IV A's 20 leaves, no extras — widths sum to 100%.
const IVA_WIDTHS = { partNo: 3, partOfBoiler: 15, castNo: 6, plateNo: 6, sizeT: 3, sizeW: 3, sizeL: 4,
  qty: 3, materialSpec: 6, steelMaker: 8, certNo: 12, chemC: 3, chemMn: 3, chemP: 3, chemS: 3, chemSi: 3,
  ys: 4, uts: 4, elongation: 4, bendTest: 4 };
// Form III A's 22 leaves — real sample carries 2 columns Form IV A doesn't (Steel Making Process,
// Heat Treatment; already real, stored per-certificate columns test_certificates.
// steel_making_process/heat_treatment), so every other width is narrower to still sum to 100%.
const IIIA_WIDTHS = { partNo: 2, partOfBoiler: 11, castNo: 4, plateNo: 3, sizeT: 3, sizeW: 4, sizeL: 6,
  qty: 2, materialSpec: 5, steelMaker: 6, certNo: 10, steelMakingProcess: 8, chemC: 3, chemMn: 3,
  chemP: 3, chemS: 3, chemSi: 3, heatTreatment: 5, ys: 4, uts: 4, elongation: 4, bendTest: 4 };
function buildMaterialLeaves(widths, { afterCertNo, afterChemSi } = {}) {
  const cols = MATERIAL_BASE_COLS.map(c => ({ ...c }));
  if (afterCertNo) {
    cols.splice(cols.findIndex(c => c.key === 'certNo') + 1, 0,
      { key: 'steelMakingProcess', label: 'Steel Making Process', get: p => p.steel_making_process || '—' });
  }
  if (afterChemSi) {
    cols.splice(cols.findIndex(c => c.key === 'chemSi') + 1, 0,
      { key: 'heatTreatment', label: 'Heat Treatment', get: p => p.heat_treatment || '—' });
  }
  return cols.map(c => ({ ...c, width: widths[c.key] }));
}
const IVA_MATERIAL_COLS = buildMaterialLeaves(IVA_WIDTHS);
const IIIA_MATERIAL_COLS = buildMaterialLeaves(IIIA_WIDTHS, { afterCertNo: true, afterChemSi: true });
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

// Form III §2 ("Name of the part(s) manufactured at constructor's works") — MF/CF are the bigger
// boiler class and always carry a second Shell Belt, so their real fabricated-component set differs
// from the smaller-boiler default (Form IV A's own material list, elsewhere just "SOCKET"/"PIPE"/
// "FLANGE" item descriptions, isn't the same thing as this section's named-assembly declaration).
// Fixed per direct instruction — not derived from a project's own BOM/named-parts data. SF crosses
// onto this list once projects.model_capacity (Design/PM set, "Model Capacity" on Edit Project,
// always in tons) exceeds 100 — see the isBigBoiler check below. GF/DF (added alongside SF/CF/MF/
// OF/SIB/PRS/FCB/FAB/HEADERS in lib/qc-series.js) are deliberately never added to that check — they
// always behave like SF under the threshold, i.e. always the real BOM-derived part list below.
const BIG_BOILER_PARTS = [
  'SHELL BELT (I)', 'SHELL BELT (II)', 'SHELL TUBE SHEET FRONT', 'SHELL TUBE SHEET REAR',
  'STAY TUBES-IST PASS', 'STAY TUBES-IIrd PASS', 'GUSSET SHOE', 'GUSSETS', 'PAD PLATE FOR SADDLES',
  'PAD PLATE FOR LIFTING HOOKS', 'LIFTING HOOKS', 'PAD PLATE FOR MAN HOLE', 'PAD PLATE FOR MUD HOLE',
  'MAN HOLE COVER', 'MAN HOLE FRAME (HEAT TREATED)', 'MUD HOLE COVER', 'FUSIBLE PLUG SOCKET',
  'PRESSURE GAUGE SOCKET', 'PRESSURE SWITCH SOCKET', 'STAND PIPES', 'STEAM STOP VALVE',
  'FEED CHECK VALVE', 'SAFETY VALVE', 'AIRVENT VALVE', 'FOR WATER LEVEL GAUGE HEADER',
  'HEADER FOR W.L.G.WATER LEVEL GAUGE', 'WATER LEVEL CONTROLLER', 'BLOW OFF VALVE', 'FEED WATER PIPE',
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

const MATERIAL_GROUP_TITLES = { size: 'Size in mm', chem: 'Chemical analysis', phys: 'Physical analysis.' };

// Collapses a run of consecutive same-`group` leaf columns into one spanning header cell — Size in
// mm (T/W/L), Chemical analysis (C/Mn/P/S/Si), Physical analysis. (Y.S/UTS/Elongation/Bend test) —
// each a real government-form group header on the materials-certificate table. Ungrouped columns
// pass through as their own 1-wide "span".
function groupSpans(leafCols) {
  const spans = [];
  for (let i = 0; i < leafCols.length; i++) {
    const g = leafCols[i].group;
    if (g && i > 0 && leafCols[i - 1].group === g) continue; // already counted by its group's start
    let span = 1;
    while (g && leafCols[i + span]?.group === g) span++;
    spans.push({ start: i, span, group: g });
  }
  return spans;
}

// The materials-certificate table's own 4-row government-form header (Form IV A / Form III A only —
// hand-built for this one exact shape, not a generalized nested-header engine; MountingListPage/
// HeadersBoxesTable are their own separate bespoke shapes too). Row 1: a plain column's own label,
// or a group's title spanning its member columns. Row 2: each grouped column's own short leaf label
// — blank for a plain column, since its label already sits in row 1. Rows 3-4: Physical analysis.'s
// own two stacked unit lines — blank everywhere else, matching the real sample's own blank grid
// cells under Size in mm / Chemical analysis / every plain column.
// A cell wrapper with an EXPLICIT height (never content-derived) so its own border always renders —
// react-pdf collapses an empty auto-sized Text to ~0 height, silently dropping its border along with
// it, which is what used to make an ungrouped column's blank row-2/3/4 cells (and their dividers)
// disappear below the group headers. justifyContent:'center' vertically centers whatever text is
// actually there, and the Text itself still wraps normally within the fixed width.
function HCell({ w, h, label, fontSize, last }) {
  return (
    <View style={{ width: `${w}%`, height: h, borderColor: GT_BORDER, borderRightWidth: last ? 0 : 1, borderBottomWidth: 1, justifyContent: 'center' }}>
      <Text style={{ fontSize, fontWeight: 'bold', textAlign: 'center' }}>{label}</Text>
    </View>
  );
}

const MATERIAL_HEADER_ROW_H = { title: 16, leaf: 10, u1: 9, u2: 9 };
const MATERIAL_HEADER_H = Object.values(MATERIAL_HEADER_ROW_H).reduce((a, b) => a + b, 0);

function MaterialTableHeader({ leafCols }) {
  const spans = groupSpans(leafCols);
  return (
    <View style={{ flexDirection: 'row', borderTopWidth: 1, borderLeftWidth: 1, borderColor: GT_BORDER, backgroundColor: '#eee' }} fixed>
      {spans.map((sp, i) => {
        const w = leafCols.slice(sp.start, sp.start + sp.span).reduce((n, c) => n + c.width, 0);
        // An ungrouped column (Part No., Qty, ...) gets ONE cell spanning the whole header height,
        // vertically centered — not 4 stacked cells, 3 of them blank, which is what used to leave
        // spurious internal dividing lines cutting through its own empty space.
        if (!sp.group) return <HCell key={i} w={w} h={MATERIAL_HEADER_H} label={leafCols[sp.start].label} fontSize={6} last={i === spans.length - 1} />;
        const leaves = leafCols.slice(sp.start, sp.start + sp.span);
        return (
          <View key={i} style={{ width: `${w}%`, borderRightWidth: 1, borderColor: GT_BORDER }}>
            <HCell w={100} h={MATERIAL_HEADER_ROW_H.title} label={MATERIAL_GROUP_TITLES[sp.group]} fontSize={6} last />
            <View style={{ flexDirection: 'row' }}>
              {leaves.map((c, j) => <HCell key={j} w={(c.width / w) * 100} h={MATERIAL_HEADER_ROW_H.leaf} label={c.label} fontSize={5.5} last={j === leaves.length - 1} />)}
            </View>
            <View style={{ flexDirection: 'row' }}>
              {leaves.map((c, j) => <HCell key={j} w={(c.width / w) * 100} h={MATERIAL_HEADER_ROW_H.u1} label={c.unit1 || ''} fontSize={5} last={j === leaves.length - 1} />)}
            </View>
            <View style={{ flexDirection: 'row' }}>
              {leaves.map((c, j) => <HCell key={j} w={(c.width / w) * 100} h={MATERIAL_HEADER_ROW_H.u2} label={c.unit2 || ''} fontSize={5} last={j === leaves.length - 1} />)}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// A zero-width space before every common separator character — gives react-pdf's text layout a
// real break point inside an otherwise-unbroken value (e.g. "133.4x3.38THK(SCH-40)" or a long
// certificate number), so a value wraps onto a second line inside its own cell instead of
// overflowing horizontally into the next column. Applied to every value in this table, not just
// specific columns — never changes what's actually printed.
// ponytail: this only works for a genuinely long *paragraph* — react-pdf's own word-splitter
// (@react-pdf/textkit) tokenizes on literal spaces only, then hands each space-delimited token to
// the hyphenation callback (registered above as `word => [word]`, i.e. never split) to get its
// "syllables" — a zero-width space embedded inside one token is invisible to that step, so a
// single unbroken run with no real space in it (e.g. "BS:3059:Part1:1987") still can't wrap no
// matter what's inserted inside it. Confirmed live: adding ':' here did nothing, and widening the
// column just shifts the overflow onto its neighbor. The actual fix for that case is a real space
// at the natural break point, in the value itself (see materialSpec's own `get` above) — not
// something this generic per-column helper can do safely for every column at once.
function wrappable(v) {
  if (v == null) return v;
  return String(v).replace(/([/x×\-,()])/g, '​$1');
}

// Group-name bar — a real grey header row (matching MaterialTableHeader's own #eee/GT_BORDER
// convention), not a plain caption line, sitting directly above the column-header row with no gap.
// `fixed`, same as MaterialTableHeader right below it, so a single group's own table spilling onto a
// continuation page still repeats both rows together — a group name with no column headers under it
// (or vice versa) would read as a different group entirely partway down a long table.
function GroupHeaderBar({ label }) {
  return (
    <View style={{ backgroundColor: '#eee', borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: GT_BORDER, paddingVertical: 3, paddingHorizontal: 4 }} fixed>
      <Text style={{ fontSize: 8, fontWeight: 'bold' }}>{label}</Text>
    </View>
  );
}

// Body rows reuse s.cell/s.tRow exactly like the generic Table above — only the header differs.
// `groupLabel` is optional — omitted, this renders byte-for-byte as before (Form III A's own call
// site, which has no lettered sub-groups of its own, is unaffected).
function MaterialTable({ cols, parts, groupLabel }) {
  return (
    <View>
      {groupLabel && <GroupHeaderBar label={groupLabel} />}
      <MaterialTableHeader leafCols={cols} />
      {parts.map((p, i) => (
        <View key={p.id ?? i} style={s.tRow} wrap={false}>
          {cols.map((c, j) => <Text key={j} style={[s.cell, { width: `${c.width}%` }]}>{wrappable(c.get(p)) ?? '—'}</Text>)}
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

// `labelWidth` overrides `s.lbl`'s default 150pt for a call site with short labels, so the value
// sits close to its label instead of stranded after a wide fixed gap — never changing `s.lbl`
// itself, since other callers (e.g. Form III's much longer labels) genuinely need the wider default.
// `tight` is the newer, better fit for short/uneven labels (Form II(1)'s Maker's-info block): the
// label auto-sizes to its own text instead of a fixed column, with a small fixed gap before the
// colon — a fixed labelWidth left a big dead gap after a short label like "W.P." while barely
// fitting a longer one like "Maker's No.", since one fixed number can't fit both. Opt-in only, so
// every other existing `labelWidth`-based call site (Form III's much longer label set) is untouched.
// `style` is an optional extra row style (e.g. more paddingVertical/marginBottom for a section that
// has room to breathe) merged on top of the shared `s.row` — never replacing it, so every existing
// caller that omits `style` renders byte-for-byte unchanged.
function KV({ label, value, filled, labelWidth, tight, style }) {
  const labelStyle = tight ? s.lblTight : (labelWidth ? [s.lbl, { width: labelWidth }] : s.lbl);
  return <View style={style ? [s.row, style] : s.row}><Text style={labelStyle}>{label}</Text><Text style={filled ? [s.val, s.filled] : s.val}>: {value || '—'}</Text></View>;
}

// A wrapped continuation of a KV's own value (e.g. Form II(1)'s Maker's Name carrying an address
// on its own line below) — a plain sibling Text at the SAME nesting level as the KV call itself,
// never inside KV's own returned View (nesting it inside KV's render corrupted vertical flow
// entirely — the second line rendered on top of the NEXT sibling KV/KV2 row instead of between
// them, confirmed via pdftotext -bbox showing both at the identical Y coordinate).
//
// Root cause of THAT, and the reason this can't just reuse `s.val`: `s.val` carries `flex: 1`,
// correct inside a KV row (a `flexDirection: 'row'` container, where flex:1 means "fill the row's
// remaining WIDTH") but wrong here — this Text sits as a plain child of the outer
// `flexDirection: 'column'` block wrapping the whole Maker's-info section, where flex:1 instead
// means "grow to fill the column's remaining HEIGHT", which is what was corrupting every sibling
// below it. This uses `s.filled`'s bold weight only, deliberately never `s.val`.
function KVSecondLine({ text, labelWidth, filled = true }) {
  return <Text style={[filled ? s.filled : null, { marginLeft: labelWidth + 6 }]}>{text}</Text>;
}

// Two label:value pairs sharing one row — the real Form II(1) sample does this twice (Maker's No. /
// Year of Make; Tested To / its date) instead of KV's usual one-pair-per-row layout.
function KV2({ a, b, labelWidth, tight }) {
  const lblStyle = tight ? s.lblTight : (labelWidth ? [s.lbl, { width: labelWidth }] : s.lbl);
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

// Both real samples this is used against (Form III A's "Feed pipeline" sample, Form IV A's 8-page
// CF sample) show a plain, sparse sign-off: left = "Maker's Representative" with a "(Name &
// signature)" caption underneath it specifically (not under the right box); right = just "Maker",
// no company name, no "Authorized Signatory" wording — neither of which appears on either real
// sample. `entity` is now unused here as a result, kept as a parameter only so every existing call
// site (FormTablePage, FormIIIAGroupPage, FormII1Page's small/Form XVII stub) needs no change.
function Sign() {
  return (
    <View style={s.signRow} wrap={false}>
      <Text style={s.signBox}>Maker's Representative{'\n'}(Name & signature)</Text>
      <Text style={s.signBox}>Maker</Text>
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
    // §9's own text (drawing nos./pressure/hydro test) only ever runs 4-6 lines, leaving most of the
    // page blank below the old signRow's own marginTop:28 — this block was sitting cramped right
    // under the text instead of using that real remaining room. Pushed down as a whole unit AND
    // spread out internally (both gaps between the two signature rows and the Dated line widened) so
    // all three sit spaced across the page's real remaining height, not still bunched together lower
    // down.
    <View wrap={false} style={{ marginTop: 140 }}>
      <View style={s.signRow}>
        <Text style={s.signBox}>Maker's Representative{'\n'}(Name, signature and Stamp)</Text>
        <Text style={s.signBox}>Maker{'\n'}(Name, signature and Stamp)</Text>
      </View>
      <View style={[s.signRow, { marginTop: 70 }]}>
        <Text style={s.signBox}>Name, signature and Stamp{'\n'}of Competent person</Text>
        <Text style={s.signBox}>Name, signature and Stamp of{'\n'}Inspecting authority</Text>
      </View>
      {/* Real sample places this under the left (Competent Person) signature column, not centered
          across the full page width — a row holding a 40%-wide box (same width as signBox above it)
          reproduces that instead of one full-width centered line. */}
      <View style={{ flexDirection: 'row', marginTop: 70 }}>
        <Text style={{ width: '40%', fontSize: 7 }}>Dated ................... the day of .................</Text>
      </View>
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

// Two fixed enclosures every real BOILER submission includes (confirmed against a real filled
// cover letter) — physical documents this app never generates, so they're not derived from any
// BOM/certificate data, just always-present lines. Gated on `model.noun === 'Boiler'` (not every
// model) — same distinction FormIIIPage's own component-vs-boiler branch already uses: PRS/HEADERS
// are smaller, non-boiler component filings with no shell to rub and no Form II(1) at all, and no
// reference sample confirms either line applies there.
function isBoilerModel(model) {
  return !model.noun || model.noun === 'Boiler';
}

function manifestLines(d, model, parts, mountings, pageRanges) {
  const lines = [];
  if (d.approved_drawing_codes?.length) {
    lines.push(`As built Drawings 1 set (Drawing No's ${d.approved_drawing_codes.join(', ')})`);
  }
  if (isBoilerModel(model)) lines.push('Rub Off - 1 page');
  model.forms.forEach(f => {
    if (!pageRanges[f]) return; // zero pages actually rendered for this form — don't list it
    lines.push(`${FORM_LABELS[f] || f}${pageRangeLabel(pageRanges[f])}`);
  });
  if (isBoilerModel(model)) lines.push('Material Inspection and stage wise reports – 1 Page');
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
  // Real sample: `SB-EXP-09` -> `SB/QC/OW/EXP-09` — the maker's own company-code prefix is
  // stripped, not repeated (entity.refPrefix already carries it). Reuses the exact two prefixes
  // entityForMaker() (lib/qc-entities.js) already checks for, rather than a new vocabulary.
  const makerSuffix = String(d.makers_no || '').replace(/[^0-9A-Za-z-]/g, '').replace(/^(SB|STF)-/i, '');
  const refNo = `${entity.refPrefix}/${makerSuffix}`;
  // Handles both shapes `recipient.address` can now be: the hardcoded DIRECTOR_OF_BOILERS default
  // (a real array of lines) and a custom d.recipient_address (still a free-text column — split on
  // any embedded newlines, or render as the one line it already is).
  const addressLines = Array.isArray(recipient.address)
    ? recipient.address
    : String(recipient.address || '').split('\n').filter(Boolean);
  return (
    <Page size="A4" style={s.page}>
      {/* Header/Footer temporarily suppressed on the cover letter only (not removed — style={s.page}
          keeps the same top/bottom padding they used to fill, and opacity:0 keeps Header's own flow
          height intact, so the letter body below starts exactly where it always has and the page
          simply shows blank space where the letterhead used to be). Restore by dropping these two
          wrapper Views. */}
      <View style={{ opacity: 0 }}><Header entity={entity} /></View>
      <View style={{ marginTop: 20, fontSize: 10 }}>
        <Text style={{ marginBottom: 3 }}>Ref: {refNo}</Text>
        {/* Display-only fallback — never written back to qc_documents. The editor's own Boiler
            Details sheet already defaults this field to today the moment someone opens it
            (components/QcDocumentEditor.jsx), but that default is only persisted once they save;
            a document nobody's opened that sheet on still has a real NULL in the DB. Rather than
            leave the letter dateless, the PDF falls back to today's date (IST-pinned, same helper
            every other "today" in this app uses) purely for display — the stored value, and what
            the editor shows next time it's opened, are both untouched. */}
        <Text style={{ marginBottom: 8 }}>Date: {d.submission_date || todayISO()}</Text>
        <Text style={{ marginBottom: 3 }}>To,</Text>
        <Text style={{ fontWeight: 'bold', marginBottom: 2 }}>{recipient.name}</Text>
        {addressLines.map((line, i) => <Text key={i} style={i === addressLines.length - 1 ? { marginBottom: 8 } : undefined}>{line}</Text>)}
        <Text style={{ marginTop: 4, marginBottom: 10, fontSize: 11, fontWeight: 'bold' }}>
          SUB: Submission Of Original Documentation Folder For {model.noun} Maker No: {d.makers_no || '—'}
        </Text>
        <Text style={{ marginBottom: 8 }}>Dear Sir,</Text>
        <Text style={s.letterP}>
          With reference to the above subject we are enclosing herewith Set of Original Drawings and
          Original Documentation folder along with the Mountings and Fittings &amp; Test Certificates of {model.noun}.
        </Text>
        {manifestLines(d, model, parts, mountings, pageRanges || {}).map((l, i) => <Text key={i} style={s.letterLi}>{i + 1}. {l}</Text>)}
        <Text style={{ marginTop: 16, marginBottom: 12 }}>Please acknowledge receipt of the same.</Text>
        <Text style={{ marginBottom: 4 }}>Thank you,</Text>
        <Text>Yours Sincerely,</Text>
        <Text style={{ fontWeight: 'bold', marginTop: 6 }}>{entity.name}</Text>
        {/* signer_name auto-fills from the current QC user the first time someone opens the
            document's Boiler Details sheet, so it's populated in real use — this guard is only for
            a document nobody's ever opened that way, so it doesn't leave an oversized blank gap. */}
        {d.signer_name ? <Text style={{ marginTop: 22 }}>{d.signer_name}</Text> : null}
        <Text style={d.signer_name ? undefined : { marginTop: 22 }}>QC Engineer</Text>
      </View>
      <View style={{ opacity: 0 }}><Footer entity={entity} /></View>
    </Page>
  );
}

function MountingListPage({ document: d, mountings, entity }) {
  // Widths sum to 100% (was 96 — the leftover 4% left the table's own right edge unbordered/short of
  // the page margin); the extra went to Description/Serial No(s), the two most variable-length columns.
  const COLS = [['Sl', 4, (m, i) => String(i + 1)], ['Description', 32, m => m.description], ['Size', 12, m => m.size],
    ['MOC', 10, m => m.moc], ['Serial No(s)', 22, m => m.serial_numbers], ['Make', 14, m => m.make], ['Qty', 6, m => m.qty]];
  return (
    <Page size="A4" orientation="landscape" style={s.pageLNoLetterhead}>
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
      <Page size="A4" style={s.pageNoLetterhead}>
        <Text style={s.title}>FORM XVII — CERTIFICATE OF MANUFACTURE AND TEST FOR SMALL INDUSTRIAL BOILERS</Text>
        <Text style={s.docId}>{d.doc_id}</Text>
        <KV label="Maker's Name" value={entity.name.toUpperCase()} />
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
      </Page>
    );
  }
  // The sample's own line is this short regulatory designation ("DIRECTORATE OF BOILERS, TELANGANA,
  // HYDERABAD"), not DIRECTOR_OF_BOILERS.name ("The Director of Boilers") — that longer form is
  // right for the covering letter's own salutation, a different tone/purpose than this form's fixed
  // designation-of-authority line.
  const authorityDesignation = d.recipient_name || 'DIRECTORATE OF BOILERS, TELANGANA, HYDERABAD';
  const drawingRange = d.approved_drawing_codes?.join(', ') || '—';
  return (
    <Page size="A4" style={s.pageNoLetterhead}>
      {/* Real sample: one centered 5-line title stack (title, sub-heading, regulation cite,
          authority designation, authority name) with no letterhead of its own — matches the real
          arrangement below it now that this page no longer carries the company Header either. */}
      <Text style={s.title}>FORM – II (1)</Text>
      <Text style={s.sub}>CERTIFICATE OF INSPECTION FOR SHOP ASSEMBLED BOILERS</Text>
      <Text style={s.sub}>[REGULATION 4 (C) (i)]</Text>
      <Text style={[s.sub, { fontWeight: 'bold', marginTop: 6 }]}>DESIGNATION OF INSPECTING AUTHORITY</Text>
      <Text style={[s.sub, { fontWeight: 'bold' }]}>{authorityDesignation}</Text>
      <Text style={s.code}>{d.doc_id}</Text>
      <Text style={s.p}>
        We hereby certify that the <Text style={s.filled}>{d.boiler_type || '—'}</Text> built by M/s. <Text style={s.filled}>{entity.name.toUpperCase()}, {entity.address}</Text>. Under
        Maker's Number <Text style={s.filled}>{d.makers_no || '—'}</Text> was constructed under our supervision at inspected at various
        stages of construction by the Competent person and that the construction and workmanship were
        satisfactory and in accordance with standard conditions for the design and construction of boilers
        as per regulation framed under boilers Act, 1923.
      </Text>
      <Text style={s.p}>The boiler is stamped on pressure part of shell plate with stamp as shown here under:</Text>
      <View style={s.hr} />
      {/* This block reads as the certificate's headline facts in the real sample — set noticeably
          larger than the surrounding body text (8pt). Maker's Name/W.P. stay `tight` (no alignment
          partner, so auto-width label + small gap is all that's needed); the two KV2 rows instead
          get a shared fixed `labelWidth` — "Year of Make"/"On" need to line up with EACH OTHER
          across their two separate rows, which `tight`'s per-row auto-width can't do (it sized each
          label to its own text, so "On" and "Year of Make" started their colons at different x
          positions) — one shared width for both rows fixes that, same reasoning "Maker's No."/
          "Tested To" share it on the left. */}
      <View style={{ fontSize: 10 }}>
        {/* Real sample's second line is just the city, capitalized, no street/area prefix (e.g.
            "HYDERABAD.", not "Kucharam, Hyderabad") — derived from entity.address's own last
            comma-separated segment rather than hardcoded, so it still tracks a future address
            correction instead of a frozen string. */}
        {/* Both label widths measured directly via pdftotext -bbox against the real rendered text
            ("Maker's Name" ≈ 62pt, "Year of Make" ≈ 57pt — the longest of its own pair), not
            guessed — a plainly-round number here left a visible dead gap the same way the old
            95pt/70pt values did, just smaller. */}
        <KV label="Maker's Name" value={entity.name.toUpperCase()} filled labelWidth={65} />
        <KVSecondLine text={entity.address.split(',').pop().trim().toUpperCase()} labelWidth={65} />
        <KV2 a={{ label: "Maker's No.", value: d.makers_no }} b={{ label: 'Year of Make', value: d.year_of_make }} labelWidth={60} />
        <KV2 a={{ label: 'Tested To', value: d.hydro_test_pressure ? `${d.hydro_test_pressure} Kg/cm²` : null }} b={{ label: 'On', value: d.hydro_test_date }} labelWidth={60} />
        <KV label="W.P." value={d.working_pressure ? `${d.working_pressure} Kg/cm²` : null} filled tight />
      </View>
      <Text style={[s.sub, { fontWeight: 'bold', marginTop: 8, fontSize: 10 }]}>COMPETENT PERSON'S OR INSPECTING</Text>
      <Text style={[s.sub, { fontWeight: 'bold', fontSize: 10 }]}>AUTHORITY'S OFFICIAL STAMP:</Text>
      <View style={s.hr} />
      <Text style={s.p}>
        {'\n'}The boiler on completion was subjected to a Hydrostatic test pressure of <Text style={s.filled}>{d.hydro_test_pressure || '—'} Kg/cm² (g)</Text>{' '}
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
          <Text style={[s.signBoxPlain, { fontSize: 10 }]}>Signature of Competent Person</Text>
          <Text style={[s.signBoxPlain, { fontSize: 10 }]}>Signature of inspecting Authority</Text>
        </View>
        {/* Starts at the exact same x as "Signature of inspecting Authority" itself — that caption
            is centered within its own 40%-wide box, so its rendered start position depends on its
            own text length, not a round percentage; measured directly via pdftotext -bbox (357pt
            from the page's own left content margin) rather than guessed, since a plain 60%-width
            spacer this line used before started noticeably further right than where that caption
            actually begins. */}
        <Text style={{ marginLeft: 357, marginTop: 18, fontSize: 10 }}>Date And Seal</Text>
      </View>
    </Page>
  );
}

// Real sample: furnace ring seams are ONE generic line ("in each ring – NA"), not broken out per
// ring the way belts are (below) — join raw values, no "Ring N:" label prefix. Empty renders the
// same honest "—" every other still-unset field on this page already uses.
function furnaceRingLine(seams) {
  const rows = seams.filter(s => s.location === 'furnace_ring').sort((a, b) => a.sequence - b.sequence);
  if (!rows.length) return '—';
  return rows.map(r => r.seam_count || '—').join(', ');
}

const BELT_ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

// Real sample: each belt gets its OWN full sentence ("...in first belt - ONE", "...in second belt
// - TWO"), not one line combining every belt — a fixed labelWidth/comma-join can't reproduce that,
// so this renders one <Text> per belt (or one placeholder line when none exist yet, same "—"
// convention as every other unset field here).
function BeltSeamLines({ seams }) {
  const rows = seams.filter(s => s.location === 'belt').sort((a, b) => a.sequence - b.sequence);
  if (!rows.length) {
    return <Text style={{ fontSize: 8 }}>No. of longitudinal seams in shell/drum in each belt – <Text style={s.filled}>—</Text></Text>;
  }
  return rows.map((r, i) => (
    <Text key={r.id ?? i} style={{ fontSize: 8 }}>
      No. of longitudinal seams in shell/drum in {BELT_ORDINALS[i] || `${i + 1}th`} belt – <Text style={s.filled}>{r.seam_count || '—'}</Text>
    </Text>
  ));
}

// Section 3's real template ("Parts Manufactured Outside the Constructor's Works") — four dotted
// blank fields plus the "manufactured/inspected...by (Inspecting authority)" line, with the real
// note (NOT APPLICABLE, or d.parts_outside_constructor_works once QC records something real)
// positioned to its right, matching the government form's own layout — not just the bare sentence
// this used to render in place of the whole section.
function PartsOutsideSection({ note }) {
  return (
    <View style={{ marginLeft: 20, marginTop: 4 }} wrap={false}>
      <Text style={{ fontSize: 8 }}>Name of Components ..............................................................</Text>
      <Text style={{ fontSize: 8, marginTop: 2 }}>Drawing no. ......................................................................</Text>
      <Text style={{ fontSize: 8, marginTop: 2 }}>Manufactured by ..................................................................</Text>
      <Text style={{ fontSize: 8, marginTop: 2 }}>Identification Marks ..............................................................</Text>
      <View style={{ flexDirection: 'row', marginTop: 6 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 8 }}>Parts(s) manufactured, Inspected at all stages of</Text>
          <Text style={{ fontSize: 8 }}>Construction by ...................................</Text>
          <Text style={{ fontSize: 7, color: '#555' }}>(Inspecting authority)</Text>
        </View>
        <View style={{ width: 160, justifyContent: 'center' }}>
          <Text style={{ fontSize: 8, fontWeight: 'bold', textAlign: 'center' }}>{note}</Text>
        </View>
      </View>
      <Text style={{ fontSize: 8, marginTop: 6 }}>Part(s) hydraulically tested and inspected after test by ...................................</Text>
    </View>
  );
}

// Sections 5/6/7's real templates — genuine empty tables matching the government/Excel form shape
// (headers only, no per-part data source exists for any of the three), each closed with a merged
// note row instead of the plain sentence they used to render. Border color (#999) matches the
// muted table-rule color the rest of this file already uses for dense data tables.
const GT_BORDER = '#999';

// Renders one row of grouped/plain header cells — groups: [{label, width, leaves?: [{label, width}]}].
// A plain (no .leaves) group is one HCell spanning the FULL titleH+leafH height; a grouped one is a
// title HCell stacked over its own leaf HCells. Every cell's height is always explicit (never
// content-derived, unlike the old alignSelf:'center'-on-Text approach this replaces), so a plain
// column's own border always reaches exactly as far down as a grouped column's does — no more gap
// between a short cell's border and the row below it.
function GroupedHeaderRow({ groups, titleH, leafH, fontSize = 6, leafFontSize = 5.5 }) {
  const totalH = titleH + leafH;
  return (
    <View style={{ flexDirection: 'row' }}>
      {groups.map((g, i) => {
        const isLast = i === groups.length - 1;
        if (!g.leaves) return <HCell key={i} w={g.width} h={totalH} label={g.label} fontSize={fontSize} last={isLast} />;
        return (
          <View key={i} style={{ width: `${g.width}%`, borderRightWidth: isLast ? 0 : 1, borderColor: GT_BORDER }}>
            <HCell w={100} h={titleH} label={g.label} fontSize={fontSize} last />
            <View style={{ flexDirection: 'row' }}>
              {g.leaves.map((leaf, j) => (
                <HCell key={j} w={(leaf.width / g.width) * 100} h={leafH} label={leaf.label} fontSize={leafFontSize} last={j === g.leaves.length - 1} />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// titleH/leafH bumped from the old single 34px total to 16+26=42 — "Thickness in 32nds. In."-class
// leaf labels need real 2-line room at this column width; the extra space also gives the table's own
// body/note area (below) more visible presence instead of feeling cramped against the header.
function GroupedEmptyTable({ groups, note, titleH = 16, leafH = 26 }) {
  return (
    <View style={{ borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: GT_BORDER, marginTop: 2 }} wrap={false}>
      <GroupedHeaderRow groups={groups} titleH={titleH} leafH={leafH} />
      <View style={{ flexDirection: 'row', minHeight: 16 }}>
        <Text style={{ flex: 1, textAlign: 'center', fontSize: 7, fontWeight: 'bold', paddingVertical: 4 }}>{note}</Text>
      </View>
    </View>
  );
}

const DRUMS_GROUPS = [
  { label: 'No.', width: 4 },
  { label: 'Nomenclature', width: 16 },
  { label: 'Nominal dia.', width: 7 },
  { label: 'Length', width: 7 },
  { label: 'Shell plate', width: 12, leaves: [
      { label: 'Thickness in 32nds. In.', width: 6 },
      { label: 'Inside radius in.', width: 6 },
    ] },
  { label: 'Tube plate', width: 12, leaves: [
      { label: 'Thickness in 22nds. In.', width: 6 },
      { label: 'Inside radius in.', width: 6 },
    ] },
  { label: 'Head', width: 18, leaves: [
      { label: 'Thickness in 32nds. In.', width: 6 },
      { label: 'Type**', width: 6 },
      { label: 'Radius of dish in.', width: 6 },
    ] },
  { label: 'Manholes No. & Size', width: 12 },
  { label: 'Hydrostatic test lbs./Sq. in.', width: 12 },
];

// Headers & Boxes is the one sub-template whose "No." column is really 4 fixed row labels, not a
// numeric index — Water Wall / Integral Economiser / Superheaters / Mud boxes are always the same
// real category names on the government form, never per-project data.
function HeadersBoxesTable({ note }) {
  const groups = [
    { label: 'No.', width: 10 },
    { label: 'Size and Shape', width: 20 },
    { label: 'Thickness in 32nd in.', width: 16 },
    { label: 'Head or end', width: 30, leaves: [
        { label: 'Shape', width: 15 },
        { label: 'Thickness in 32nds. in.', width: 15 },
      ] },
    { label: 'Hydrostatic test kg./cm²', width: 24 },
  ];
  const rows = [
    { label: 'Water Wall Headers', note: null },
    { label: 'Integral Economiser Header', note },
    { label: 'Superheaters Headers /\nMud Boxes', note },
  ];
  return (
    <View style={{ borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: GT_BORDER, marginTop: 2 }} wrap={false}>
      <GroupedHeaderRow groups={groups} titleH={12} leafH={18} />
      {rows.map((r, i) => (
        <View key={i} style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: GT_BORDER, minHeight: 20 }}>
          <Text style={{ width: '10%', borderRightWidth: 1, borderColor: GT_BORDER, fontSize: 6, fontWeight: 'bold', textAlign: 'center', paddingVertical: 4 }}>{r.label}</Text>
          <Text style={{ width: '90%', textAlign: 'center', fontSize: 7, fontWeight: 'bold', paddingVertical: 4 }}>{r.note || ''}</Text>
        </View>
      ))}
    </View>
  );
}

function MountingsTable({ note }) {
  const COLS = [
    { label: 'P. No', width: 12 },
    { label: 'Nomenclature', width: 24 },
    { label: 'Material', width: 20 },
    { label: 'Type', width: 20 },
    { label: 'No.\nRemarks', width: 24 },
  ];
  return (
    <View style={{ borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: GT_BORDER, marginTop: 2 }} wrap={false}>
      <View style={{ flexDirection: 'row' }}>
        {COLS.map((c, i) => (
          <Text key={i} style={{ width: `${c.width}%`, borderRightWidth: 1, borderBottomWidth: 1, borderColor: GT_BORDER, fontSize: 7, fontWeight: 'bold', textAlign: 'center', paddingVertical: 4 }}>{c.label}</Text>
        ))}
      </View>
      <View style={{ flexDirection: 'row', minHeight: 30 }}>
        <Text style={{ width: `${COLS[0].width}%`, borderRightWidth: 1, borderColor: GT_BORDER }} />
        <Text style={{ width: `${100 - COLS[0].width}%`, textAlign: 'center', fontSize: 7, fontWeight: 'bold', paddingTop: 10 }}>{note}</Text>
      </View>
    </View>
  );
}

function FormIIIPage({ document: d, entity, project, model, parts, mountingsPage, seams = [] }) {
  // Component (non-boiler) filing — real sample (2026-08-24): boiler-only fields (Heating Surface,
  // Evaporation Capacity, Grate Area) don't apply and are marked NA rather than omitted; the
  // "Description" field holds the component name (e.g. "STEAM HEADER") in the same boiler_type
  // column a boiler filing uses for its own type — reused, not a new column.
  if (model?.noun && model.noun !== 'Boiler') {
    return (
      <Page size="A4" style={s.pageNoLetterhead}>
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
      </Page>
    );
  }
  // Boiler filing — real sample's 9 numbered sections, split across 5 real physical pages per
  // direct instruction (§1 alone; §§2-3 together; §§4-5 together; §§6-8 together; §9 + sign-off
  // alone), each continuation page repeating a "FORM III Contd." heading — instead of one long
  // auto-paginating <Page>. Gives §1's headline facts real room to be set larger (10pt, same
  // "certificate's own headline facts" treatment already used for Form II(1)'s Maker's-info block)
  // without cramming everything onto one page. `renderSection`/the convergence loop already accept
  // an array of pages from any form (proven by the 'IIIA'/'IVA' cases) — nothing else needed to
  // change for this. §8 (safety valve) is the sample's ~25 blank dotted fill-in lines with no
  // backing data anywhere in this app — reduced to the one line that states the actual fact (a
  // certificate is enclosed) rather than reproducing empty lines with no informational value.
  const series = project?.series || d.series;
  // Design/PM set model_capacity on the project itself (Edit Project — "Model Capacity"), not
  // re-entered anywhere on the QC document — read directly, no new field. Always entered in tons
  // (confirmed), compared as-entered against the literal 100-ton threshold.
  const isBigBoiler = series === 'MF' || series === 'CF' || (series === 'SF' && Number(project?.model_capacity) > 100);
  const partNames = isBigBoiler
    ? BIG_BOILER_PARTS.join(', ')
    : (parts.map(p => p.part_name).join(', ') || '—');
  const drawingRange = d.approved_drawing_codes?.join(', ') || '—';
  // `fixed` repeats this on every physical page a <Page> auto-paginates into (same mechanism
  // Header/Footer already rely on) — so page 3 below still shows it correctly even though §§4-9
  // routinely overflow onto several more physical pages, matching the real sample's own repeated
  // "FORM III Contd." heading on every one of its continuation pages.
  const ContdHeader = () => (
    <View fixed>
      <Text style={s.title}>FORM III Contd.</Text>
      <Text style={s.code}>{d.doc_id}</Text>
    </View>
  );
  return [
    <Page key="iii-1" size="A4" style={s.pageNoLetterhead}>
      <Text style={s.title}>FORM III</Text>
      <Text style={s.sub}>CONSTRUCTION CERTIFICATES OF MANUFACTURE AND TEST</Text>
      <Text style={s.sub}>(REGULATION 4 (C) II)</Text>
      <Text style={s.code}>{d.doc_id}</Text>

      {/* Real sample indents every field label one tab right of its own "N. HEADING" — a two-level
          outline, not the flat single-margin list this used to be. Bumped to 10pt — this is the
          certificate's own headline facts, same treatment Form II(1)'s Maker's-info block got, and
          §1 now has its own dedicated page with room for it. `tight` (auto-width label, small fixed
          gap) closes the dead label→value gap a fixed-width column left for short labels like
          "Contact Number"; `s1Row`'s extra marginBottom spreads the 14 lines out to use the page's
          real remaining space instead of leaving it all as blank white space below the last line. */}
      <Text style={s.h}>1. DESCRIPTION</Text>
      <View style={{ marginLeft: 20, fontSize: 10 }}>
        <KV label="Constructor's name and address" value={`${entity.name}, ${entity.address}`.toUpperCase()} filled tight style={s1Row} />
        <KV label="Manufactured For/Stock Purposes" value={project?.customer_name || 'STOCK'} filled tight style={s1Row} />
        {/* Real sample has this line; was missing entirely. project.customer_phone comes from a
            LEFT JOIN in the pdf route (projects.customer_id is nullable, so this is honestly blank
            for a project with no linked CRM customer, not defaulted to a guess). */}
        <KV label="Contact Number" value={project?.customer_phone} filled tight style={s1Row} />
        <KV label="Type of Boiler" value={d.boiler_type} filled tight style={s1Row} />
        <KV label="Length overall" value={d.length_overall} filled tight style={s1Row} />
        <KV label="Diameter inside largest belt" value={d.internal_diameter} filled tight style={s1Row} />
        <KV label="Design Pressure" value={d.design_pressure} filled tight style={s1Row} />
        <KV label="Hydro Test pressure" value={d.hydro_test_pressure} filled tight style={s1Row} />
        <KV label="Maker's No. of Boiler" value={d.makers_no} filled tight style={s1Row} />
        <KV label="Year of Make" value={d.year_of_make} filled tight style={s1Row} />
        <KV label="Total heating surface area" value={d.heating_surface} filled tight style={s1Row} />
        <KV label="Evaporation Capacity" value={d.evaporation_capacity} filled tight style={s1Row} />
        <KV label={'Final Temperature of Steam (Design)\nSuperheater outlet'} value={d.steam_temp} filled tight style={s1Row} />
        <KV label="Brief Description of Boiler" value={d.boiler_type} filled tight style={s1Row} />
      </View>
    </Page>,

    <Page key="iii-2" size="A4" style={s.pageNoLetterhead}>
      <ContdHeader />
      {/* Real sample runs the heading, colon, and full part-name list into one wrapping sentence
          rather than a heading line followed by a separate value line. The part-name list itself is
          deliberately plain weight, not `s.filled` — bold reads fine for a short discrete value, but
          this list runs to a full dense paragraph (every named part on the boiler), where bold just
          reads as one solid grey block; regular weight at the same size is more legible and still
          reads as data against the bold heading right before it. */}
      <Text style={{ fontSize: 8, marginTop: 8, marginBottom: 4 }}>
        <Text style={{ fontWeight: 'bold' }}>2. Name of the part(s) manufactured at constructor's works: </Text>
        <Text>{partNames}</Text>
      </Text>
      <KV label="Drawing no." value={drawingRange} filled />
      <KV label="Manufactured by" value={entity.name} filled />
      <KV label="Identification Mark" value={d.makers_no} filled />
      <Text style={{ fontSize: 8, marginTop: 4 }}>Part(s) manufactured, Inspected at all stages of Construction by ………………………………. (Inspecting authority)</Text>
      <Text style={{ fontSize: 8, marginTop: 6 }}>Part(s) hydraulically tested and inspected after test by ……………………………….</Text>

      <Text style={s.h}>3. PARTS MANUFACTURED OUTSIDE THE CONSTRUCTOR'S WORKS</Text>
      <PartsOutsideSection note={d.parts_outside_constructor_works || 'NOT APPLICABLE'} />
    </Page>,

    <Page key="iii-3" size="A4" style={s.pageNoLetterhead}>
      <ContdHeader />
      <Text style={s.h}>4. CONSTRUCTION</Text>
      <Text style={{ fontSize: 8 }}>The construction is in accordance with chapter III / V / X / XII / XIV of the Indian Boiler Regulations.</Text>
      {/* Phase 5 (QC statutory-forms plan) — real, per-document data now: dynamic belt/ring rows
          (qc_document_longitudinal_seams) plus four single-value construction facts on
          qc_documents itself. Still an honest "—" wherever nothing has been entered yet, same
          discipline as the Phase 1 fix these fields replace. */}
      <BeltSeamLines seams={seams} />
      <Text style={{ fontSize: 8 }}>No. of longitudinal seams in Furnace in each ring – <Text style={s.filled}>{furnaceRingLine(seams)}</Text></Text>
      <Text style={{ fontSize: 8 }}>No. of circumferential seams in shell/drum (including end seams) – <Text style={s.filled}>{d.circumferential_seams_shell || '—'}</Text></Text>
      <Text style={{ fontSize: 8 }}>No. of circumferential seams in the furnace – <Text style={s.filled}>{d.circumferential_seams_furnace || '—'}</Text></Text>
      <Text style={{ fontSize: 8 }}>Details of repair, if any, carried out to seams during construction – <Text style={s.filled}>{d.construction_repair_details || '—'}</Text></Text>
      <Text style={{ fontSize: 8 }}>Details of heat treatment – <Text style={s.filled}>{d.construction_heat_treatment_note || '—'}</Text></Text>
      <Text style={{ fontSize: 8, marginTop: 4 }}>All welded seams were subjected to Radiographic examination to the satisfaction of the Inspecting Authority where required.</Text>

      <Text style={s.h}>5. Details of Drums</Text>
      <GroupedEmptyTable groups={DRUMS_GROUPS} note={d.drums_details || 'Not Applicable'} />
    </Page>,

    <Page key="iii-4" size="A4" style={s.pageNoLetterhead}>
      <ContdHeader />
      <Text style={s.h}>6. Headers and Boxes</Text>
      <HeadersBoxesTable note={d.headers_boxes_details || 'Not Applicable'} />

      <Text style={s.h}>7. MOUNTINGS</Text>
      {/* Real sample names an enclosed "Form III C" explicitly, not a generic "list" phrase — SYSTEM.md
          flags this as an unconfirmed form name (no sample of it exists), so the wording matches the
          real sample's own phrasing without implying a distinct generator exists yet. */}
      <MountingsTable note={`Mountings' Form III C are enclosed${pageRangeLabel(mountingsPage)}.`} />

      <Text style={s.h}>8. Details of Safety Valves and Test Results (Regulation 4(c)(vii))</Text>
      {/* The real sample keeps this whole blank field template even when the actual data lives in an
          attached Annexure — restoring it (was reduced to one summary sentence) so the section reads
          the same as the government form. No real field on qc_documents backs any of these individual
          values, so every line stays a dotted blank, same convention as the rest of this page. */}
      {/* Each labeled sub-block wrapped in wrap={false} — a long single <Page> auto-paginating this
          much text was splitting mid-list (e.g. REMARKS' 7 lines torn across two pages) the first
          time this was checked against a real render; keeping each group atomic reads far more like
          a real printed form. */}
      <View style={{ flexDirection: 'row' }} wrap={false}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 8 }}>Manufacturer ........................................................</Text>
          <Text style={{ fontSize: 8 }}>Identification marks of Valves........................................</Text>
          <Text style={{ fontSize: 8 }}>Maker's no. ............................................................</Text>
          <Text style={{ fontSize: 8 }}>Type....................................................................</Text>
          <Text style={{ fontSize: 8 }}>Life(mm) ................................................................</Text>
        </View>
        {/* Real sample sets this in caps, oriented to the right of the dotted fields — not a bold
            line stacked below them. */}
        <View style={{ width: 190, justifyContent: 'center', paddingLeft: 8 }}>
          <Text style={{ fontSize: 8, fontWeight: 'bold', textAlign: 'center' }}>SAFETY VALVE TEST CERTIFICATE ENCLOSED WITH ANNEXURE.</Text>
        </View>
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
    </Page>,

    <Page key="iii-5" size="A4" style={s.pageNoLetterhead}>
      <ContdHeader />
      {/* Real sample runs the section number straight into the sentence — no standalone "Certificate"
          heading above it (every other numbered section on this page has no separate heading line
          either, e.g. §2's "2. Name of the part(s)..." right above). */}
      <Text style={{ fontSize: 8, marginBottom: 4, marginTop: 8 }}>
        <Text style={{ fontWeight: 'bold' }}>9. </Text>Certificate that the particulars entered herein are correct and that parts and fittings in
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
        Representative whose signature is appended hereunder.
      </Text>
      {/* Phase 5 — real fields now (least_pressure_component_name/value on qc_documents), kept
          separate per instruction so the value can eventually cross-check against the Calc module.
          Sample's own shape: "Least pressure of this component (Furnace) – 11.05 kgf/cm²". */}
      <Text style={{ fontSize: 8, marginTop: 4 }}>
        Least pressure of this component{d.least_pressure_component_name ? ` (${d.least_pressure_component_name})` : ''} – <Text style={s.filled}>{d.least_pressure_value || '—'}</Text>
      </Text>

      <SignFormIII entity={entity} />
    </Page>,
  ];
}

// Form III-H's own page — NOT built on the generic FormTablePage below, because the real sample's
// header block (T.C. No, Design Pressure/Temp, Hydraulic Test Pressure, NDT, Inspecting Authority ID
// Mark) is genuinely richer than IIIA/IVA's plain "doc_id · Maker's No" line; forcing it through the
// generic page would silently drop real fields. Portrait, not landscape — IIIH_COLS is only 5 columns.
function FormIIIHPage({ document: d, entity, parts, project }) {
  return (
    <Page size="A4" style={s.pageNoLetterhead}>
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
    </Page>
  );
}

// P.No is a stored sort key (see qc-bom-sync.js's sortOrder), not a display index — a form's own
// numbering must run 1..n within whatever subset of parts it actually shows (the sample's Form IV A
// numbering skips the rows pulled out into Form III A), so it's recomputed here per render, per form,
// never written back to qc_document_parts.
const renumber = parts => parts.map((p, i) => ({ ...p, part_no: String(i + 1) }));

// Only ever used for Form IV A (confirmed — every call site is in the 'IVA' case below), so its
// title/preamble text is hardcoded here rather than threaded through every call site as a prop.
//
// ONE <Page> for the whole form, not one per lettered section — every group's heading + its own
// MaterialTable (which already repeats its own `fixed` header at the top of any physical page it
// spills onto, the same mechanism this file's other long tables already rely on) are stacked in a
// single flow, so react-pdf's own auto-pagination decides where the real page breaks land: a short
// group is followed immediately by the next group's heading on the same physical page (with just
// `marginTop` breathing room between them), and a forced break only happens when content genuinely
// doesn't fit — matching how this section actually reads on a real filed certificate, where the
// groups aren't each padded out to their own page. `sections` is always non-empty (the 'IVA' case
// below guarantees at least one entry, labelled or not); the preamble sentence and the sign-off/
// Place:/Date: block each render exactly once, at the very top and very bottom of the whole form.
function FormTablePage({ document: d, entity, cols, sections }) {
  return (
    <Page size="A4" orientation="landscape" style={s.pageLNoLetterhead}>
      <Text style={s.title}>FORM – IV A</Text>
      <Text style={s.sub}>REGULATION 4 (c) (IV)</Text>
      <Text style={s.code}>{d.doc_id}</Text>
      <Text style={{ fontSize: 8, marginBottom: 6 }}>
        It is hereby certificate that original Steel makers certificate in <Text style={{ fontWeight: 'bold' }}>Form IV</Text> contain
        the following information in respect of the material used in the manufacture of the boiler or parts there of bearing makers no.
        <Text style={s.filled}>{d.makers_no || '—'}</Text>
      </Text>
      {sections.map((sec, i) => (
        <View key={sec.key} style={i > 0 ? { marginTop: 14 } : undefined}>
          <MaterialTable cols={cols} parts={renumber(sec.parts)} groupLabel={sec.sectionLabel} />
        </View>
      ))}
      <View wrap={false} style={{ marginTop: 14 }}>
        <Sign />
        <Text style={{ fontSize: 7, marginTop: 10 }}>Place:</Text>
        <Text style={{ fontSize: 7 }}>Date:</Text>
      </View>
    </Page>
  );
}

// Form III A — a per-named-sub-assembly certificate (real sample SB-1097's "Feed pipeline"), NOT a
// copy of Form IV A: its own header block (design pressure/temp genuinely differ from the boiler's —
// the sample's feed pipeline is 8.75 kg/cm² against a 7 kg/cm² boiler) plus a materials table scoped
// to only that group's own parts. Table columns are IIIA_MATERIAL_COLS — the same shared base as
// Form IV A's own IVA_MATERIAL_COLS, plus Steel Making Process/Heat Treatment (real, stored
// per-certificate columns test_certificates.steel_making_process/heat_treatment).
function FormIIIAGroupPage({ document: d, entity, group: g, parts }) {
  // parseFloat, not Number — design_pressure is a free-text field (QC may type "7 Kgf/cm2" rather
  // than a bare "7"); Number() on that returns NaN and would print the literal string "NaN" into the
  // PDF's attestation paragraph. Number.isFinite guards the derived value the same way.
  const designPressureNum = parseFloat(g.design_pressure);
  const derivedHydro = Number.isFinite(designPressureNum) ? (designPressureNum * 1.5).toFixed(3).replace(/0+$/, '').replace(/\.$/, '') : null;
  const hydroPressure = g.hydro_test_pressure || derivedHydro;
  // Real sample: a numbered "1-" through "10-" list, not plain unnumbered KV rows. Item 5 ("Main
  // dimensions...") was previously missing entirely, and a "Drawing No." item was tacked on at #10
  // instead — the real sample has no such item; its drawing number only ever appears in the closing
  // certification paragraph below (already wired via the same g.linked_drawing_dg_no/drawing_no
  // fallback), so it's removed here rather than shown twice in two different forms. No stored field
  // exists for item 5's own value — it's genuine boilerplate on the real sample too (directing the
  // reader to the enclosed test certificate, same convention as item 4's own real value), not a
  // fabricated fact, since the table right below already carries the actual dimensional data.
  const items = [
    ['Makers name & Address', entity.name],
    ['Design Pressure', g.design_pressure ? `${g.design_pressure} Kgf/cm²(g)` : null],
    ['Design Temperature', g.design_temp],
    ['Process of manufacture', g.process_of_manufacture],
    ['Main dimensions, Tolerance, mode of manufacture, drawing nos., Flattening test, etc.', 'As per test certificate enclosed'],
    ['Mode of attachment of flanges', g.mode_of_flange_attachment],
    ['Flange particulars', g.flange_particulars],
    ['Size of branch & Attachment', g.size_of_branch],
    ['Heat treatment', g.heat_treatment],
    ['Identification marks', g.identification_marks],
  ];
  return (
    <Page size="A4" orientation="landscape" style={s.pageLNoLetterhead}>
      <Text style={s.title}>FORM III A</Text>
      <Text style={s.sub}>Certificate of manufacture and Test</Text>
      <Text style={s.sub}>Regulations 4(e)</Text>
      <Text style={s.code}>{d.doc_id}</Text>
      {/* Real sample: its own standalone bold line, not merged into a doc-id/maker's-no identifier
          line the way the old docId-based version did (neither actually appears on this page). */}
      <Text style={{ fontSize: 8, fontWeight: 'bold', marginTop: 4, marginBottom: 4 }}>Name of the part: {g.name}</Text>
      {/* `s.lblTight` (auto-width label, small fixed gap) instead of `s.lbl`'s fixed 150pt column —
          the fixed column left a big dead gap after short labels ("Heat treatment", "Identification
          marks") while barely fitting the longest one, since one fixed width can't fit both; the
          landscape page has plenty of room for item 5's own long boilerplate label either way. */}
      {items.map(([label, value], i) => (
        <View key={i} style={s.row}>
          <Text style={{ width: 14 }}>{i + 1}-</Text>
          <Text style={s.lblTight}>{label}</Text>
          <Text style={[s.val, s.filled]}>: {value || '—'}</Text>
        </View>
      ))}
      <MaterialTable cols={IIIA_MATERIAL_COLS} parts={renumber(parts)} />
      {/* Real sample's closing certification is three separate "*"-bulleted lines, and the sign-off
          has a third line (Inspecting Authority) plus Place/Date the old version dropped — all
          wrapped together so a page break can't tear the block apart. */}
      <View wrap={false}>
        <Text style={{ marginTop: 8, fontSize: 7, lineHeight: 1.4 }}>* Certified that the particulars entered herein are correct.</Text>
        <Text style={{ fontSize: 7, lineHeight: 1.4 }}>* The particulars of fabricated components shown in the drawing no. <Text style={s.filled}>{g.linked_drawing_dg_no || g.drawing_no || '—'}</Text>.</Text>
        <Text style={{ fontSize: 7, lineHeight: 1.4, marginBottom: 6 }}>
          * The part has been designed and constructed to comply with the Indian Boiler Regulations for a working pressure of <Text style={s.filled}>{g.design_pressure || '—'} Kgf/cm²(g)</Text>
          {g.design_temp ? <Text style={s.filled}> & temperature {g.design_temp}</Text> : null} & satisfactorily withstood a water test of <Text style={s.filled}>{hydroPressure || '—'} Kgf/cm²(g)</Text>
          {g.hydro_test_date ? <Text style={s.filled}> on dated {g.hydro_test_date}</Text> : null} in the presence of our responsible representative, whose signature is appended hereunder.
        </Text>
        {/* Two real aligned columns, not a signRow pair plus two loose full-width lines below it —
            left: Maker's Representative, then Place:/Date: stacked directly under it; right: Maker,
            then Name & Signature of Inspecting Authority directly under it. The old layout right-
            aligned the Inspecting-Authority line to the page edge (not to the "Maker" box above it)
            and left Place:/Date: as plain full-width lines with no left/right association at all. */}
        <View style={[s.signRow, { alignItems: 'flex-start' }]} wrap={false}>
          <View style={{ width: '45%' }}>
            <Text style={[s.signBox, { width: '100%' }]}>Maker's Representative{'\n'}(Name & signature)</Text>
            {/* Centered to match the signature caption's own centering above — a left-aligned Place/
                Date sat flush against the page margin instead of under the caption it belongs to. */}
            <Text style={{ fontSize: 7, marginTop: 16, textAlign: 'center' }}>Place:</Text>
            <Text style={{ fontSize: 7, marginTop: 8, textAlign: 'center' }}>Date:</Text>
          </View>
          <View style={{ width: '45%' }}>
            <Text style={[s.signBox, { width: '100%' }]}>Maker</Text>
            <Text style={{ fontSize: 7, marginTop: 16, textAlign: 'center' }}>Name & Signature of Inspecting Authority</Text>
          </View>
        </View>
      </View>
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

// "Page N of Total" on every physical page of the final assembled document — including the
// appended supplier TC PDFs — stamped once at the very end via pdf-lib, not react-pdf's own
// pageNumber/totalPages render-prop. That prop only counts pages within the <Document> it's
// rendered in, and every section here (letter, each form, mountings) is its own separate tiny
// <Document> per renderSection() above — a react-pdf counter would restart at "Page 1" for every
// section instead of reflecting the true position in the merged 20-30 page folder. pdf-lib knows
// the real total because it runs after every section AND the certificate pages already exist as
// real pages in `out`. Bottom-right, same house style as lib/report-pdf.js's ReportFooter.
async function stampPageNumbers(doc) {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const total = pages.length;
  pages.forEach((page, i) => {
    const { width } = page.getSize();
    const text = `Page ${i + 1} of ${total}`;
    const size = 7;
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: width - 24 - textWidth, y: 10, size, font, color: rgb(0.4, 0.4, 0.4) });
  });
}

export async function renderQcFolderPdf(document, parts, mountings, project, groups, form4aGroups, seams) {
  const d = document;
  mountings = mountings || [];
  groups = groups || [];
  form4aGroups = form4aGroups || [];
  seams = seams || [];
  const entity = entityForMaker(d.makers_no);
  // Form set follows the PROJECT's equipment model (projects.series); the document's own `series`
  // is a legacy default ('SF') and not authoritative here.
  const model = modelConfig(project?.series || d.series);
  // Mutually exclusive by construction (lib/qc-bom-sync.js's iiia_group_id) — a grouped part never
  // also appears on Form IV A, which is what stops the two forms from rendering identically.
  const ungrouped = parts.filter(p => !p.iiia_group_id);
  // Form IV A's own manual lettered sections — QC-driven (qc_form4a_groups), not BOM-tree-derived
  // (see lib/qc-form4a-sections.mjs's own header for why the old auto-derivation was replaced).
  // form4aGroups empty (QC hasn't created any) -> ivaSections.sections is empty and every part
  // falls into ivaSections.ungrouped, rendered as one flat table with no section heading at all.
  const ivaSections = buildManualSections(form4aGroups, ungrouped);
  const formPage = (f, extra) => {
    switch (f) {
      case 'II1': return <FormII1Page key={f} document={d} entity={entity} />;
      case 'XVII': return <FormII1Page key={f} document={d} entity={entity} small />;
      case 'III': return <FormIIIPage key={f} document={d} entity={entity} project={project} model={model} parts={parts} mountingsPage={extra?.mountingsPage} seams={seams} />;
      // Zero groups -> render nothing for this form, never fall back to dumping every part (that
      // would silently reproduce Form III A == Form IV A, the exact bug this feature fixes).
      case 'IIIA': return groups.map(g => (
        <FormIIIAGroupPage key={`iiia-${g.id}`} document={d} entity={entity} group={g}
          parts={parts.filter(p => p.iiia_group_id === g.id)} />
      ));
      // Zero manual groups (QC hasn't created any) -> one plain page, no heading at all. Otherwise:
      // every lettered section's own heading + table, stacked in one continuous flow (FormTablePage's
      // own comment explains why — no forced page break between groups, only where content genuinely
      // doesn't fit), plus a trailing UNLABELED section for any part QC hasn't assigned to a group yet
      // — deliberately never "Ungrouped Materials" or any other synthetic heading (direct
      // instruction), since every real material still has to print on the certificate even when a QC
      // user hasn't (yet, or ever) organized it under a named group.
      case 'IVA': {
        const sections = ivaSections.sections.map(sec => (
          { key: `iva-${sec.letter}`, sectionLabel: `${sec.letter}. ${sec.name}`, parts: sec.parts }
        ));
        // An ungrouped section is added whenever there are real ungrouped parts to show — or, if
        // there are no named sections at all either, as the one guaranteed entry so `sections` is
        // never empty (an entirely-empty Form IV A still needs to exist in the printed folder).
        if (ivaSections.ungrouped.length || !sections.length) {
          sections.push({ key: 'iva-ungrouped', sectionLabel: null, parts: ivaSections.ungrouped });
        }
        return <FormTablePage key={f} document={d} entity={entity} cols={IVA_MATERIAL_COLS} sections={sections} />;
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
  // These three are fully independent of each other (none reads another's result) but used to run
  // sequentially — mountingsSection and certFiles (an R2 network fetch per certificate) both waited
  // for the form-key renders to finish first for no reason. Running them concurrently overlaps the
  // R2 fetch and the mounting-list render with the (usually slower, CPU-bound) form rendering
  // instead of adding to it. Measured live: on a document with 224 parts/12 lettered sections and
  // only 1 small certificate, this barely moved the needle (form rendering is synchronous CPU work
  // that dominates and can't itself be parallelized this way) — but it's a real win on a document
  // with several/large certificate PDFs, since loadCertPdfs' R2 fetches are genuine async I/O that
  // can now overlap with the form rendering, and it's harmless either way (no shared state between
  // the three, confirmed before making this change).
  const [formSections, mountingsSection, certFiles] = await Promise.all([
    Promise.all(model.forms.map(async f => ({ key: f, ...(await renderSection(formPage(f))) }))),
    renderSection(<MountingListPage document={d} mountings={mountings} entity={entity} />),
    loadCertPdfs(parts),
  ]);
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
  await stampPageNumbers(out);

  return Buffer.from(await out.save());
}