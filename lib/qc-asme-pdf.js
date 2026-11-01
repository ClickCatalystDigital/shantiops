// lib/qc-asme-pdf.js — the US QC folder: the ASME record package for one boiler or vessel, on Letter paper.
// lib/qc-folder-pdf.js hands a document filed as ASME (ibr_version 'asme', US build only) to this file;
// the Indian IBR pages are never reached from here. Pages, in the order an Authorized Inspector reviews them:
//   1. Record package index (letterhead)
//   2. Manufacturer's Data Report: Form P-2 (Section I firetube boiler) or Form U-1A (Section VIII Div. 1 vessel)
//   3. Weld map: shell sketch with seam IDs, then each weld's WPS, PQR, welder stamps and NDE
//   4. Welding procedures (WPS / PQR) and welder qualification continuity (QW-322)
//   5. Material test reports by heat number
//   6. Nondestructive examination records
//   7. Postweld heat treatment and hydrostatic test records
// Data: the document's header fields (stored metric, printed in US customary units) and asme_data (lib/qc-asme.mjs).
// ponytail: our own layout carrying the report's fields in the code's order, not a facsimile of the printed ASME form.
import React from 'react';
import { Document, Page, View, Text, StyleSheet, Svg, Rect, Line, Ellipse, Text as SvgText, renderToBuffer } from '@react-pdf/renderer';
import { PDFDocument } from 'pdf-lib';
import { ASME_FORMS, asmeForm, parseAsmeData, continuityRows } from './qc-asme.mjs';
import { toImperial, trim } from './units.mjs';
import { entityForMaker, QC_AUTHORITY } from './qc-entities.js';
import { todayISO } from './date.js';
import { formatDate } from './format.js';

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingHorizontal: 36, paddingBottom: 44, fontSize: 8, fontFamily: 'Helvetica', color: '#111', lineHeight: 1.35 },
  h1: { fontSize: 11, fontFamily: 'Helvetica-Bold', textAlign: 'center', marginBottom: 2 },
  h2: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginTop: 10, marginBottom: 4, borderBottom: '0.75 solid #111', paddingBottom: 2 },
  sub: { fontSize: 7.5, textAlign: 'center', color: '#444', marginBottom: 8 },
  row: { flexDirection: 'row', borderBottom: '0.5 solid #bbb', minHeight: 14, alignItems: 'center' },
  label: { width: 190, color: '#444', paddingRight: 6 },
  value: { flex: 1, fontFamily: 'Helvetica-Bold' },
  th: { fontFamily: 'Helvetica-Bold', backgroundColor: '#eee', padding: 3, borderRight: '0.5 solid #999', fontSize: 7 },
  td: { padding: 3, borderRight: '0.5 solid #ccc', fontSize: 7 },
  tr: { flexDirection: 'row', borderBottom: '0.5 solid #ccc', borderLeft: '0.5 solid #ccc' },
  note: { fontSize: 7, color: '#555', marginTop: 6 },
  sign: { flexDirection: 'row', marginTop: 18, gap: 24 },
  signBox: { flex: 1, borderTop: '0.75 solid #111', paddingTop: 3, fontSize: 7.5 },
  footer: { position: 'absolute', bottom: 20, left: 36, right: 36, fontSize: 7, color: '#666', flexDirection: 'row', justifyContent: 'space-between' },
});

const dash = v => (v === null || v === undefined || v === '' ? '—' : String(v));
const psi = kgcm2 => (kgcm2 === '' || kgcm2 == null ? '—' : `${trim(toImperial(kgcm2, 'kg/cm2'), 0)} psi`);
const degF = c => (c === '' || c == null ? '—' : `${trim(toImperial(c, 'C'), 0)} °F`);
const inch = mm => (mm === '' || mm == null ? '—' : `${trim(toImperial(mm, 'mm'), 2)} in`);
const ftIn = mm => {
  if (mm === '' || mm == null) return '—';
  const total = toImperial(mm, 'mm'); const ft = Math.floor(total / 12);
  return `${ft} ft ${trim(total - ft * 12, 1)} in`;
};
const sqft = m2 => (m2 === '' || m2 == null ? '—' : `${trim(toImperial(m2, 'm2'), 0)} sq ft`);
const lbhr = kg => (kg === '' || kg == null ? '—' : `${Number(trim(toImperial(kg, 'kg/hr'), 0)).toLocaleString('en-US')} lb/hr`);
const inches = v => (v === '' || v == null ? '—' : `${v} in`);

