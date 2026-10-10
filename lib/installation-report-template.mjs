import { defaultPrefix } from './company-profiles.js';
// Installation Documentation — one source of truth for both report forms (UI + PDF).
// Commissioning follows Shanti_Boilers_Commissioning_Report.docx; Breakdown/ASC/Other follow the
// paper "Field Service Report". Values live in installation_reports.data_json as
// { fields: {key: value}, tables: {sectionKey: [row, ...]} } — layout changes never need a migration.

export const CALL_TYPES = ['Commissioning', 'Breakdown', 'ASC', 'Other'];

const f = (key, label, type = 'text') => ({ key, label, type }); // type: text | date | time | textarea | number | phone | select | signature (PNG data URL) | computed (never typed, see computedValue)
const sel = (key, label, options) => ({ key, label, type: 'select', options });

// Table columns: fixed = printed on the form (not editable), status = OK/NG select.
const c = (key, label, kind = 'text', fixed = false) => ({ key, label, kind, fixed });
const OBS = [c('observed', 'Observed'), c('status', 'Status', 'status'), c('remarks', 'Remarks')];

function rows(key, title, cols, preset) {
  return { key, title, kind: 'rows', columns: cols, preset };
}
const checks = (list) => list.map(([label, spec]) => ({ label, spec }));

