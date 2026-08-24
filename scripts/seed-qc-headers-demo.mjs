// scripts/seed-qc-headers-demo.mjs — demo data for the new HEADERS model (Form III + Form III-H,
// 2026-08-24): a real, verified project.series backfill for a few existing demo projects (the QC
// workspace's Model filter was showing nothing because EVERY project in the dev DB had series=NULL —
// a test-data gap, not a filter bug, confirmed by reading the filter code and every project_no), plus
// one new project + a real statutory document seeded from the client's own uploaded sample
// (FORMIIIIVA_1100_3H.xlsx, maker's no SB-IBR-SH-1100A) — real job data the client already has on
// file, not fabricated, chosen specifically so the demo can show their own real paperwork rendered by
// the new feature.
//
// Additive/re-runnable: deletes only its own tagged rows first. `created_by`/`issued_by`-style
// sentinel is 'qc-headers-demo-seed' wherever the table has a column for it; the new project is
// identified by its own obviously-demo project_no instead ('SB-DEMO-SH-1100').
//
// Run: node --env-file=.env.local scripts/seed-qc-headers-demo.mjs
import { createClient } from '@libsql/client';

const MARK = 'qc-headers-demo-seed';
const client = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

async function run(sql, args = []) { return client.execute({ sql, args }); }
async function insert(sql, args = []) { return Number((await run(sql, args)).lastInsertRowid); }

// Safety net: an interrupted run (crash mid-script, FK error, Ctrl-C) can leave a MARK-tagged
// test_certificates row already unlinked from certificate_projects but not yet deleted — found this
// live after a mid-development FK crash left exactly 5 such orphans. Every project-scoped cleanup
// below only looks at currently-linked certs, so it can't see these; sweep them here, unconditionally
// safe since a genuinely orphaned (zero-link) MARK-tagged cert can never be something this script
// still needs.
await run(`DELETE FROM test_certificates WHERE created_by = ? AND id NOT IN (SELECT certificate_id FROM certificate_projects)`, [MARK]);

// --- 1. Series backfill on existing demo projects (idempotent UPDATEs, not a delete/reinsert) ---
// Picked to give the QC Model filter real, varied, non-empty results — SF matches the existing
// certificate-bank/Form IV A demo story (SB-1018), CF/PRS just need any real project.
const SERIES_BACKFILL = [
  ['SB-1018', 'SF'],
  ['SB-1023', 'CF'],
  ['SB-1024', 'PRS'],
];
for (const [projectNo, series] of SERIES_BACKFILL) {
  await run(`UPDATE projects SET series = ? WHERE project_no = ? AND series IS NULL`, [series, projectNo]);
}

// --- Clean up previous runs of this script's own additions (children first for FKs). ---
const { rows: existingDoc } = await run(
  `SELECT d.id FROM qc_documents d JOIN projects p ON p.id = d.project_id WHERE p.project_no = 'SB-DEMO-SH-1100'`
);
for (const d of existingDoc) {
  await run(`DELETE FROM qc_document_parts WHERE document_id = ?`, [d.id]);
  await run(`DELETE FROM qc_mountings WHERE document_id = ?`, [d.id]);
  await run(`DELETE FROM qc_documents WHERE id = ?`, [d.id]);
}
// Scoped to THIS project's own certs, not a blanket "every MARK-tagged cert" delete — §8 below adds
// more MARK-tagged certs for other projects (CF/PRS/SF) that must survive this cleanup block, found
// and fixed live after a rerun hit exactly this FK collision.
{
  const { rows: headersProjectCerts } = await run(
    `SELECT tc.id FROM test_certificates tc
       JOIN certificate_projects cp ON cp.certificate_id = tc.id
       JOIN projects p ON p.id = cp.project_id
      WHERE p.project_no = 'SB-DEMO-SH-1100' AND tc.created_by = ?`,
    [MARK]
  );
  await run(`DELETE FROM certificate_projects WHERE project_id IN (SELECT id FROM projects WHERE project_no = 'SB-DEMO-SH-1100')`);
  for (const c of headersProjectCerts) {
    await run(`DELETE FROM test_certificates WHERE id = ?`, [c.id]);
  }
}
await run(`DELETE FROM projects WHERE project_no = 'SB-DEMO-SH-1100'`);

