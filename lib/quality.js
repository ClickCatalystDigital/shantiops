// lib/quality.js — database reads behind the ITP gate (lib/quality-gate.mjs) and the weld registers.
// Every write route that moves work calls these, so a crafted request is refused the same way the screen is.
import { queryAll, queryOne } from './db';
import { gateStates, openBeforeShipping, parseRequires } from './quality-gate.mjs';

const inList = ids => ids.map(() => '?').join(',') || 'NULL';

// One ITP card with everything the gate needs. Returns null for a card without a template (boiler/APH).
export async function loadSheetGate(sheetId) {
  const sheet = await queryOne('SELECT id, jc_no, project_id, itp_template_id FROM job_sheets WHERE id = ?', [sheetId]);
  if (!sheet?.itp_template_id) return null;
  const stages = await queryAll('SELECT * FROM job_sheet_stages WHERE sheet_id = ? ORDER BY sort_order', [sheetId]);
  const ids = stages.map(s => s.id);
  const [records, ncrs, welds] = await Promise.all([
    ids.length ? queryAll(`SELECT id, job_sheet_stage_id, weld_id, test_type, result, supersedes_id, reference_no, tested_on
      FROM qc_records WHERE job_sheet_stage_id IN (${inList(ids)}) ORDER BY id`, ids) : [],
    ids.length ? queryAll(`SELECT id, ncr_no, status, job_sheet_stage_id, weld_id, disposition, repair_at, qc_verified_at
      FROM ncr_records WHERE job_sheet_stage_id IN (${inList(ids)})`, ids) : [],
    sheet.project_id ? getProjectWelds(sheet.project_id) : [],
  ]);
  return { sheet, stages, records, ncrs, welds, states: gateStates(stages, records, ncrs, welds) };
}

export async function getProjectWelds(projectId) {
  return queryAll(`SELECT w.*, p.wps_no, p.process, p.status AS wps_status FROM welds w
    LEFT JOIN wps p ON p.id = w.wps_id WHERE w.project_id = ? ORDER BY w.weld_no`, [projectId]);
}

export const stateOf = (g, stageId) => g.states.find(s => s.id === stageId);

// What still stops shipping for a project: ITP points not cleared (all ITP cards) and any NCR not closed.
export async function shippingBlockers(projectId) {
  if (!projectId) return [];
  const out = [];
  const sheets = await queryAll('SELECT id, jc_no FROM job_sheets WHERE project_id = ? AND itp_template_id IS NOT NULL', [projectId]);
  for (const sh of sheets) {
    const g = await loadSheetGate(sh.id);
    for (const s of openBeforeShipping(g.stages, g.states)) out.push(`${sh.jc_no} point ${s.item_key} ${s.name}`);
  }
  if (!sheets.length) return out; // no ITP on this project: shipping works as before
  const ncrs = await queryAll("SELECT ncr_no, status FROM ncr_records WHERE project_id = ? AND status != 'closed'", [projectId]);
  for (const n of ncrs) out.push(`${n.ncr_no} ${n.status}`);
  return out;
}

// Copy a template's points onto a new card's stage rows (the card keeps its own copy: editing the template
// later does not change cards already made from it).
export async function templateRows(templateId) {
  const t = await queryOne('SELECT * FROM itp_templates WHERE id = ? AND active = 1', [templateId]);
  if (!t) return null;
  const items = await queryAll('SELECT * FROM itp_template_items WHERE template_id = ? ORDER BY sort_order', [templateId]);
  return { template: t, items };
}

export const dependentsOf = (stages, key) => stages.filter(s => parseRequires(s.requires).includes(String(key)));

