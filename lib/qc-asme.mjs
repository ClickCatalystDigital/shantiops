// lib/qc-asme.mjs — the ASME record package a US QC folder prints (lib/qc-asme-pdf.js): which data report
// (Form P-2 for a firetube boiler under Section I, Form U-1A for a single-chamber vessel under Section VIII
// Div. 1), and the welding records behind it. Pure (no imports beyond units), so the self-check runs anywhere.
//
// A document filed as ASME has ibr_version = 'asme' (lib/qc-ibr.mjs) and its records in
// qc_documents.asme_data (JSON, shape below). Pressures, temperatures and sizes on the document's own header
// fields stay metric like every stored value; the data report prints them in US customary units, as an ASME
// report is filed. asme_data holds what the report adds (code edition, stamps, inspector, welding), as filed.
//
// asme_data = {
//   form: 'P-2' | 'U-1A', edition: '2025', nb_no, stamp: 'S' | 'U', coa_no, coa_expires,
//   inspector: { name, agency, commission }, mawp_temp_f, mdmt_f, corrosion_in, supports,
//   shell: { spec, thk_in, id_in, length_in }, heads: { spec, thk_in, type }, tubes: { spec, od_in, thk_in, count },
//   furnace: { spec, od_in, thk_in, length_in }, safety_valves: [{ size, set_psi, capacity }],
//   nozzles: [{ purpose, qty, size, material, attachment }],
//   wps: [{ id, process, pqr, base_metal, thickness, pwht }],
//   welders: [{ stamp, name, wpq, processes: { SMAW: { qualified_on, last_weld } } }],
//   welds: [{ id, joint, category, type, wps, welders: [stamp], nde, nde_report, result }],
//   nde: [{ report, method, extent, welds, examiner, level, date, result }],
//   pwht: { required, basis, temp_f, hold_hr, rate_f_hr, chart, date },
//   hydro: { psi, temp_f, hold_min, date, gauge, witnessed_by },
// }

export const ASME_VERSION = 'asme';

export const ASME_FORMS = {
  'P-2': { title: "FORM P-2 MANUFACTURER'S DATA REPORT FOR ALL TYPES OF BOILERS EXCEPT WATERTUBE AND ELECTRIC",
    code: 'ASME Boiler and Pressure Vessel Code, Section I', stamp: 'S', noun: 'Boiler' },
  'U-1A': { title: "FORM U-1A MANUFACTURER'S DATA REPORT FOR PRESSURE VESSELS (Alternative Form for Single-Chamber, Completely Shop-Fabricated Vessels Only)",
    code: 'ASME Boiler and Pressure Vessel Code, Section VIII, Division 1', stamp: 'U', noun: 'Vessel' },
};
export const asmeForm = data => ASME_FORMS[data?.form] ? data.form : 'P-2';

export function parseAsmeData(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw) || {}; } catch { return {}; }
}

// QW-322.1(a): a welder's qualification for a process lapses when they have not welded with it for six
// months. Same rule as ahromlabs.com src/lib/asme-calc.ts continuityLapse: 31 Aug + 6 months = end of Feb.
export function continuityLapse(lastWeld) {
  const d = new Date(`${lastWeld}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + 6);
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

// One row per welder per process: lapse date and status on `asOf` (YYYY-MM-DD).
export function continuityRows(welders = [], asOf) {
  const rows = [];
  for (const w of welders) {
    for (const [process, p] of Object.entries(w.processes || {})) {
      const lapse = p.last_weld ? continuityLapse(p.last_weld) : null;
      rows.push({ stamp: w.stamp, name: w.name, wpq: w.wpq, process, qualified_on: p.qualified_on, last_weld: p.last_weld,
        lapse, status: !lapse ? 'No weld logged' : lapse >= asOf ? 'Current' : 'Lapsed' });
    }
  }
  return rows;
}

// Every stamp on the weld map must be a welder qualified (and current) for that weld's WPS process.
export function weldMapProblems(data, asOf) {
  const wps = Object.fromEntries((data.wps || []).map(w => [w.id, w]));
  const cont = continuityRows(data.welders, asOf);
  const out = [];
  for (const w of data.welds || []) {
    const proc = wps[w.wps]?.process;
    if (!proc) { out.push(`${w.id}: WPS ${w.wps || '(none)'} not listed`); continue; }
    for (const stamp of w.welders || []) {
      const r = cont.find(c => c.stamp === stamp && c.process === proc);
      if (!r) out.push(`${w.id}: welder ${stamp} not qualified for ${proc}`);
      else if (r.status !== 'Current') out.push(`${w.id}: welder ${stamp} ${proc} continuity ${r.status.toLowerCase()}`);
    }
  }
  return out;
}