export const COMMISSIONING = [
  { key: 'customer', title: '1. Customer & site', kind: 'fields', fields: [
    f('customer_name', 'Customer name'), f('site_address', 'Site address', 'textarea'),
    f('contact_person', 'Contact person'), f('contact_no', 'Contact no.'),
  ] },
  { key: 'equipment', title: '2. Boiler / thermic heater details', kind: 'fields', fields: [
    f('equipment_type', 'Equipment type'), f('model', 'Model / type'),
    f('capacity', 'Capacity / rating'), f('year_of_make', 'Year of make'), f('serial_no', 'Serial / works no.'),
    f('fuel_type', 'Fuel type'), f('design_pressure', 'Design pressure (kg/cm²)'), f('working_pressure', 'Working pressure (kg/cm²)'),
    f('commissioning_date', 'Commissioning date', 'date'), f('inspector', 'Inspector / engineer'),
  ] },
  rows('erection', '3. Erection checkpoints', [c('label', 'Check point', 'text', true), c('spec', 'Specification', 'text', true), ...OBS], checks([
    ['Foundation level & alignment (mm)', 'As per GA drawing'], ['Boiler body positioning & levelling', 'Horizontal ±2 mm'],
    ['Anchor bolt tightening (torque)', 'As specified'], ['Drum / shell orientation verified', 'As per drawing'],
    ['Refractory lining condition', 'No cracks / damage'], ['Insulation thickness (mm)', 'As per spec'],
    ['All manholes / hand holes fitted & gaskets OK', 'Leak free'], ['Safety valve installation & testing', 'Calibrated'],
    ['Pressure gauge installation (No. & range)', 'As per IBR'], ['Steam stop valve operation', 'Full open/close'],
    ['Blow-down valve & connections', 'Leak free'], ['Water level gauges installed & functional', '2 No. min'],
    ['All pipe supports & hangers fitted', 'As drawing'], ['Electrical panel earthing (Ω)', '< 1 Ω'],
    ['Control & instrumentation wiring checked', 'As per SLD'],
  ])),
  rows('feedwater', '4. Feed water quality analysis', [c('label', 'Parameter', 'text', true), c('spec', 'Acceptable limit', 'text', true), c('unit', 'Unit', 'text', true), ...OBS.slice(0, 2)], [
    ['pH value', '8.5 – 9.5', '—'], ['Total dissolved solids (TDS)', '< 3000 ppm', 'ppm'], ['Total hardness', '< 2 ppm (as CaCO₃)', 'ppm'],
    ['Silica (SiO₂)', '< 15 ppm', 'ppm'], ['Chlorides (Cl⁻)', '< 150 ppm', 'ppm'], ['Iron (Fe)', '< 0.2 ppm', 'ppm'],
    ['Oxygen (dissolved O₂)', '< 0.02 ppm', 'ppm'], ['Alkalinity (P & M)', 'As per IS', 'ppm'], ['Conductivity', '< 4000 µS/cm', 'µS/cm'],
    ['Turbidity', '< 5 NTU', 'NTU'], ['Feed water temperature', '60 – 90 °C', '°C'], ['Boiler water TDS (blow-down check)', '< 5000 ppm', 'ppm'],
  ].map(([label, spec, unit]) => ({ label, spec, unit }))),
  rows('fluegas', '5. Flue gas & combustion analysis', [c('label', 'Parameter', 'text', true), c('spec', 'Acceptable range', 'text', true), c('unit', 'Unit', 'text', true), c('observed', 'Observed'), c('remarks', 'Remarks')], [
    ['Stack / flue gas temperature', '150 – 250 °C', '°C'], ['Oxygen (O₂) in flue gas', '2 – 5 %', '% vol'], ['Carbon monoxide (CO)', '< 100 ppm', 'ppm'],
    ['Carbon dioxide (CO₂)', '12 – 14 %', '% vol'], ['NOx (nitrogen oxides)', '< 200 ppm', 'ppm'], ['SO₂ (sulphur dioxide)', 'As applicable', 'ppm'],
    ['Excess air percentage', '15 – 30 %', '%'], ['Combustion efficiency', '> 85 %', '%'], ['Draft at furnace (mm WC)', '–2 to –5 mm WC', 'mm WC'],
    ['Draft at economiser outlet (mm WC)', 'As designed', 'mm WC'], ['Flue gas velocity (m/s)', 'As designed', 'm/s'],
  ].map(([label, spec, unit]) => ({ label, spec, unit }))),
  rows('motors', '6. Motors & auxiliary equipment – electrical', [
    c('label', 'Equipment', 'text', true), c('rated_kw', 'Rated kW'), c('rated_a', 'Rated A'), c('r_a', 'R-phase A'), c('y_a', 'Y-phase A'),
    c('b_a', 'B-phase A'), c('voltage', 'Voltage V'), c('ir', 'Insulation MΩ'), c('status', 'Status', 'status'),
  ], ['Feed water pump (FWP)', 'Boiler feed pump (BFP)', 'Induced draft (ID) fan', 'Forced draft (FD) fan', 'RAV / rotary air lock valve',
    'Combustion air blower', 'Condensate return pump', 'Chemical dosing pump'].map(label => ({ label }))),
  rows('fans', '7. ID fan / FD fan / RAV – operational', [c('label', 'Parameter', 'text', true), c('spec', 'Design value', 'text', true), c('unit', 'Unit', 'text', true), ...OBS.slice(0, 2)], [
    ['ID fan – speed', 'As per nameplate', 'RPM'], ['ID fan – static pressure', 'As designed', 'mm WC'], ['ID fan – air flow', 'As designed', 'm³/hr'],
    ['ID fan – bearing temperature', '< 80 °C', '°C'], ['FD fan – speed', 'As per nameplate', 'RPM'], ['FD fan – static pressure', 'As designed', 'mm WC'],
    ['FD fan – air flow', 'As designed', 'm³/hr'], ['FD fan – bearing temperature', '< 80 °C', '°C'], ['RAV – speed', 'As per nameplate', 'RPM'],
    ['RAV – seal air pressure', 'As designed', 'mm WC'], ['RAV – bearing temperature', '< 80 °C', '°C'],
  ].map(([label, spec, unit]) => ({ label, spec, unit }))),
  rows('interlocks', '8. Safety interlocks & trips verification', [c('label', 'Interlock / trip', 'text', true), c('spec', 'Set point', 'text', true), c('status', 'Tested', 'status'), c('remarks', 'Remarks')], checks([
    ['Low water level trip (LWLL)', 'As per IBR'], ['High water level alarm (HWLA)', 'As set'], ['High steam pressure trip', 'Pr + 5%'],
    ['Low fuel pressure trip', 'As set'], ['Flame failure trip', '< 2 sec'], ['High stack temperature alarm', '250 °C'],
    ['High flue gas O₂ alarm', '> 7%'], ['Emergency stop function', 'Immediate'], ['Safety valve pop pressure', '1.03 × WP'],
    ['Auto blow-down system', 'As set'], ['Combustion air interlock', 'FD fan stop → burner trip'],
  ])),
  rows('trial', '9. Commissioning trial run', [c('label', 'Parameter', 'text', true), c('spec', 'Target', 'text', true), c('unit', 'Unit', 'text', true), c('observed', 'Achieved'), c('status', 'Status', 'status')], [
    ['Steam generation rate', '100% MCR', 'kg/hr'], ['Steam pressure at outlet', 'Working pressure', 'kg/cm²'], ['Steam temperature (if applicable)', 'Saturated / SH', '°C'],
    ['Feed water flow rate', 'As designed', 'm³/hr'], ['Fuel consumption rate', 'As designed', 'kg/hr or m³/hr'], ['Boiler efficiency (heat balance)', '≥ 85%', '%'],
    ['Blow-down frequency', 'As per TDS', '—'], ['Trial run duration', 'Min. 4 hours', 'hrs'],
  ].map(([label, spec, unit]) => ({ label, spec, unit }))),
  rows('observations', '10. Observations, deficiencies & corrective actions', [
    c('observation', 'Observation / deficiency'), c('action', 'Corrective action'), c('party', 'Responsible party'), c('target', 'Target date', 'date'),
  ], [{}, {}, {}]),
  { key: 'closing', title: '11–12. Customer remarks & sign-off', kind: 'fields', fields: [
    f('customer_remarks', "Customer's observations / remarks", 'textarea'),
    f('engineer_name', 'Commissioning engineer – name'), f('engineer_designation', 'Designation'), f('engineer_date', 'Date', 'date'),
    f('service_person_phone', 'Service person contact number', 'phone'),
    f('customer_rep_name', 'Customer representative – name'), f('customer_rep_designation', 'Designation'), f('customer_rep_date', 'Date', 'date'),
    f('tpi_name', 'Third party inspector – name (if any)'), f('tpi_designation', 'Designation'), f('tpi_date', 'Date', 'date'),
    f('tpi_phone', 'Third party phone number', 'phone'),
    f('sig_engineer', 'Commissioning engineer – signature', 'signature'), f('sig_customer', 'Customer representative – signature', 'signature'),
    f('sig_tpi', 'Third party inspector – signature', 'signature'),
  ] },
];

