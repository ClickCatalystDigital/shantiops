// Real generated Purchase Order PDF (§5a) — mirrors lib/packing-pdf.js exactly (same
// @react-pdf/renderer approach, pure Node, no headless browser) but matches the layout of the
// business's actual hand-made POs (samples: 578/SB/2025-26, 562/SB/2026-27 (split-po)): fixed
// Shanti header/GST, supplier block, PO meta, line table, terms + totals, sign-off.
import React from 'react';
import { Document, Page, View, Text, StyleSheet, Svg, G, Rect, Path, Circle, renderToBuffer } from '@react-pdf/renderer';
import { companyProfile } from './qc-doc-pdf.js';

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 8, fontFamily: 'Helvetica', color: '#111' },
  center: { textAlign: 'center' },
  company: { fontSize: 13, fontWeight: 'bold' },
  sub: { fontSize: 7, color: '#555', marginTop: 2 },
  // "PURCHASE ORDER" banner — thin black rule, bigger/bolder title, thin black rule again.
  titleBlock: { marginTop: 4, marginBottom: 10 },
  titleRule: { height: 1, backgroundColor: '#000' },
  title: { fontSize: 13, fontWeight: 'bold', letterSpacing: 1, textAlign: 'center', paddingVertical: 3 },
  // Shanti Boilers-only letterhead (§ PO header redesign) — logo + stacked SHANTI/BOILERS wordmark,
  // an orange rule under BOILERS scoped to exactly that word's own rendered width (sbBoilersWrap
  // below, alignSelf:'flex-start', so the rule can never be wider or narrower than the word). The
  // tagline, the second orange rule, and the motto line are all siblings inside `sbTextCol` (not
  // `sbRow`), so they share the wordmark's own left edge and its resolved width automatically —
  // no hardcoded pixel width to re-measure if a font size ever changes. Shanti Techno Fab keeps
  // the plain centered name/sub block below (`s.center`/`s.company`/`s.sub`), untouched.
  sbRow: { flexDirection: 'row', alignItems: 'center' },
  sbTextCol: { marginLeft: 10 },
  sbNameRow: { flexDirection: 'row', alignItems: 'flex-start' },
  sbName: { fontSize: 22, fontWeight: 'bold', color: '#0F2A4D', letterSpacing: 0.5, lineHeight: 1 },
  sbTm: { width: 7, height: 7, borderRadius: 3.5, borderWidth: 0.8, borderColor: '#0F2A4D', alignItems: 'center', justifyContent: 'center', marginLeft: 1.5, marginTop: 1 },
  sbTmText: { fontSize: 3.5, fontWeight: 'bold', color: '#0F2A4D' },
  sbBoilersWrap: { alignSelf: 'flex-start' },
  sbRuleShort: { height: 2, backgroundColor: '#F45D20', marginTop: 2 },
  sbTagline: { fontSize: 7, color: '#5B6B7C', letterSpacing: 2.4, marginTop: 1 },
  sbRuleFull: { height: 2, backgroundColor: '#F45D20', marginTop: 3, marginBottom: 3 },
  sbMotto: { fontSize: 6.5, fontWeight: 'bold', color: '#0F2A4D', letterSpacing: 0.6, textAlign: 'center' },
  metaRow: { flexDirection: 'row', marginBottom: 10 },
  metaCol: { width: '50%' },
  metaLine: { flexDirection: 'row', paddingVertical: 1 },
  metaLabel: { color: '#666', width: 70 },
  metaVal: { fontWeight: 'bold', flex: 1 },
  tHead: { flexDirection: 'row', backgroundColor: '#eee', borderTopWidth: 1, borderBottomWidth: 1, borderLeftWidth: 1, borderColor: '#999' },
  tRow: { flexDirection: 'row', borderBottomWidth: 1, borderLeftWidth: 1, borderColor: '#ddd', minHeight: 14 },
  cell: { paddingVertical: 3, paddingHorizontal: 3, borderRightWidth: 1, borderColor: '#ddd' },
  termsRow: { flexDirection: 'row', marginTop: 10 },
  termsCol: { width: '55%' },
  totalsCol: { width: '45%' },
  termLine: { flexDirection: 'row', paddingVertical: 1 },
  termLabel: { color: '#666', width: 90 },
  totalLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2, paddingHorizontal: 4 },
  grandTotal: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, paddingHorizontal: 4, borderTopWidth: 1, borderColor: '#333', fontWeight: 'bold' },
  instructions: { marginTop: 12, fontSize: 7, fontWeight: 'bold' },
  footerNote: { marginTop: 8, fontSize: 7 },
  signRow: { flexDirection: 'row', marginTop: 26, justifyContent: 'space-between' },
  signBox: { width: '45%', borderTopWidth: 1, borderColor: '#333', paddingTop: 4, textAlign: 'center', fontSize: 7 },
  addrBlock: { marginTop: 14, fontSize: 7, lineHeight: 1.4 },
});

