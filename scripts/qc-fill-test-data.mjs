// scripts/qc-fill-test-data.mjs — fills every null full-folder field on the SBH-TEST document (id 11,
// project 6) plus a few mounting rows and cert extras, with values modeled on the real SF-series
// sample (SB-1097) — so the generated PDF is visually comparable against
// "FOLDER SAMPLE - FOR APP/BOILER SF SERIES". Idempotent (only fills NULLs / empty tables).
//   node --env-file=.env.local scripts/qc-fill-test-data.mjs
import { createClient } from '@libsql/client';

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = (sql, args = []) => db.execute({ sql, args });
const rows = async (sql, args = []) => (await q(sql, args)).rows;

// 1) Project 6 → SF model (STF-IBR-052 has no model segment; SBH-TEST/SB-TEST mimics the SF sample).
await q("UPDATE projects SET series = 'SF' WHERE id = 6 AND series IS NULL");

// 2) Document 11 header fields, modeled on SB-1097 (BOILER SF SERIES sample).
await q(`UPDATE qc_documents SET
  year_of_make = COALESCE(year_of_make, '2026'),
  boiler_type = COALESCE(boiler_type, 'HORIZONTAL MULTITUBULAR SHELL TYPE SMOKE TUBE WET BACK BOILER'),
  length_overall = COALESCE(length_overall, '3673 mm'),
  internal_diameter = COALESCE(internal_diameter, '2450 mm (ID)'),
  design_pressure = COALESCE(design_pressure, '17.00 Kg/cm² (g)'),
  hydro_test_pressure = COALESCE(hydro_test_pressure, '25.50 Kg/cm² (g)'),
  heating_surface = COALESCE(heating_surface, '105.24 Sq.mtrs.'),
  evaporation_capacity = COALESCE(evaporation_capacity, '3000 Kg./hr.'),
  steam_temp = COALESCE(steam_temp, '195° C'),
  drawing_no = COALESCE(drawing_no, 'SB-TEST-00-01 TO SB-TEST-00-03'),
  working_pressure = COALESCE(working_pressure, '17.00 Kg/cm² (g)'),
  drawing_no_from = COALESCE(drawing_no_from, 'SB-TEST-00-01'),
  drawing_no_to = COALESCE(drawing_no_to, 'SB-TEST-00-03'),
  label_model_code = COALESCE(label_model_code, 'SBH-SF-WB-300-17'),
  submission_date = COALESCE(submission_date, '10.07.2026'),
  signer_name = COALESCE(signer_name, 'QC ENGINEER'),
  manifest_extra = COALESCE(manifest_extra, '[{"label":"Material Inspection and stage wise reports","count":"1 Page"},{"label":"TC for Stay Tubes","count":"1 no''s"}]')
 WHERE id = 11`);

// 3) Mountings — same rows as the SF sample's "list of mountings" file, only if the table is empty.
const existing = (await rows('SELECT COUNT(*) n FROM qc_mountings WHERE document_id = 11'))[0].n;
if (existing === 0) {
  const MOUNTS = [
    ['GLOBE VALVE (MSSV)', '50NB', 'CI', 'FE-2380', 'MALA', '1'],
    ['GLOBE VALVE', '25NB', 'CI', 'BM-6827, BM-2259', 'ATAM, NETA', '4'],
    ['SAFETY VALVE', "25NB 10.54KG/CM²", 'CS', '60695, 60697', 'V TECH VALVES', '2'],
    ['WATER LEVEL GAUGE', '20MM', 'CS', 'IGEMA', 'IGEMA', '2'],
    ['STEAM PRESSURE GAUGE', '150MM', 'SS', 'H-1023', 'HYDRAULIC', '1'],
  ];
  for (let i = 0; i < MOUNTS.length; i++) {
    const [description, size, moc, serial_numbers, make, qty] = MOUNTS[i];
    await q(`INSERT INTO qc_mountings (document_id, description, size, moc, serial_numbers, make, qty, sort_order)
             VALUES (11, ?, ?, ?, ?, ?, ?, ?)`, [description, size, moc, serial_numbers, make, qty, i]);
  }
}

// 4) Cert extras (Form III A columns) — fill for every cert currently linked on document 11 that's missing them.
await q(`UPDATE test_certificates SET
  steel_making_process = COALESCE(steel_making_process, 'BASIC OXYGEN PROCESS'),
  heat_treatment = COALESCE(heat_treatment, 'NORMALISED')
 WHERE id IN (SELECT test_certificate_id FROM qc_document_parts WHERE document_id = 11 AND test_certificate_id IS NOT NULL)`);

console.log('DOC 11 after:', JSON.stringify((await rows('SELECT * FROM qc_documents WHERE id = 11'))[0]));
console.log('PROJECT 6 series:', (await rows('SELECT series FROM projects WHERE id = 6'))[0].series);
console.log('mountings for doc 11:', (await rows('SELECT COUNT(*) n FROM qc_mountings WHERE document_id = 11'))[0].n);
console.log('certs still missing extras:', (await rows(`SELECT COUNT(DISTINCT tc.id) n FROM qc_document_parts p JOIN test_certificates tc ON tc.id = p.test_certificate_id WHERE p.document_id = 11 AND (tc.steel_making_process IS NULL OR tc.heat_treatment IS NULL)`))[0].n);