export const SERVICE = [
  { key: 'client', title: 'Client & unit', kind: 'fields', fields: [
    f('client', 'Client'), f('address', 'Address', 'textarea'), f('phone', 'Phone'), f('email', 'E-mail'),
    f('person_contacted', 'Person contacted'), f('unit_sno', 'Unit & S.No.'), f('make', 'Make'), f('model', 'Model'), f('fuel', 'Fuel'),
    sel('visit_type', 'Type of visit', ['PAID', 'FOC']),
  ] },
  { key: 'problem', title: 'Problem reported', kind: 'fields', fields: [f('problem_reported', 'Problem reported', 'textarea')] },
  rows('actions', 'Action taken / action required by client', [c('taken', 'Action taken'), c('required', 'Action required by client')], [{}, {}, {}]),
  { key: 'job', title: 'Job days & charges', kind: 'fields', fields: [
    f('from_date', 'From date', 'date'), f('from_time', 'From time', 'time'), f('to_date', 'To date', 'date'), f('to_time', 'To time', 'time'),
    f('total_hours', 'Total hours', 'computed'), f('total_days', 'Total days', 'computed'), f('da_from', 'Sr. charges – DA from'), f('da_to', 'DA to'), f('da_total', 'DA total'),
    f('amount_paid', 'Amount paid by client at site'),
  ] },
  { key: 'closing', title: 'Sign-off', kind: 'fields', fields: [
    f('engineer_name', 'Sr. engineer – name'), f('engineer_date', 'Date', 'date'), f('customer_remarks', 'Customer remarks', 'textarea'),
    f('service_team_phone', 'Service team contact number', 'phone'),
    f('sig_engineer', 'Sr. engineer – signature', 'signature'), f('sig_customer', 'Customer – signature', 'signature'),
  ] },
];

// Job duration from the From / To date + time: total hours, and total calendar days (both dates counted).
export function serviceDuration(fields = {}) {
  const at = (d, t) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? Date.parse(`${d}T${/^\d{2}:\d{2}$/.test(t || '') ? t : '00:00'}:00Z`) : NaN);
  const a = at(fields.from_date, fields.from_time), b = at(fields.to_date, fields.to_time);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return { hours: null, days: null };
  return { hours: Math.round((b - a) / 36e5 * 100) / 100, days: Math.round((at(fields.to_date) - at(fields.from_date)) / 864e5) + 1 };
}

// Shown value of a 'computed' field ('' until its inputs are filled).
export function computedValue(key, fields) {
  const d = serviceDuration(fields);
  if (key === 'total_hours') return d.hours == null ? '' : `${d.hours} hrs`;
  if (key === 'total_days') return d.days == null ? '' : `${d.days} ${d.days === 1 ? 'day' : 'days'}`;
  return '';
}

// Phone fields keep only what a phone number can hold.
export const cleanPhone = (v) => String(v ?? '').replace(/[^\d+\s-]/g, '').slice(0, 20);

export const sectionsFor = (callType) => (callType === 'Commissioning' ? COMMISSIONING : SERVICE);

// Fresh data for a new report; `prefill` fills known field keys (only where the key exists).
export function emptyData(callType, prefill = {}) {
  const fields = {}; const tables = {};
  for (const s of sectionsFor(callType)) {
    if (s.kind === 'fields') for (const fl of s.fields) fields[fl.key] = prefill[fl.key] ?? '';
    else tables[s.key] = s.preset.map(r => ({ ...r }));
  }
  return { fields, tables };
}

// Signatures are PNG data URLs. A malformed one can hang the PDF renderer, so reject anything that isn't a real PNG.
export function signatureError(data) {
  for (const [k, v] of Object.entries(data?.fields || {})) {
    if (!k.startsWith('sig_') || !v) continue;
    let ok = typeof v === 'string' && v.length < 300000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v);
    if (ok) { const b = Buffer.from(v.slice(22), 'base64'); ok = b.subarray(0, 4).toString('hex') === '89504e47' && b.subarray(-8).toString('hex') === '49454e44ae426082'; }
    if (!ok) return 'Invalid signature image';
  }
  return null;
}

// Controlled document id of a Commissioning report: "SB-COM-001 · Rev 00" (null until it is finalized).
export const docLabel = r => (r?.doc_no ? `${r.doc_no} · Rev ${String(r.revision ?? 0).padStart(2, '0')}` : null);

// Finalizing a Commissioning report: first time -> next number, Rev 0; after a reopen -> same number, Rev + 1.
export function finalizeDoc(row, nextSeq) {
  if (row.call_type !== 'Commissioning') return {};
  if (!row.doc_no) return { doc_no: `${defaultPrefix()}-COM-${String(nextSeq).padStart(3, '0')}`, revision: 0 };
  return { doc_no: row.doc_no, revision: (row.revision ?? 0) + 1 };
}