function KV({ label, value }) {
  return <View style={s.row}><Text style={s.label}>{label}</Text><Text style={s.value}>{dash(value)}</Text></View>;
}
function Table({ cols, rows }) {
  return (
    <View>
      <View style={[s.tr, { borderTop: '0.5 solid #999' }]}>{cols.map(c => <Text key={c.h} style={[s.th, { width: c.w }]}>{c.h}</Text>)}</View>
      {rows.length ? rows.map((r, i) => (
        <View key={i} style={s.tr} wrap={false}>{cols.map(c => <Text key={c.h} style={[s.td, { width: c.w }]}>{dash(c.v(r))}</Text>)}</View>
      )) : <View style={s.tr}><Text style={[s.td, { width: '100%', color: '#666' }]}>None recorded.</Text></View>}
    </View>
  );
}
function Footer({ d }) {
  return (
    <View style={s.footer} fixed>
      <Text>{d.doc_id} · {d._form} · {d._entity.name}</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}
function Title({ children, sub }) {
  return <View><Text style={s.h1}>{children}</Text>{sub ? <Text style={s.sub}>{sub}</Text> : null}</View>;
}

function IndexPage({ d, a, project }) {
  const e = d._entity;
  const items = ["Manufacturer's Data Report, " + d._form, 'Weld map with welder stamps', 'Welding procedures (WPS / PQR) and welder continuity (QW-322)',
    'Material test reports by heat number', 'Nondestructive examination records', 'Postweld heat treatment and hydrostatic test records'];
  return (
    <Page size="LETTER" style={s.page}>
      <Text style={{ fontSize: 13, fontFamily: 'Helvetica-Bold', textAlign: 'center' }}>{e.name}</Text>
      <Text style={s.sub}>{e.address}{e.contact?.website ? ` · ${e.contact.website}` : ''}</Text>
      <Title sub={`${ASME_FORMS[d._form].code}${a.edition ? `, ${a.edition} Edition` : ''}`}>ASME CODE RECORD PACKAGE</Title>
      <KV label="Document" value={d.doc_id} />
      <KV label={`${ASME_FORMS[d._form].noun} serial number`} value={d.makers_no} />
      <KV label="National Board number" value={a.nb_no} />
      <KV label="Customer" value={project?.customer_name} />
      <KV label="Job" value={project?.project_no} />
      <KV label="Year built" value={d.year_of_make} />
      <KV label="Authorized Inspector" value={a.inspector ? `${a.inspector.name}, ${a.inspector.agency}` : QC_AUTHORITY.name} />
      <Text style={s.h2}>Contents</Text>
      {items.map((t, i) => <Text key={t} style={{ marginBottom: 3 }}>{i + 1}.  {t}</Text>)}
      <Text style={s.note}>Prepared {formatDate(d.submission_date || todayISO())}. Material test reports from the mills follow the records where a scan is on file.</Text>
      <View style={s.sign}>
        <Text style={s.signBox}>{d.signer_name || 'Quality Control Manager'}{'\n'}Quality Control, {e.name}</Text>
        <Text style={s.signBox}>Reviewed by the Authorized Inspector</Text>
      </View>
      <Footer d={d} />
    </Page>
  );
}

function DataReportPage({ d, a, project }) {
  const e = d._entity; const f = ASME_FORMS[d._form];
  const vessel = d._form === 'U-1A';
  const sv = a.safety_valves || [];
  return (
    <Page size="LETTER" style={s.page}>
      <Title sub={`As required by the provisions of the ${f.code}`}>{f.title}</Title>
      <Text style={s.h2}>1–4. Identification</Text>
      <KV label="1. Manufactured and certified by" value={`${e.name}, ${e.address}`} />
      <KV label="2. Manufactured for" value={project?.customer_name} />
      <KV label="3. Location of installation" value={a.location || project?.customer_name} />
      <KV label={`4. Type`} value={d.boiler_type} />
      <KV label="    Manufacturer's serial no. / National Board no." value={`${dash(d.makers_no)} / ${dash(a.nb_no)}`} />
      <KV label="    Drawing no. / Year built" value={`${dash(d.drawing_no)} / ${dash(d.year_of_make)}`} />
      <KV label="5. Code edition and addenda" value={a.edition ? `${a.edition} Edition` : null} />
      <Text style={s.h2}>{vessel ? '6–8. Shell, seams and heads' : '6–9. Shell, joints, heads and tubesheets'}</Text>
      <KV label="Shell material (spec, grade)" value={a.shell?.spec} />
      <KV label="Shell nominal thickness / corrosion allowance" value={`${inches(a.shell?.thk_in)} / ${inches(a.corrosion_in)}`} />
      <KV label="Inside diameter / overall length" value={`${inch(d.internal_diameter)} / ${ftIn(d.length_overall)}`} />
      <KV label="Longitudinal seams" value={(a.welds || []).filter(w => w.category === 'A').map(w => `${w.id} ${w.type}, ${w.nde}`).join('; ')} />
      <KV label="Circumferential seams" value={(a.welds || []).filter(w => w.category === 'B').map(w => `${w.id} ${w.type}, ${w.nde}`).join('; ')} />
      <KV label={vessel ? 'Heads (material, thickness, type)' : 'Tubesheets (material, thickness)'} value={a.heads ? `${a.heads.spec}, ${inches(a.heads.thk_in)}, ${a.heads.type}` : null} />
      {vessel ? null : <KV label="Tubes (material, OD x thickness, number)" value={a.tubes ? `${a.tubes.spec}, ${a.tubes.od_in} in x ${a.tubes.thk_in} in, ${a.tubes.count}` : null} />}
      {vessel ? null : <KV label="Furnace (material, OD x thickness x length)" value={a.furnace ? `${a.furnace.spec}, ${a.furnace.od_in} in x ${a.furnace.thk_in} in x ${a.furnace.length_in} in` : null} />}
      <Text style={s.h2}>{vessel ? '9–11. Design and test' : '10–14. Design, capacity and test'}</Text>
      <KV label="Maximum allowable working pressure" value={`${psi(d.design_pressure)} at ${a.mawp_temp_f ? `${a.mawp_temp_f} °F` : degF(d.steam_temp)}`} />
      {vessel ? <KV label="Minimum design metal temperature" value={a.mdmt_f != null ? `${a.mdmt_f} °F at ${psi(d.design_pressure)}` : null} /> : null}
      {vessel ? null : <KV label="Heating surface" value={sqft(d.heating_surface)} />}
      {vessel ? null : <KV label="Maximum designed steaming capacity" value={lbhr(d.evaporation_capacity)} />}
      <KV label="Hydrostatic test pressure" value={`${psi(d.hydro_test_pressure)}${d.hydro_test_date ? ` on ${formatDate(d.hydro_test_date)}` : ''}`} />
      <KV label="Postweld heat treatment" value={a.pwht ? (a.pwht.required ? `${a.pwht.temp_f} °F, ${a.pwht.hold_hr} hr hold` : `Not required: ${a.pwht.basis}`) : null} />
      <KV label={vessel ? 'Supports' : 'Safety valves (number, size, set, capacity)'} value={vessel ? a.supports
        : sv.map(v => `${v.size}, set ${v.set_psi} psi, ${Number(v.capacity).toLocaleString('en-US')} lb/hr`).join('; ')} />
      {(a.nozzles || []).length ? <View><Text style={s.h2}>Nozzles and openings</Text>
        <Table cols={[{ h: 'Purpose', w: '28%', v: r => r.purpose }, { h: 'No.', w: '8%', v: r => r.qty }, { h: 'Size', w: '14%', v: r => r.size },
          { h: 'Material', w: '24%', v: r => r.material }, { h: 'Attachment', w: '26%', v: r => r.attachment }]} rows={a.nozzles} /></View> : null}
      <Text style={s.h2}>Certificate of shop compliance</Text>
      <Text>We certify that the statements made in this report are correct and that all details of design, material, construction and
        workmanship of this {f.noun.toLowerCase()} conform to the {f.code}. "{a.stamp || f.stamp}" Certificate of Authorization no. {dash(a.coa_no)}
        {a.coa_expires ? `, expires ${formatDate(a.coa_expires)}` : ''}.</Text>
      <View style={s.sign}><Text style={s.signBox}>Date {formatDate(d.submission_date || todayISO())}</Text><Text style={s.signBox}>Signed, {e.name}</Text></View>
      <Text style={s.h2}>Certificate of shop inspection</Text>
      <Text>I, the undersigned, holding a valid commission issued by the National Board of Boiler and Pressure Vessel Inspectors and employed by
        {' '}{a.inspector?.agency || 'the Authorized Inspection Agency'}, have inspected the {f.noun.toLowerCase()} described in this report and state that,
        to the best of my knowledge and belief, the manufacturer has constructed it in accordance with the {f.code}.</Text>
      <View style={s.sign}><Text style={s.signBox}>Inspector {dash(a.inspector?.name)}</Text><Text style={s.signBox}>Commission {dash(a.inspector?.commission)}</Text></View>
      <Footer d={d} />
    </Page>
  );
}

// A side view of the shell: longitudinal seams (category A) as dashed lines along the shell, girth seams
// (category B) as rings, nozzles (category D) as stubs on top. Labels are the weld IDs in the table below.
function WeldSketch({ welds }) {
  const A = welds.filter(w => w.category === 'A'), B = welds.filter(w => w.category === 'B'), D = welds.filter(w => w.category === 'D');
  const x0 = 70, x1 = 470, yTop = 50, yBot = 130;
  const ring = (B.length ? B : []).map((w, i) => ({ w, x: x0 + ((i + 1) * (x1 - x0)) / (B.length + 1) }));
  return (
    <Svg width={540} height={170}>
      <Rect x={x0} y={yTop} width={x1 - x0} height={yBot - yTop} stroke="#111" strokeWidth={1} fill="none" />
      <Ellipse cx={x0} cy={(yTop + yBot) / 2} rx={18} ry={(yBot - yTop) / 2} stroke="#111" strokeWidth={1} fill="none" />
      <Ellipse cx={x1} cy={(yTop + yBot) / 2} rx={18} ry={(yBot - yTop) / 2} stroke="#111" strokeWidth={1} fill="none" />
      {A.map((w, i) => {
        const y = yTop + 14 + i * 14;
        return [<Line key={`a${w.id}`} x1={x0 + 8} y1={y} x2={x1 - 8} y2={y} stroke="#b00" strokeWidth={1} strokeDasharray="4 3" />,
          <SvgText key={`at${w.id}`} x={x0 + 14} y={y - 2} style={{ fontSize: 7 }} fill="#b00">{w.id}</SvgText>];
      })}
      {ring.map(({ w, x }) => [<Line key={`b${w.id}`} x1={x} y1={yTop} x2={x} y2={yBot} stroke="#05a" strokeWidth={1.2} />,
        <SvgText key={`bt${w.id}`} x={x - 6} y={yBot + 12} style={{ fontSize: 7 }} fill="#05a">{w.id}</SvgText>])}
      {D.map((w, i) => {
        const x = x0 + 40 + i * ((x1 - x0 - 80) / Math.max(D.length - 1, 1));
        return [<Rect key={`d${w.id}`} x={x - 6} y={yTop - 22} width={12} height={22} stroke="#111" strokeWidth={0.8} fill="none" />,
          <SvgText key={`dt${w.id}`} x={x - 6} y={yTop - 26} style={{ fontSize: 7 }} fill="#111">{w.id}</SvgText>];
      })}
      <SvgText x={x0} y={160} style={{ fontSize: 7 }} fill="#444">Red dashed: longitudinal seams (Cat. A) · Blue: circumferential seams (Cat. B) · Boxes: nozzle welds (Cat. D)</SvgText>
    </Svg>
  );
}

function WeldMapPage({ d, a }) {
  const welds = a.welds || [];
  const wps = Object.fromEntries((a.wps || []).map(w => [w.id, w]));
  return (
    <Page size="LETTER" style={s.page}>
      <Title sub="Every weld, the procedure it was made to and the welders who made it (stamps as on the joint)">WELD MAP</Title>
      <WeldSketch welds={welds} />
      <Table cols={[
        { h: 'Weld', w: '8%', v: r => r.id }, { h: 'Joint', w: '22%', v: r => r.joint }, { h: 'Cat.', w: '6%', v: r => r.category },
        { h: 'Type', w: '16%', v: r => r.type }, { h: 'WPS', w: '10%', v: r => r.wps }, { h: 'PQR', w: '10%', v: r => wps[r.wps]?.pqr },
        { h: 'Welder stamps', w: '12%', v: r => (r.welders || []).join(', ') }, { h: 'NDE', w: '16%', v: r => `${dash(r.nde)} ${r.nde_report ? `(${r.nde_report})` : ''}` },
      ]} rows={welds} />
      <Footer d={d} />
    </Page>
  );
}

function WeldingPage({ d, a }) {
  const asOf = d.hydro_test_date || d.submission_date || todayISO();
  return (
    <Page size="LETTER" style={s.page}>
      <Title sub="ASME Section IX">WELDING PROCEDURES AND WELDER QUALIFICATIONS</Title>
      <Text style={s.h2}>Welding procedure specifications and supporting PQRs</Text>
      <Table cols={[{ h: 'WPS', w: '14%', v: r => r.id }, { h: 'Process', w: '12%', v: r => r.process }, { h: 'PQR', w: '14%', v: r => r.pqr },
        { h: 'Base metal', w: '20%', v: r => r.base_metal }, { h: 'Thickness range', w: '22%', v: r => r.thickness }, { h: 'PWHT', w: '18%', v: r => r.pwht }]} rows={a.wps || []} />
      <Text style={s.h2}>Welder continuity (QW-322): six months per process</Text>
      <Table cols={[{ h: 'Stamp', w: '9%', v: r => r.stamp }, { h: 'Welder', w: '19%', v: r => r.name }, { h: 'WPQ', w: '11%', v: r => r.wpq },
        { h: 'Process', w: '10%', v: r => r.process }, { h: 'Qualified', w: '13%', v: r => r.qualified_on && formatDate(r.qualified_on) },
        { h: 'Last weld', w: '13%', v: r => r.last_weld && formatDate(r.last_weld) }, { h: 'Lapses', w: '13%', v: r => r.lapse && formatDate(r.lapse) },
        { h: 'Status', w: '12%', v: r => r.status }]} rows={continuityRows(a.welders, asOf)} />
      <Text style={s.note}>Status as of {formatDate(asOf)}. A welder who has not welded with a process for six months must requalify before
        welding with it again (QW-322.1(a)); the lapse date is the last weld with that process plus six months.</Text>
      <Footer d={d} />
    </Page>
  );
}

function MtrPage({ d, parts }) {
  const rows = [];
  const seen = new Set();
  for (const p of parts) {
    const heat = p.tc_heat_no || p.heat_no;
    const key = `${heat}|${p.certificate_no}`;
    if (!heat && !p.certificate_no) continue;
    const row = rows.find(r => r.key === key);
    if (row) { row.parts.push(p.part_name); continue; }
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ key, heat, cert: p.certificate_no, spec: p.material_spec, mill: p.steel_maker, size: p.size_t, c: p.chem_c, mn: p.chem_mn, pp: p.chem_p, ss: p.chem_s, si: p.chem_si,
      ys: p.ys, uts: p.uts, el: p.elongation, parts: [p.part_name] });
  }
  const ksi = mpa => (mpa ? trim(toImperial(mpa, 'MPa') / 1000, 1) : null);
  return (
    <Page size="LETTER" orientation="landscape" style={s.page}>
      <Title sub="Each heat traced from the mill test report to the parts made from it">MATERIAL TEST REPORTS BY HEAT NUMBER</Title>
      <Table cols={[{ h: 'Heat no.', w: '9%', v: r => r.heat }, { h: 'MTR no.', w: '9%', v: r => r.cert }, { h: 'Specification', w: '11%', v: r => r.spec },
        { h: 'Mill', w: '11%', v: r => r.mill }, { h: 'C', w: '4.5%', v: r => r.c }, { h: 'Mn', w: '4.5%', v: r => r.mn }, { h: 'P', w: '4.5%', v: r => r.pp },
        { h: 'S', w: '4.5%', v: r => r.ss }, { h: 'Si', w: '4.5%', v: r => r.si }, { h: 'Yield ksi', w: '6%', v: r => ksi(r.ys) }, { h: 'Tensile ksi', w: '6%', v: r => ksi(r.uts) },
        { h: 'Elong. %', w: '5%', v: r => r.el }, { h: 'Parts', w: '20.5%', v: r => r.parts.join(', ') }]} rows={rows} />
      <Footer d={d} />
    </Page>
  );
}