// Before QC verifies an NCR on an ITP point: a rework/repair must be recorded, and the point must have
// a passing inspection newer than the one that failed (same weld when the NCR names one). Returns why not, or null.
export async function ncrRetestState(ncr) {
  if (!['rework', 'repair'].includes(ncr.disposition)) return null;
  if (!ncr.repair_at) return 'Production has not recorded the repair yet';
  const after = ncr.qc_record_id || 0;
  const recs = await queryAll(`SELECT id, test_type, result, weld_id FROM qc_records WHERE job_sheet_stage_id = ?
    ${ncr.weld_id ? 'AND weld_id = ?' : ''} ORDER BY id`, ncr.weld_id ? [ncr.job_sheet_stage_id, ncr.weld_id] : [ncr.job_sheet_stage_id]);
  const latest = new Map();
  for (const r of recs) latest.set(`${r.weld_id ?? ''}|${r.test_type.trim().toUpperCase()}`, r);
  const last = [...latest.values()];
  if (last.some(r => r.result === 'fail')) return 'The latest inspection still fails — record a new inspection after the repair';
  if (!last.some(r => r.result === 'pass' && r.id > after)) return 'Record a passing re-inspection after the repair first';
  return null;
}

export async function insertTemplateItems(tx, templateId, items) {
  for (const it of items) {
    await tx.execute({ sql: `INSERT INTO itp_template_items (template_id, sort_order, section, item_key, name, doc_code, point_type, requires,
      test_type, per_weld, qc_only, after_dispatch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [templateId, it.sort_order, it.section, it.item_key, it.name, it.doc_code, it.point_type, it.requires, it.test_type, it.per_weld, it.qc_only, it.after_dispatch] });
  }
}


// ---- Welding registers as the shape lib/qc-asme.mjs already reads (weldMapProblems, continuityRows, the PDF).
export const parseJson = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
export const splitList = s => String(s || '').split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);

export async function weldingData(projectId) {
  const [welds, wps, welders] = await Promise.all([
    getProjectWelds(projectId),
    queryAll('SELECT * FROM wps ORDER BY wps_no'),
    queryAll('SELECT * FROM welders WHERE active = 1 ORDER BY stamp'),
  ]);
  return {
    wps: wps.map(w => ({ id: w.wps_no, process: w.process, pqr: w.pqr_no, base_metal: w.base_metal, thickness: w.thickness, pwht: w.pwht, status: w.status })),
    welders: welders.map(w => ({ stamp: w.stamp, name: w.name, wpq: w.wpq_no, processes: parseJson(w.processes_json, {}) })),
    welds: welds.map(w => ({ id: w.weld_no, joint: w.joint, category: w.category, type: w.type, wps: w.wps_no, welders: splitList(w.welder_stamps), nde: w.nde })),
  };
}

// The ASME record package data for one QC document: the report header facts stay in qc_documents.asme_data;
// welds, WPS, welders and NDE come from the registers when the project has welds (otherwise the stored JSON,
// as the demo seed wrote it before the registers existed). Same shape lib/qc-asme-pdf.js reads.
export async function buildAsmeData(document) {
  const base = parseJson(document.asme_data, {});
  const projectId = document.project_id;
  const welds = await getProjectWelds(projectId);
  if (!welds.length) return base;
  const data = await weldingData(projectId);
  const usedWps = new Set(data.welds.map(w => w.wps).filter(Boolean));
  const usedStamps = new Set(data.welds.flatMap(w => w.welders));
  const recs = await queryAll(`SELECT r.id, r.weld_id, r.test_type, r.result, r.reference_no, r.inspector, r.tested_on, w.weld_no
    FROM qc_records r JOIN welds w ON w.id = r.weld_id WHERE w.project_id = ? ORDER BY r.id`, [projectId]);
  const latest = new Map();
  for (const r of recs) latest.set(r.weld_no, r);
  return {
    ...base,
    wps: data.wps.filter(w => usedWps.has(w.id)),
    welders: data.welders.filter(w => usedStamps.has(w.stamp)),
    welds: data.welds.map(w => {
      const old = (base.welds || []).find(x => x.id === w.id);
      const r = latest.get(w.id);
      return { ...w, nde_report: r ? r.reference_no : old?.nde_report || null, result: r ? r.result : old?.result || null };
    }),
    // Every NDE record, failures and retests included: the package shows the history, not only the last word.
    // A project whose NDE was never recorded per weld keeps the reports stored on the document.
    nde: recs.length ? recs.map(r => ({ report: r.reference_no || `QC-${r.id}`, method: r.test_type, extent: '', welds: r.weld_no,
      examiner: r.inspector, level: '', date: r.tested_on, result: r.result })) : base.nde || [],
  };
}