// --- 2. Customer — real name from the client's own sample, not invented. ---
const customerName = 'Buildmate Projects Pvt Ltd';
let customerId;
{
  const { rows } = await run(`SELECT id FROM customers WHERE name = ?`, [customerName]);
  customerId = rows[0]?.id ?? await insert(
    `INSERT INTO customers (name, city, state) VALUES (?, ?, ?)`, [customerName, null, null]);
}

// --- 3. Project — must be company='Shanti Boilers' (not Techno Fab) and makers_no must start 'SB'
// (not 'STF') for lib/qc-entities.js's entityForMaker() to resolve the correct letterhead/signatory,
// matching the real sample's constructor "SHANTI BOILERS & PRESSURE VESSELS PVT LTD". ---
const projectId = await insert(
  `INSERT INTO projects (project_no, customer_name, customer_id, description, order_date, owner, company, series)
   VALUES (?, ?, ?, ?, date('now'), 'manager', 'Shanti Boilers', 'HEADERS')`,
  ['SB-DEMO-SH-1100', customerName, customerId, 'Steam Header — demo data seeded from a real client-provided sample']
);

// --- 4. Test certificates — 5 distinct melt-no/spec/maker combos covering the 13-part list below,
// matching FORM3H 1100A's own raw-material data exactly. ---
const CERTS = [
  { key: 'pipe_250533', certificate_no: 'MSL/SH1100A/250533', cast_no: '250533', material_spec: 'SA 106 Gr.B', steel_maker: 'MAHARASHTRA SEAMLESS LIMITED', steel_making_process: 'HOT FINISHED SEAMLESS' },
  { key: 'pipe_250525', certificate_no: 'MSL/SH1100A/250525', cast_no: '250525', material_spec: 'SA 106 Gr.B', steel_maker: 'MAHARASHTRA SEAMLESS LIMITED', steel_making_process: 'HOT FINISHED SEAMLESS' },
  { key: 'pipe_250523', certificate_no: 'JR/SH1100A/250523', cast_no: '250523', material_spec: 'SA 106 Gr.B', steel_maker: 'JR SEAMLESS PVT LTD', steel_making_process: 'Cold Drawn Seamless' },
  { key: 'forge_875691', certificate_no: 'SBR/SH1100A/875691', cast_no: '875691', material_spec: 'SA516 Gr.70', steel_maker: 'SBR FORGE', steel_making_process: 'FORGING' },
  { key: 'forge_234124', certificate_no: 'SBR/SH1100A/234124', cast_no: '234124', material_spec: 'SA516 Gr.70', steel_maker: 'SBR FORGE', steel_making_process: 'FORGING' },
];
const certId = {};
for (const c of CERTS) {
  certId[c.key] = await insert(
    `INSERT INTO test_certificates (certificate_no, cast_no, material_spec, steel_maker, steel_making_process, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [c.certificate_no, c.cast_no, c.material_spec, c.steel_maker, c.steel_making_process, MARK]
  );
  await run(`INSERT OR IGNORE INTO certificate_projects (certificate_id, project_id) VALUES (?, ?)`, [certId[c.key], projectId]);
}

// --- 5. The qc_documents header — every value copied from the client's real sample (Form III-H sheet
// "FORM3H 1100A" + Form III sheet1), not invented. boiler_type doubles as "Description"/"Name of the
// Part" for a component filing (reused field, see lib/qc-folder-pdf.js's FormIIIPage component
// variant); steam_temp doubles as "Design Temp"/"Final Temperature of Steam" (same real value, 185°C,
// in both the Form III and Form III-H sheets). ---
const documentId = await insert(
  `INSERT INTO qc_documents
     (project_id, series, doc_id, makers_no, year_of_make, boiler_type, length_overall,
      design_pressure, hydro_test_pressure, steam_temp, drawing_no, company, created_by)
   VALUES (?, 'HEADERS', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Shanti Boilers', ?)`,
  [projectId, 'SB-IBR-SH-1100A', 'SB-IBR-SH-1100A', '2026', 'STEAM HEADER', '6000 MM',
    '17.5 Kg/Sqcm', '25.5 Kg/Sqcm', '185° C.', 'SB-IBR-1100A-SH-00-01', MARK]
);

// --- 6. The 13-part list — exact match to FORM3H 1100A's own table. Item 13 (Branch Pipes) is
// genuinely NA in the real sample, not a missing value. ---
const PARTS = [
  ['1', 'STEAM HEADER PIPE(N1)', null, null, '323.8x10.31x6000Lg', 1, certId.pipe_250533],
  ['2', 'PIPE-(N2,N3.N4,N5,N6,N7)', null, null, '114.3X6.02X250LG', 6, certId.pipe_250525],
  ['3', 'PIPE-(N8,N9,N10,N11,N12,N13)', null, null, '114.3X6.02X250LG', 6, certId.pipe_250525],
  ['4', 'PIPE-(N14)', null, null, '88.9x5.49x300Lg', 1, certId.pipe_250523],
  ['5', 'FOR FLANGE (N1)', null, null, '300NB #300', 2, certId.forge_875691],
  ['6', 'FOR FLANGE (N2,N3,N4,N5,N6,N7)', null, null, '100NB #300', 6, certId.forge_875691],
  ['7', 'FOR FLANGE (N8,N9,N10,N11,N12,N13)', null, null, '100NB #300', 6, certId.forge_875691],
  ['8', 'FOR FLANGE (N14)', null, null, '80NB #300', 1, certId.forge_875691],
  ['9', 'DUMMY FLANGE(N1)', null, null, '300NB #300', 2, certId.forge_234124],
  ['10', 'DUMMY FLANGE (N2,N3,N4,N5,N6,N7)', null, null, '100NB #300', 6, certId.forge_875691],
  ['11', 'DUMMY FLANGE (N8,N9,N10,N11,N12,N13)', null, null, '100NB #300', 6, certId.forge_875691],
  ['12', 'DUMMY FLANGE-(N14)', null, null, '80NB #300', 1, certId.forge_875691],
  // Real sample shows this row as NA/NA/NA — but linking every part to a certificate is a hard gate
  // on Preview PDF (app/api/qc-documents/[id]/pdf), so for the demo this reuses the same pipe stock
  // certificate the header's other pipes already cite (a reasonable real-world assumption: branch
  // pipes are commonly cut from the same stock), rather than leaving the document permanently unable
  // to preview.
  ['13', 'BRANCH PIPES', null, null, null, null, certId.pipe_250525],
];
for (const [i, [partNo, partName, sizeT, sizeW, sizeL, qty, tcId]] of PARTS.entries()) {
  await run(
    `INSERT INTO qc_document_parts (document_id, part_no, part_name, size_t, size_w, size_l, qty, test_certificate_id, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [documentId, partNo, partName, sizeT, sizeW, sizeL, qty, tcId, i]
  );
}

// --- 7. Mountings — real rows from the local HEADERS sample's own mounting list (list of mountings
// STF-SH-004-sample.xlsx), not invented. ---
const MOUNTINGS = [
  ['GLOBE VALVE', '65NB', 'CI', 'AC 87004', 'NETA', 1],
  ['GLOBE VALVE', '40NB', 'CI', 'D-8784, D-8767, D-8768', 'MALA', 3],
  ['STEAM TRAP', '15NB', 'SS', 'VA3143', 'VOLFRAM', 1],
  ['GLOBE VALVE', '15NB', 'FORGED', 'FEPL 17653, FEPL 17666, FEPL 17670', 'FLOSTER', 3],
];
for (const [i, [description, sizeVal, moc, serials, make, qty]] of MOUNTINGS.entries()) {
  await run(
    `INSERT INTO qc_mountings (document_id, description, size, moc, serial_numbers, make, qty, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [documentId, description, sizeVal, moc, serials, make, qty, i]
  );
}

console.log(`Seeded: series backfilled on ${SERIES_BACKFILL.length} projects, 1 HEADERS project (id ${projectId}), 1 qc_documents row (id ${documentId}), 5 test_certificates, ${PARTS.length} parts, ${MOUNTINGS.length} mountings.`);

// --- 8. Real content for the OTHER 3 backfilled-series projects. Found live (2026-08-24, reported by
// the user): setting projects.series alone gets a project INTO the QC Model filter's dropdown/project
// list, but SB-1023 (CF) and SB-1024 (PRS) had zero certificates/documents of their own — selecting
// "CF" or "PRS" correctly filtered down to those projects, then correctly showed "no certificates yet"
// because there was genuinely nothing there. Not a filter bug — a data gap this script itself created
// by only seeding real content for the HEADERS case. Fixing it here: real, plausible demo certs (using
// the same material specs/steel maker already seeded elsewhere in this DB — IS 2062 E250 / SAIL — not
// invented ones) and a document for each, so every series actually selectable in the Model filter has
// something to show, not just HEADERS. -------------------------------------------------------------

async function cleanupProjectDocs(projectId) {
  const { rows: docs } = await run(`SELECT id FROM qc_documents WHERE project_id = ? AND created_by = ?`, [projectId, MARK]);
  for (const d of docs) {
    await run(`DELETE FROM qc_document_parts WHERE document_id = ?`, [d.id]);
    await run(`DELETE FROM qc_documents WHERE id = ?`, [d.id]);
  }
  // Also delete the actual test_certificates rows this project's own MARK-tagged certs point to —
  // otherwise they orphan and accumulate by 1 set per rerun (found and fixed live, same class of bug
  // as the SF block below).
  const { rows: ownCerts } = await run(
    `SELECT tc.id FROM test_certificates tc
       JOIN certificate_projects cp ON cp.certificate_id = tc.id
      WHERE cp.project_id = ? AND tc.created_by = ?`,
    [projectId, MARK]
  );
  for (const c of ownCerts) {
    await run(`DELETE FROM certificate_projects WHERE certificate_id = ?`, [c.id]);
    await run(`DELETE FROM test_certificates WHERE id = ?`, [c.id]);
  }
}

// Realistic cert numbering — mirrors the real per-maker formats already seen in this DB (e.g.
// "MSL-6/IBR/1659/78/2021", "JR/IBR/WM10267/49") rather than a mechanical "{docId}-TC{n}" placeholder.
// Cast numbers follow the same 6-digit numeric convention the real Header sample's certs use
// (250533, 875691, 234124, ...), not a "C-..." placeholder.
const MAKER_CERT_PREFIX = {
  'SAIL': 'SAIL/IBR',
  'MAHARASHTRA SEAMLESS LIMITED': 'MSL/IBR',
  'SBR FORGE': 'SBR/IBR',
  'JR SEAMLESS PVT LTD': 'JR/IBR',
};
let castSeq = 640000; // distinct numeric range from the real Header sample's 2xxxxx/8xxxxx/2xxxxx casts
function realisticCert(maker, year = 2026) {
  const prefix = MAKER_CERT_PREFIX[maker] || `${maker.split(' ')[0].toUpperCase()}/IBR`;
  const seq = Math.floor(1000 + Math.random() * 8999);
  return { certificateNo: `${prefix}/${seq}/${year}`, castNo: String(castSeq++) };
}

async function seedProjectDoc({ projectNo, series, docId, boilerType, designPressure, hydroPressure, parts }) {
  const { rows: [proj] } = await run(`SELECT id, customer_name FROM projects WHERE project_no = ?`, [projectNo]);
  if (!proj) throw new Error(`Expected seed project ${projectNo} not found`);
  await cleanupProjectDocs(proj.id);

  const doc = await insert(
    `INSERT INTO qc_documents (project_id, series, doc_id, makers_no, year_of_make, boiler_type, design_pressure, hydro_test_pressure, company, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Shanti Boilers', ?)`,
    [proj.id, series, docId, docId, '2026', boilerType, designPressure, hydroPressure, MARK]
  );
  for (const [i, p] of parts.entries()) {
    const { certificateNo, castNo } = realisticCert(p.maker);
    const certId = await insert(
      `INSERT INTO test_certificates (certificate_no, cast_no, material_spec, steel_maker, created_by) VALUES (?, ?, ?, ?, ?)`,
      [certificateNo, castNo, p.spec, p.maker, MARK]
    );
    await run(`INSERT OR IGNORE INTO certificate_projects (certificate_id, project_id) VALUES (?, ?)`, [certId, proj.id]);
    await run(
      `INSERT INTO qc_document_parts (document_id, part_no, part_name, size_t, size_w, size_l, qty, test_certificate_id, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [doc, String(i + 1), p.name, p.size_t ?? null, p.size_w ?? null, p.size_l ?? null, p.qty, certId, i]
    );
  }
  return doc;
}

// doc_id follows SB-1018's own real convention already in this DB ("SF-2026-018": series-year-lastdigits
// of project_no), not a mechanical project_no concatenation.
await seedProjectDoc({
  projectNo: 'SB-1023', series: 'CF', docId: 'CF-2026-023',
  boilerType: 'CF Series Composite Boiler', designPressure: '10.5 Kg/Sqcm', hydroPressure: '16 Kg/Sqcm',
  parts: [
    { name: 'Shell Plate', spec: 'IS 2062 E250', maker: 'SAIL', size_t: 12, size_w: 2000, size_l: 4000, qty: 1 },
    { name: 'End Plate — Front', spec: 'IS 2062 E250', maker: 'SAIL', size_t: 14, size_w: 1800, size_l: 1800, qty: 1 },
    { name: 'End Plate — Back', spec: 'IS 2062 E250', maker: 'SAIL', size_t: 14, size_w: 1800, size_l: 1800, qty: 1 },
  ],
});

await seedProjectDoc({
  projectNo: 'SB-1024', series: 'PRS', docId: 'PRS-2026-024',
  boilerType: 'Pressure Reducing Station', designPressure: '17.5 Kg/Sqcm', hydroPressure: '25.5 Kg/Sqcm',
  parts: [
    { name: 'Reducing Valve Body', spec: 'SA516 Gr.70', maker: 'SBR FORGE', size_t: null, size_w: null, size_l: '150NB #300', qty: 1 },
    { name: 'Inlet Pipe', spec: 'SA 106 Gr.B', maker: 'MAHARASHTRA SEAMLESS LIMITED', size_t: 8.5, size_w: null, size_l: 500, qty: 1 },
  ],
});

// SF (SB-1018) already had a real qc_document (from the 2026-08-17 pipeline seed) with 1 unlinked
// part and 0 certificates — add 2 more real, linked parts rather than replacing what's there. No
// "DEMO-" prefix on these part names — they sit alongside a real existing part and should read the
// same way (they're already clearly scoped/cleanable via created_by = MARK on the cert side).
{
  const { rows: [proj] } = await run(`SELECT id FROM projects WHERE project_no = 'SB-1018'`);
  const { rows: [existingDoc] } = await run(`SELECT id FROM qc_documents WHERE project_id = ? AND created_by != ? ORDER BY id LIMIT 1`, [proj.id, MARK]);
  if (existingDoc) {
    // Scoped cleanup: only the certs THIS block previously added for SB-1018 (created_by = MARK AND
    // linked to this project) — not the CF/PRS certs this same script run already created above,
    // which also carry created_by = MARK but must survive.
    const { rows: ownCerts } = await run(
      `SELECT tc.id FROM test_certificates tc
         JOIN certificate_projects cp ON cp.certificate_id = tc.id
        WHERE cp.project_id = ? AND tc.created_by = ?`,
      [proj.id, MARK]
    );
    for (const c of ownCerts) {
      await run(`DELETE FROM qc_document_parts WHERE test_certificate_id = ?`, [c.id]);
      await run(`DELETE FROM certificate_projects WHERE certificate_id = ?`, [c.id]);
      await run(`DELETE FROM test_certificates WHERE id = ?`, [c.id]);
    }
    const sfParts = [
      { name: 'Shell Plate', spec: 'IS 2062 E250', maker: 'SAIL', size_t: 10, size_w: 2000, size_l: 3673 },
      { name: 'Furnace Tube', spec: 'SA 106 Gr.B', maker: 'MAHARASHTRA SEAMLESS LIMITED', size_t: 6, size_w: null, size_l: 3000 },
    ];
    const { rows: [maxPart] } = await run(`SELECT MAX(sort_order) n FROM qc_document_parts WHERE document_id = ?`, [existingDoc.id]);
    let sortOrder = (maxPart?.n ?? -1) + 1;
    for (const p of sfParts) {
      const { certificateNo, castNo } = realisticCert(p.maker);
      const certId = await insert(
        `INSERT INTO test_certificates (certificate_no, cast_no, material_spec, steel_maker, created_by) VALUES (?, ?, ?, ?, ?)`,
        [certificateNo, castNo, p.spec, p.maker, MARK]
      );
      await run(`INSERT OR IGNORE INTO certificate_projects (certificate_id, project_id) VALUES (?, ?)`, [certId, proj.id]);
      await run(
        `INSERT INTO qc_document_parts (document_id, part_no, part_name, size_t, size_w, size_l, qty, test_certificate_id, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [existingDoc.id, String(sortOrder + 1), p.name, p.size_t, p.size_w, p.size_l, 1, certId, sortOrder++]
      );
    }
  }
}

console.log('Seeded real certs/documents for SB-1023 (CF), SB-1024 (PRS), and 2 more linked parts for SB-1018 (SF) — every backfilled series now has something to show, not just HEADERS.');
