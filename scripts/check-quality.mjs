// ITP gates end to end through the real routes (docs/gulf-coast-asme-plan.md, Phase 1).
// Runs on a SCRATCH database seeded by scripts/demo/seed-acme-us.mjs (it writes). Usage:
//   BASE=http://localhost:8790 DB=<that sqlite file> [PASS=acme-demo] node scripts/check-quality.mjs
// Starts from AB-1005's traveler as seeded: RT failed on weld L1, NCR open, 4.2 onward not cleared.
import { execFileSync } from 'node:child_process';
const BASE = process.env.BASE || 'http://localhost:8790', PASS = process.env.PASS || 'acme-demo', DB = process.env.DB;
if (!DB) { console.error('DB (the scratch sqlite file) is required'); process.exit(1); }
const sql = s => execFileSync('sqlite3', ['-json', DB, s]).toString().trim();
const rows = s => { const t = sql(s); return t ? JSON.parse(t) : []; };

const jars = {};
async function login(u) {
  if (jars[u]) return jars[u];
  const r = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: PASS }) });
  if (!r.ok) throw new Error(`login ${u}: ${r.status}`);
  return (jars[u] = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; '));
}
async function call(u, method, path, body) {
  const r = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', cookie: await login(u) }, body: body && JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

let failed = 0;
function expect(name, got, want, data) {
  const ok = Array.isArray(want) ? want.includes(got) : got === want;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` (got ${got}, want ${want}: ${JSON.stringify(data).slice(0, 200)})`}`);
  if (!ok) failed++;
}

const [sheet] = rows("SELECT id, project_id FROM job_sheets WHERE itp_template_id IS NOT NULL ORDER BY id DESC LIMIT 1");
const pt = Object.fromEntries(rows(`SELECT id, item_key FROM job_sheet_stages WHERE sheet_id = ${sheet.id}`).map(r => [r.item_key, r.id]));
const stage = (u, k, body) => call(u, 'PATCH', `/api/job-sheets/${sheet.id}/stages/${pt[k]}`, body);
const [l1] = rows(`SELECT id FROM welds WHERE project_id = ${sheet.project_id} AND weld_no = 'L1'`);
const [ncr] = rows(`SELECT id, qc_record_id FROM ncr_records WHERE job_sheet_stage_id = ${pt['4.2']} AND status != 'closed'`);
const [repairWps] = rows("SELECT id FROM wps WHERE is_repair = 1 AND status = 'approved'");
const today = new Date().toISOString().slice(0, 10);

// 1. A failed point blocks what depends on it, through the API, not just on screen.
let r = await stage('production_head', '4.3', { action: 'start', date: today });
expect('Start 4.3 while RT on L1 has failed → 409', r.status, 409, r.data);
r = await stage('qc_head', '4.2', { action: 'qc', date: today });
expect('QC sign 4.2 with a failing RT → 409', r.status, 409, r.data);
// An unrelated chain still works: 4.4 needs only 1.4 (seeded with notice sent and started).
r = await stage('production_head', '4.4', { action: 'finish', date: today });
expect('Finish 4.4 (does not depend on 4.2) → 200', r.status, 200, r.data);

// 2. A decided inspection is frozen.
r = await call('qc_head', 'PATCH', `/api/qc-records/${ncr.qc_record_id}`, { result: 'pass' });
expect('Turn the failed RT into a pass → 409', r.status, 409, r.data);
r = await call('qc_head', 'DELETE', `/api/qc-records/${ncr.qc_record_id}`);
expect('Delete the failed RT → 409', r.status, 409, r.data);

// 3. Who may do what.
r = await stage('production_head', '4.1', { action: 'release', release_ref: 'x' });
expect('Production records a customer release → 403', r.status, 403, r.data);
r = await call('qc_head', 'POST', `/api/ncrs/${ncr.id}/repair`, { notes: 'x' });
expect('QC records the repair (Production only) → 403', r.status, 403, r.data);

// 4. NCR → repair → retest → verify → close.
r = await call('qc_head', 'POST', `/api/ncrs/${ncr.id}/disposition`, { disposition: 'repair', disposition_notes: 'Excavate and re-weld' });
expect('Weld repair without a repair WPS → 400', r.status, 400, r.data);
r = await call('qc_head', 'POST', `/api/ncrs/${ncr.id}/disposition`, { disposition: 'repair', disposition_notes: 'Excavate and re-weld', repair_wps_id: repairWps.id });
expect('Disposition repair with approved WPS-103R → 200', r.status, 200, r.data);
r = await call('qc_head', 'POST', `/api/ncrs/${ncr.id}/verify`, {});
expect('Verify before the repair is recorded → 409', r.status, 409, r.data);
r = await call('production_head', 'POST', `/api/ncrs/${ncr.id}/repair`, { notes: 'Ground out 4" of L1, re-welded SMAW per WPS-103R' });
expect('Production records the repair → 200', r.status, 200, r.data);
r = await call('qc_head', 'POST', `/api/ncrs/${ncr.id}/verify`, {});
expect('Verify before a passing retest → 409', r.status, 409, r.data);
r = await call('qc_head', 'POST', '/api/qc-records', { project_id: sheet.project_id, job_sheet_stage_id: pt['4.2'], weld_id: l1.id, test_type: 'RT', result: 'pass', tested_on: today, reference_no: 'RT-CHECK-1R' });
expect('Record the retest RT on L1 (pass) → 200', r.status, [200, 201], r.data);
const [retest] = rows(`SELECT supersedes_id FROM qc_records WHERE reference_no = 'RT-CHECK-1R'`);
expect('Retest points at the failed record', retest?.supersedes_id, ncr.qc_record_id, retest);
r = await stage('qc_head', '4.2', { action: 'qc', date: today });
expect('QC sign 4.2 while the NCR is still open → 409', r.status, 409, r.data);
r = await call('qc_head', 'POST', `/api/ncrs/${ncr.id}/verify`, {});
expect('Verify after repair + passing retest → 200', r.status, 200, r.data);
r = await call('qc_head', 'POST', `/api/ncrs/${ncr.id}/close`, {});
expect('Close the NCR → 200', r.status, 200, r.data);
const failedStill = rows(`SELECT result FROM qc_records WHERE id = ${ncr.qc_record_id}`)[0]?.result;
expect('The failed RT is still on record', failedStill, 'fail');

// 5. Sign and release the hold point; two parallel releases can't both win.
r = await stage('qc_head', '4.2', { action: 'qc', date: today });
expect('QC sign 4.2 after the loop → 200', r.status, 200, r.data);
r = await stage('production_head', '4.3', { action: 'start', date: today });
expect('Start 4.3 before the customer releases hold point 4.2 → 409', r.status, 409, r.data);
const both = await Promise.all([1, 2].map(i => stage('qc_head', '4.2', { action: 'release', release_ref: `Customer email ${i}` })));
expect('Two parallel releases → one 200 and one 409', both.map(x => x.status).sort().join(','), '200,409', both.map(x => x.data));
r = await stage('production_head', '4.3', { action: 'start', date: today });
expect('Start witness point 4.3 before the notice → 409', r.status, 409, r.data);
await stage('qc_head', '4.3', { action: 'notify' });
r = await stage('production_head', '4.3', { action: 'start', date: today });
expect('Start 4.3 once 4.2 is cleared and notice sent → 200', r.status, 200, r.data);

// 6. Shipping: refused while a point is open, allowed once everything is cleared or marked not applicable.
const pl = await call('dispatch_head', 'POST', '/api/packing', { project_id: sheet.project_id, customer_name: 'ITP check' });
expect('Create a packing list → 200', pl.status, [200, 201], pl.data);
const plId = pl.data.id;
sql(`UPDATE packing_lists SET status = 'packed' WHERE id = ${plId}; INSERT INTO pre_dispatch_approvals (packing_list_id, status, submitted_by) VALUES (${plId}, 'approved', 'check')`);
r = await call('dispatch_head', 'PATCH', `/api/packing/${plId}`, { status: 'dispatched' });
expect('Dispatch with ITP points still open → 409', r.status, 409, r.data);
for (const k of ['4.3', '4.4', '5.1', '5.2', '6.1', '6.2', '6.3', '7.1']) {
  const [s] = rows(`SELECT qc_sign_by, not_applicable FROM job_sheet_stages WHERE id = ${pt[k]}`);
  if (s.qc_sign_by || s.not_applicable) continue;
  r = await stage('qc_head', k, { action: 'na', reason: 'Closed out by the ITP check script' });
  if (r.status !== 200) expect(`Mark ${k} not applicable`, r.status, 200, r.data);
}
r = await call('dispatch_head', 'PATCH', `/api/packing/${plId}`, { status: 'dispatched' });
expect('Dispatch with every point cleared but another NCR open → 409', r.status, 409, r.data);
for (const n of rows(`SELECT id FROM ncr_records WHERE project_id = ${sheet.project_id} AND status != 'closed'`)) {
  await call('qc_head', 'POST', `/api/ncrs/${n.id}/disposition`, { disposition: 'use_as_is', disposition_notes: 'Accepted by engineering (check script)' });
  await call('qc_head', 'POST', `/api/ncrs/${n.id}/verify`, {});
  r = await call('qc_head', 'POST', `/api/ncrs/${n.id}/close`, {});
  if (r.status !== 200) expect(`Close NCR ${n.id}`, r.status, 200, r.data);
}
r = await call('dispatch_head', 'PATCH', `/api/packing/${plId}`, { status: 'dispatched' });
expect('Dispatch once every point is cleared and no NCR is open → 200', r.status, 200, r.data);

// 7. A card without a template is not touched by any of this.
const [boiler] = rows("SELECT s.id, s.sheet_id, (SELECT id FROM employees LIMIT 1) AS emp FROM job_sheet_stages s JOIN job_sheets j ON j.id = s.sheet_id WHERE j.itp_template_id IS NULL AND s.start_date IS NULL ORDER BY s.id LIMIT 1");
r = await call('production_head', 'PATCH', `/api/job-sheets/${boiler.sheet_id}/stages/${boiler.id}`, { action: 'start', date: today });
expect('Boiler card still requires a fitter → 400', r.status, 400, r.data);
r = await call('production_head', 'PATCH', `/api/job-sheets/${boiler.sheet_id}/stages/${boiler.id}`, { action: 'start', date: today, fitter_employee_id: boiler.emp });
expect('Boiler job card stage starts as before → 200', r.status, 200, r.data);


// 8. Phase 1b: batch MTR intake, duplicates, review, trace.
const { PDFDocument, StandardFonts } = await import('pdf-lib');
async function pdf(text) {
  const d = await PDFDocument.create(); const pg = d.addPage([400, 300]);
  pg.drawText(text, { x: 40, y: 200, size: 12, font: await d.embedFont(StandardFonts.Helvetica) });
  return Buffer.from(await d.save());
}
async function upload(u, path, bytes, name, extra = {}) {
  const fd = new FormData(); fd.append('file', new Blob([bytes], { type: 'application/pdf' }), name);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { cookie: await login(u) }, body: fd });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
const mtrA = await pdf('Mill test report MT-9001 heats K1 K2'), mtrB = await pdf('Mill test report MT-9001 again, other scan');
r = await upload('qc_head', '/api/mtr-intake', Buffer.from('not a pdf'), 'x.pdf');
expect('Upload a non-PDF → 400', r.status, 400, r.data);
const a = await upload('qc_head', '/api/mtr-intake', mtrA, 'MT-9001.pdf');
expect('Upload an MTR → uploaded', a.data.status, 'uploaded', a.data);
r = await upload('qc_head', '/api/mtr-intake', mtrA, 'MT-9001 copy.pdf');
expect('Upload the same bytes again → duplicate', r.data.status, 'duplicate', r.data);
r = await call('qc_head', 'POST', `/api/mtr-intake/${a.data.id}/extract`, {});
expect('Read with no AI key set → failed, kept for manual entry', r.data.status, 'failed', r.data);
const header = { certificate_no: 'MT-9001', steel_maker: 'Example Mill', material_spec: 'SA-516 Gr.70', certificate_date: today };
r = await call('qc_head', 'POST', `/api/mtr-intake/${a.data.id}/accept`, { header: { ...header, steel_maker: '' }, lines: [{ heat_no: 'K1' }] });
expect('Accept without the mill → 400', r.status, 400, r.data);
r = await call('qc_head', 'POST', `/api/mtr-intake/${a.data.id}/accept`, { header, lines: [{ heat_no: 'K1', ys: '262', uts: '485', strength_unit: 'MPa' }, { heat_no: 'K2', ys: '38', uts: '70', strength_unit: 'ksi' }], project_ids: [sheet.project_id] });
expect('Accept two heats → 200', r.status, 200, r.data);
const k = rows(`SELECT cast_no, ys, pdf_key, pdf_sha256, intake_id FROM test_certificates WHERE certificate_no = 'MT-9001' ORDER BY cast_no`);
expect('Two certificates share one PDF and its hash', k.length === 2 && k[0].pdf_key === k[1].pdf_key && !!k[0].pdf_sha256, true, k);
expect('Strength kept with the printed unit', k[1]?.ys, '38 ksi', k);
const b = await upload('qc_head', '/api/mtr-intake', mtrB, 'MT-9001 rescan.pdf');
r = await call('qc_head', 'POST', `/api/mtr-intake/${b.data.id}/accept`, { header, lines: [{ heat_no: 'K1' }] });
expect('Accept a heat already in the bank → 409', r.status, 409, r.data);
expect('Nothing half-saved after the refusal', rows(`SELECT COUNT(*) AS n FROM test_certificates WHERE certificate_no = 'MT-9001'`)[0].n, 2);
r = await call('qc_head', 'GET', '/api/trace?heat=K2');
expect('Trace heat K2 → its certificate and project', r.data[0]?.certificates?.length === 1 && r.data[0].projects.some(p => p.project_no), true, r.data);
const [p1] = rows("SELECT id, project_no FROM projects WHERE project_no = 'AB-1001'");
const [shellHeat] = rows(`SELECT received_heat_no AS h FROM bom_items WHERE project_id = ${p1.id} AND material_description LIKE 'PLATE%' ORDER BY id LIMIT 1`);
r = await call('qc_head', 'GET', `/api/trace?heat=${shellHeat.h}`);
expect(`Trace AB-1001 shell plate heat ${shellHeat.h} → certificate, BOM line and welds`, (r.data[0]?.certificates.length > 0) && r.data[0].bom.length > 0 && r.data[0].welds.length > 0, true, r.data[0] && { c: r.data[0].certificates.length, b: r.data[0].bom.length, w: r.data[0].welds.length });
r = await call('qc_head', 'GET', `/api/trace?project=${p1.id}`);
expect('Trace AB-1001 backwards → every heat it used', r.data.length > 1, true, r.data.length);
let res = await fetch(`${BASE}/api/projects/${p1.id}/trace-map/pdf`, { headers: { cookie: await login('qc_head') } });
expect('Material Trace Map PDF', `${res.status} ${res.headers.get('content-type')}`, '200 application/pdf');

// 9. Phase 1c: Data Book.
r = await call('qc_head', 'GET', `/api/projects/${p1.id}/databook`);
expect('AB-1001 Data Book has missing lines', r.data.missing > 0, true, r.data);
const missing = r.data.rows.filter(x => x.status === 'missing');
r = await call('qc_head', 'POST', `/api/projects/${p1.id}/databook/release`, {});
expect('Release with lines missing → 409', r.status, 409, r.data);
r = await call('production_head', 'PUT', `/api/projects/${p1.id}/databook`, { line_key: missing[0].key, state: 'na', note: 'x' });
expect('Production marks a line N/A → 403', r.status, 403, r.data);
r = await call('qc_head', 'PUT', `/api/projects/${p1.id}/databook`, { line_key: missing[0].key, state: 'na' });
expect('N/A without a reason → 400', r.status, 400, r.data);
const upKey = missing.find(x => x.source === 'upload')?.key || missing[0].key;
r = await upload('qc_head', `/api/projects/${p1.id}/databook/files`, await pdf('Signed nameplate facsimile'), 'nameplate.pdf', { line_key: upKey });
expect('Upload a file to a line → 201', r.status, 201, r.data);
for (const x of missing.filter(x => x.key !== upKey)) await call('qc_head', 'PUT', `/api/projects/${p1.id}/databook`, { line_key: x.key, state: 'na', note: 'Not required for this job (check script)' });
r = await call('qc_head', 'GET', `/api/projects/${p1.id}/databook`);
expect('Nothing missing now', r.data.missing, 0, r.data.problems);
res = await fetch(`${BASE}/api/projects/${p1.id}/databook/pdf`, { headers: { cookie: await login('qc_head') } });
const prelim = Buffer.from(await res.arrayBuffer());
const prelimDoc = res.ok ? await PDFDocument.load(prelim) : null;
expect('Preliminary PDF builds (cover, contents, sections)', res.ok && prelimDoc.getPageCount() >= 4, true, `${res.status} ${prelimDoc?.getPageCount()}`);
r = await call('qc_head', 'POST', `/api/projects/${p1.id}/databook/release`, {});
expect('Release → revision 1', `${r.status} ${r.data.revision}`, '200 1', r.data);
const rel = r.data;
const get = async id => Buffer.from(await (await fetch(`${BASE}/api/databook-releases/${id}/pdf`, { headers: { cookie: await login('qc_head') } })).arrayBuffer());
const { createHash } = await import('node:crypto');
const before = createHash('sha256').update(await get(rel.id)).digest('hex');
expect('Stored file matches its recorded hash', before, rel.sha256);
await upload('qc_head', `/api/projects/${p1.id}/databook/files`, await pdf('Later addition'), 'later.pdf', { line_key: upKey });
expect('A later upload leaves the released file unchanged', createHash('sha256').update(await get(rel.id)).digest('hex'), before);
r = await call('qc_head', 'POST', `/api/projects/${p1.id}/databook/release`, {});
expect('Next release → revision 2', r.data.revision, 2, r.data);
console.log(failed ? `\n${failed} check(s) failed` : '\nall quality checks passed');
process.exit(failed ? 1 : 0);