// Column widths (sum = 100).
const COLS = [['S.No', 6], ['Description', 40], ['Qty', 10], ['UoM', 10], ['Rate', 16], ['Amount', 18]];

function Meta({ label, value }) {
  return (
    <View style={s.metaLine}>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={s.metaVal}>{value || '—'}</Text>
    </View>
  );
}

// Phase 4 (QC statutory-forms plan) — a compact requirement note under the description, so the
// supplier receiving this document can actually see what Engineering flagged, not just Procurement
// inside the app. Same 4-flag shape as components/TraceabilityBadges.jsx, restated here since that's
// a client component and this file renders server-side into a PDF.
const REQ_LABELS = [
  ['requires_heat_no', 'Heat No.'], ['requires_mtc', 'MTC'],
  ['requires_supplier_batch', 'Supplier Batch'], ['requires_serial_no', 'Serial No.'],
];
function traceabilityNote(it) {
  const active = REQ_LABELS.filter(([f]) => it[f]).map(([, label]) => label);
  return active.length ? `${active.join(', ')} required` : null;
}

function Row({ it, i }) {
  const note = traceabilityNote(it);
  const vals = [i + 1, it.description, it.qty, it.uom, fmt(it.rate), fmt(it.amount)];
  return (
    <View style={s.tRow} wrap={false}>
      {COLS.map(([, w], j) => (
        j === 1 ? (
          <View key={j} style={[s.cell, { width: `${w}%` }]}>
            <Text>{vals[j] ?? '—'}</Text>
            {note && <Text style={{ fontSize: 6, color: '#555', marginTop: 1 }}>{note}</Text>}
          </View>
        ) : (
          <Text key={j} style={[s.cell, { width: `${w}%` }]}>{vals[j] ?? '—'}</Text>
        )
      ))}
    </View>
  );
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// The same orange app mark used on the QC Statutory Folder's cover letter (lib/qc-folder-pdf.js's
// own Logo) — duplicated here on purpose rather than imported, matching this codebase's own
// precedent of each generated-PDF file staying self-contained (see po-pdf.js's own header comment).
function Logo({ size = 44 }) {
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

function ShantiBoilersHeader() {
  return (
    <View style={{ marginBottom: 4 }}>
      <View style={s.sbRow}>
        <Logo size={52} />
        <View style={s.sbTextCol}>
          <View style={s.sbNameRow}>
            <Text style={s.sbName}>SHANTI</Text>
            <View style={s.sbTm}><Text style={s.sbTmText}>TM</Text></View>
          </View>
          <View style={s.sbBoilersWrap}>
            <Text style={s.sbName}>BOILERS</Text>
            <View style={s.sbRuleShort} />
          </View>
          <Text style={s.sbTagline}>HEATING SOLUTIONS</Text>
          <View style={s.sbRuleFull} />
          <Text style={s.sbMotto}>TRUST • PERFORMANCE • EFFICIENCY</Text>
        </View>
      </View>
    </View>
  );
}

function PoDoc({ po, items }) {
  const subTotal = items.reduce((a, it) => a + Number(it.amount || 0), 0);
  const discountAmt = subTotal * (Number(po.discount_pct) || 0) / 100;
  const taxable = subTotal - discountAmt;
  const gstAmt = taxable * (Number(po.gst_pct) || 0) / 100;
  const grandTotal = taxable + gstAmt;
  const profile = companyProfile(po.company);
  const isBoilers = po.company !== 'Shanti Techno Fab';

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {isBoilers ? <ShantiBoilersHeader /> : (
          <View style={s.center}>
            <Text style={s.company}>{profile.name}</Text>
            <Text style={s.sub}>{profile.sub}</Text>
          </View>
        )}
        <View style={s.titleBlock}>
          <View style={s.titleRule} />
          <Text style={s.title}>PURCHASE ORDER{po.is_split ? ' (SPLIT-PO)' : ''}</Text>
          <View style={s.titleRule} />
        </View>

        <View style={s.metaRow}>
          <View style={s.metaCol}>
            <Text style={{ fontWeight: 'bold', marginBottom: 3 }}>M/s. {po.supplier_name}</Text>
            <Meta label="Address" value={po.supplier_address} />
            <Meta label="Phone" value={po.supplier_phone} />
            <Meta label="Email" value={po.supplier_email} />
            <Meta label="GST No" value={po.supplier_gst} />
          </View>
          <View style={s.metaCol}>
            <Meta label="PO No" value={po.po_no} />
            <Meta label="PO Date" value={fmtDate(po.created_at)} />
            <Meta label="Quotation" value={po.quote_source} />
            <Meta label="Quote Date" value={po.quote_date} />
            <Meta label="Indent / Job" value={po.indent_ref} />
          </View>
        </View>

        <Text style={{ marginBottom: 6 }}>
          Dear Sir, please supply the following material/services to the terms and conditions stated below:-
        </Text>

        <View style={s.tHead}>
          {COLS.map(([label, w], i) => (
            <Text key={i} style={[s.cell, { width: `${w}%`, fontWeight: 'bold' }]}>{label}</Text>
          ))}
        </View>
        {items.map((it, i) => <Row key={it.id} it={it} i={i} />)}

        <View style={s.termsRow}>
          <View style={s.termsCol}>
            <View style={s.termLine}><Text style={s.termLabel}>Payment Terms:-</Text><Text>{po.payment_terms || '—'}</Text></View>
            <View style={s.termLine}><Text style={s.termLabel}>Delivery Schedule:-</Text><Text>{po.delivery_schedule}</Text></View>
            <View style={s.termLine}><Text style={s.termLabel}>Transportation:-</Text><Text>{po.transportation}</Text></View>
            <View style={s.termLine}><Text style={s.termLabel}>Freight:-</Text><Text>{po.freight}</Text></View>
            <View style={s.termLine}><Text style={s.termLabel}>Guarantee:-</Text><Text>{po.guarantee}</Text></View>
          </View>
          <View style={s.totalsCol}>
            <View style={s.totalLine}><Text>Sub Total</Text><Text>{fmt(subTotal)}</Text></View>
            <View style={s.totalLine}><Text>Discount {po.discount_pct}%</Text><Text>{fmt(discountAmt)}</Text></View>
            <View style={s.totalLine}><Text>GST @ {po.gst_pct}%</Text><Text>{fmt(gstAmt)}</Text></View>
            <View style={s.grandTotal}><Text>GRAND TOTAL</Text><Text>{fmt(grandTotal)}</Text></View>
          </View>
        </View>

        <Text style={s.instructions}>
          {po.special_instructions ||
            'SPECIAL INSTRUCTIONS: ALL GOODS SHOULD BE SUPPLIED STRICTLY IN ACCORDANCE WITH THE SPECIFICATION MENTIONED IN THIS PURCHASE ORDER'}
        </Text>
        <Text style={s.footerNote}>
          PLEASE ACKNOWLEDGE THE RECEIPT OF THE ORDER &amp; INFORM US CONFIRMED DELIVERY DATE.
        </Text>

        <View style={s.addrBlock}>
          <Text style={{ fontWeight: 'bold' }}>DELIVERY &amp; INVOICE ADDRESS</Text>
          <Text>{po.delivery_address || `${profile.name}, OFFICE / FACTORY: ${profile.sub}`}</Text>
        </View>

        <View style={s.signRow}>
          <Text style={s.signBox}>ACCEPTED</Text>
          <Text style={s.signBox}>For {profile.name}.{'\n'}Purchase Dept // Authorized Signatory</Text>
        </View>
      </Page>
    </Document>
  );
}

function fmtDate(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d)) return v;
  return d.toLocaleDateString('en-GB'); // dd/mm/yyyy, matches the sample POs' dd.mm.yyyy style closely enough
}

export async function renderPoPdf(po, items) {
  return renderToBuffer(<PoDoc po={po} items={items} />);
}