function NdePage({ d, a }) {
  return (
    <Page size="LETTER" style={s.page}>
      <Title sub="Examiners qualified to the manufacturer's written practice (ASNT SNT-TC-1A)">NONDESTRUCTIVE EXAMINATION RECORDS</Title>
      <Table cols={[{ h: 'Report', w: '13%', v: r => r.report }, { h: 'Method', w: '9%', v: r => r.method }, { h: 'Extent', w: '10%', v: r => r.extent },
        { h: 'Welds', w: '18%', v: r => (r.welds || []).join(', ') }, { h: 'Examiner', w: '18%', v: r => r.examiner }, { h: 'Level', w: '8%', v: r => r.level },
        { h: 'Date', w: '12%', v: r => r.date && formatDate(r.date) }, { h: 'Result', w: '12%', v: r => r.result }]} rows={a.nde || []} />
      <Footer d={d} />
    </Page>
  );
}

function PwhtHydroPage({ d, a }) {
  const p = a.pwht || {}; const h = a.hydro || {};
  return (
    <Page size="LETTER" style={s.page}>
      <Title>POSTWELD HEAT TREATMENT AND HYDROSTATIC TEST</Title>
      <Text style={s.h2}>Postweld heat treatment</Text>
      {p.required ? <View>
        <KV label="Holding temperature" value={`${p.temp_f} °F`} /><KV label="Holding time" value={`${p.hold_hr} hr`} />
        <KV label="Heating / cooling rate above 800 °F" value={p.rate_f_hr ? `${p.rate_f_hr} °F/hr max` : null} />
        <KV label="Chart" value={p.chart} /><KV label="Date" value={p.date && formatDate(p.date)} />
      </View> : <KV label="Not required" value={p.basis} />}
      <Text style={s.h2}>Hydrostatic test</Text>
      <KV label="Test pressure" value={h.psi ? `${h.psi} psi` : psi(d.hydro_test_pressure)} />
      <KV label="MAWP" value={psi(d.design_pressure)} />
      <KV label="Water temperature" value={h.temp_f ? `${h.temp_f} °F` : null} />
      <KV label="Held for" value={h.hold_min ? `${h.hold_min} min, then examined at not less than MAWP` : null} />
      <KV label="Test gauge" value={h.gauge} />
      <KV label="Date" value={(h.date || d.hydro_test_date) && formatDate(h.date || d.hydro_test_date)} />
      <KV label="Witnessed by" value={h.witnessed_by} />
      <KV label="Result" value={h.result || 'No leaks, no permanent distortion'} />
      <View style={s.sign}><Text style={s.signBox}>Quality Control, {d._entity.name}</Text><Text style={s.signBox}>Authorized Inspector</Text></View>
      <Footer d={d} />
    </Page>
  );
}

export async function renderAsmeFolderPdf(document, parts = [], mountings = [], project, certFiles = []) {
  const a = parseAsmeData(document.asme_data);
  const d = { ...document, _form: asmeForm(a), _entity: entityForMaker(document.makers_no, document.company) };
  const buf = await renderToBuffer(
    <Document>
      <IndexPage d={d} a={a} project={project} />
      <DataReportPage d={d} a={a} project={project} />
      <WeldMapPage d={d} a={a} />
      <WeldingPage d={d} a={a} />
      <MtrPage d={d} parts={[...parts, ...mountings]} />
      <NdePage d={d} a={a} />
      <PwhtHydroPage d={d} a={a} />
    </Document>);
  if (!certFiles.length) return Buffer.from(buf);
  const out = await PDFDocument.load(buf);
  for (const c of certFiles) (await out.copyPages(c.doc, c.doc.getPageIndices())).forEach(pg => out.addPage(pg));
  return Buffer.from(await out.save());
}
