// lib/databook.js — the Data Book for one project (docs/gulf-coast-asme-plan.md, Phase 1c): what each line holds
// (counts, for the dashboard) and the merged PDF (cover, contents with page numbers, sections in order, a page
// stamp on every page, one bookmark per line). Pure rules are in lib/databook.mjs.
import React from 'react';
import { renderToBuffer, View, Text, StyleSheet } from '@react-pdf/renderer';
import { PDFDocument, PDFName, PDFHexString, StandardFonts, rgb } from 'pdf-lib';
import { queryAll, queryOne } from './db';
import { getObjectBuffer } from './r2';
import { ReportDocument, ReportTable, fmtDate } from './report-pdf.js';
import { getProjectBom, getQcDocumentDetail } from './data';
import { renderBomPdf } from './bom-pdf';
import { renderTraceMapPdf } from './trace-map-pdf';
import { traceProject } from './trace';
import { renderQcFolderPdf } from './qc-folder-pdf';
import { checkpointSummaryFromDetail } from './qc-checkpoints.mjs';
import { buildAsmeData, loadSheetGate, parseJson, shippingBlockers } from './quality';
import { completeness, buildManifest } from './databook.mjs';

const h = React.createElement;
const inList = a => a.map(() => '?').join(',') || 'NULL';
const s = StyleSheet.create({
  cover: { marginTop: 120, alignItems: 'center' }, big: { fontSize: 20, fontWeight: 'bold', marginBottom: 10 },
  line: { fontSize: 11, marginBottom: 4 }, note: { fontSize: 8, color: '#666', marginTop: 40, textAlign: 'center' },
});

export async function getBook(projectId) {
  const b = await queryOne('SELECT * FROM databooks WHERE project_id = ?', [projectId]);
  return b ? { ...b, lines: parseJson(b.lines_json, []) } : null;
}

// Records behind each source, for one project. Each loader returns a list of { kind, ref, label, sha256? } items;
// .length is the line's automatic count. Built once per request.
async function sourceItems(projectId) {
  const welds = await queryAll(`SELECT w.*, p.wps_no, p.pdf_key AS wps_pdf, p.pdf_sha256 AS wps_sha FROM welds w
    LEFT JOIN wps p ON p.id = w.wps_id WHERE w.project_id = ? ORDER BY w.weld_no`, [projectId]);
  const stamps = [...new Set(welds.flatMap(w => String(w.welder_stamps || '').split(/[,;\s]+/).filter(Boolean)))];
  const welders = stamps.length ? await queryAll(`SELECT * FROM welders WHERE stamp IN (${inList(stamps)}) ORDER BY stamp`, stamps) : [];
  const sheets = await queryAll('SELECT id, jc_no FROM job_sheets WHERE project_id = ? AND itp_template_id IS NOT NULL ORDER BY id', [projectId]);
  const certs = await queryAll(`SELECT t.id, t.certificate_no, t.cast_no, t.pdf_key, t.pdf_sha256 FROM certificate_projects cp
    JOIN test_certificates t ON t.id = cp.certificate_id WHERE cp.project_id = ? AND t.pdf_key IS NOT NULL ORDER BY t.id`, [projectId]);
  const docs = await queryAll('SELECT id, doc_id FROM qc_documents WHERE project_id = ? ORDER BY id DESC LIMIT 1', [projectId]);
  const bomCount = (await queryOne('SELECT COUNT(*) AS n FROM bom_items WHERE project_id = ?', [projectId])).n;
  const heats = (await traceProject(projectId)).length;
  const byPdf = new Map();
  for (const c of certs) if (!byPdf.has(c.pdf_key)) byPdf.set(c.pdf_key, c);
  let sheetsClear = sheets.length > 0;
  for (const sh of sheets) {
    const g = await loadSheetGate(sh.id);
    if (g.states.some((st, i) => !g.stages[i].after_dispatch && !st.cleared)) sheetsClear = false;
  }
  return {
    welds, welders, sheets,
    itp_release: sheetsClear ? sheets.map(sh => ({ kind: 'itp', ref: sh.jc_no })) : [],
    asme_package: docs.map(d => ({ kind: 'qc_document', ref: d.doc_id || d.id, id: d.id })),
    wps: [...new Map(welds.filter(w => w.wps_pdf).map(w => [w.wps_pdf, { kind: 'wps', ref: w.wps_no, key: w.wps_pdf, sha256: w.wps_sha }])).values()],
    wpq: welders.filter(w => w.wpq_pdf_key).map(w => ({ kind: 'wpq', ref: w.stamp, key: w.wpq_pdf_key, sha256: w.wpq_sha256 })),
    weld_map: welds.length ? [{ kind: 'generated', ref: 'weld map' }] : [],
    stencil_map: welds.length ? [{ kind: 'generated', ref: 'welder stamp map' }] : [],
    bom: bomCount ? [{ kind: 'generated', ref: 'bom' }] : [],
    mtr: [...byPdf.values()].map(c => ({ kind: 'certificate', ref: `${c.certificate_no} ${c.cast_no}`, key: c.pdf_key, sha256: c.pdf_sha256 })),
    trace_map: heats ? [{ kind: 'generated', ref: 'trace map' }] : [],
  };
}

async function inspectionRecords(projectId, type) {
  return queryAll(`SELECT r.id, r.test_type, r.result, r.reference_no, r.inspector, r.tested_on, r.report_key, r.report_sha256,
      st.item_key, w.weld_no,
      (SELECT GROUP_CONCAT(m.characteristic || ' ' || m.value || ' ' || m.unit || COALESCE(' (' || m.verdict || ')', ''), '; ')
         FROM qc_measurements m WHERE m.qc_record_id = r.id) AS values_text
    FROM qc_records r LEFT JOIN job_sheet_stages st ON st.id = r.job_sheet_stage_id LEFT JOIN welds w ON w.id = r.weld_id
    WHERE r.project_id = ? AND UPPER(TRIM(r.test_type)) = UPPER(?) ORDER BY r.tested_on, r.id`, [projectId, type]);
}

// Line → automatic count + file count, for the dashboard.
export async function bookStatus(projectId, book) {
  const src = await sourceItems(projectId);
  const files = await queryAll('SELECT line_key, COUNT(*) AS n FROM databook_files WHERE project_id = ? GROUP BY line_key', [projectId]);
  const fileCount = Object.fromEntries(files.map(f => [f.line_key, f.n]));
  const counts = {};
  for (const l of book.lines) {
    const auto = l.source.startsWith('inspection:') ? (await inspectionRecords(projectId, l.source.slice(11))).length : (src[l.source] || []).length;
    counts[l.key] = { auto, files: fileCount[l.key] || 0 };
  }
  return completeness(book.lines, counts);
}

const table = (company, title, subtitle, cols, rows) => renderToBuffer(
  h(ReportDocument, { company, title, subtitle, orientation: 'landscape', footer: false }, h(ReportTable, { cols, rows, rowKey: (r, i) => i, compact: true })));

// One line's PDFs, in order, as [{ buf, kind, ref, sha256 }].
async function lineParts(project, line, src) {
  const out = [];
  const co = project.company;
  const add = async (kind, ref, key, sha256) => out.push({ kind, ref, sha256, buf: await getObjectBuffer(key) });
  const sub = `${project.project_no} · ${project.customer_name || ''}`;
  switch (line.source) {
    case 'itp_release':
      for (const sh of src.sheets) {
        const g = await loadSheetGate(sh.id);
        // People by name on the record, not by login.
        const users = Object.fromEntries((await queryAll('SELECT username, display_name FROM users')).map(u => [u.username, u.display_name || u.username]));
        const who = u => (u ? users[u] || u : '');
        out.push({ kind: 'itp', ref: sh.jc_no, buf: await table(co, `INSPECTION AND RELEASE SUMMARY · ${sh.jc_no}`, sub,
          [['Point', 7, r => r.item_key], ['Inspection', 33, r => r.name], ['Type', 6, r => r.point_type || 'R'],
            ['QC signed', 17, r => (r.not_applicable ? `N/A: ${r.na_reason || ''}` : r.qc_sign_by ? `${who(r.qc_sign_by)} ${fmtDate(r.qc_sign_at) || ''}` : '—')],
            ['Customer release', 37, r => (r.released_at ? `${r.release_ref || ''} (recorded by ${who(r.released_by)}, ${fmtDate(r.released_at)})` : '—')]],
          g.stages) });
      }
      break;
    case 'asme_package':
      for (const d of src.asme_package) {
        const detail = await getQcDocumentDetail(d.id);
        const cp = checkpointSummaryFromDetail(detail.document, detail.parts, detail.mountings, detail.groups);
        if (!cp?.totalCount || !cp.allComplete) continue; // an incomplete package is not printed (same gate as its own PDF)
        const p = await queryOne(`SELECT p.id, p.project_no, p.customer_name, p.series, p.is_sib, p.model_capacity, c.phone AS customer_phone
          FROM projects p LEFT JOIN customers c ON c.id = p.customer_id WHERE p.id = ?`, [project.id]);
        detail.document = { ...detail.document, asme_data: await buildAsmeData(detail.document) };
        out.push({ kind: 'qc_document', ref: d.ref, buf: await renderQcFolderPdf(detail.document, detail.parts, detail.mountings, p, detail.groups, detail.form4aGroups, detail.seams) });
      }
      break;
    case 'wps': case 'wpq': case 'mtr':
      for (const i of src[line.source]) await add(i.kind, i.ref, i.key, i.sha256);
      break;
    case 'weld_map':
      out.push({ kind: 'generated', ref: 'weld map', buf: await table(co, 'WELD MAP', sub,
        [['Weld', 8, r => r.weld_no], ['Joint', 30, r => r.joint], ['Cat.', 6, r => r.category], ['Type', 22, r => r.type],
          ['WPS', 10, r => r.wps_no], ['Welders', 12, r => r.welder_stamps], ['NDE', 12, r => r.nde]], src.welds) });
      break;
    case 'stencil_map': {
      const rows = src.welders.map(w => ({ ...w, welds: src.welds.filter(x => String(x.welder_stamps || '').split(/[,;\s]+/).includes(w.stamp)).map(x => x.weld_no).join(', ') }));
      out.push({ kind: 'generated', ref: 'welder stamp map', buf: await table(co, 'WELDER STAMP MAP', sub,
        [['Stamp', 12, r => r.stamp], ['Welder', 28, r => r.name], ['WPQ', 15, r => r.wpq_no], ['Welds', 45, r => r.welds]], rows) });
      break;
    }
    case 'bom': {
      const { bom } = await getProjectBom(project.id);
      out.push({ kind: 'generated', ref: 'bom', buf: await renderBomPdf({ project, bom, revision: project.bom_release_revision || 0 }) });
      break;
    }
    case 'trace_map':
      out.push({ kind: 'generated', ref: 'trace map', buf: await renderTraceMapPdf({ project, chains: await traceProject(project.id), company: co, footer: false }) });
      break;
    default:
      if (line.source.startsWith('inspection:')) {
        const recs = await inspectionRecords(project.id, line.source.slice(11));
        if (recs.length) {
          out.push({ kind: 'generated', ref: `${line.source} summary`, buf: await table(co, `${line.label.toUpperCase()} · INSPECTION RECORDS`, sub,
            [['Date', 10, r => fmtDate(r.tested_on)], ['Point', 7, r => r.item_key], ['Weld', 7, r => r.weld_no], ['Report', 15, r => r.reference_no],
              ['Inspector', 16, r => r.inspector], ['Values', 35, r => r.values_text], ['Result', 10, r => r.result]], recs) });
          for (const r of recs) if (r.report_key) await add('inspection_report', r.reference_no || r.id, r.report_key, r.report_sha256);
        }
      }
  }
  const files = await queryAll('SELECT id, file_name, pdf_key, sha256 FROM databook_files WHERE project_id = ? AND line_key = ? ORDER BY id', [project.id, line.key]);
  for (const f of files) await add('file', `${f.id} ${f.file_name}`, f.pdf_key, f.sha256);
  return out;
}

function Front({ project, book, toc, stamp }) {
  return h(ReportDocument, { company: project.company, footer: false, title: 'DATA BOOK', subtitle: `${project.project_no} · ${project.customer_name || ''}` },
    h(View, { style: s.cover },
      h(Text, { style: s.big }, project.customer_name || ''),
      h(Text, { style: s.line }, `Job ${project.project_no}${book.form_no ? ` · ${book.form_no}` : ''}`),
      h(Text, { style: s.line }, stamp),
      h(Text, { style: s.note }, 'Prepared for review. Certification stays with the manufacturer and the Authorized Inspector.')),
    h(View, { break: true }, h(Text, { style: [s.line, { fontWeight: 'bold', marginBottom: 8 }] }, 'TABLE OF CONTENTS'),
      h(ReportTable, { cols: [['Section', 12, r => r.section], ['Contents', 58, r => r.label], ['Included', 15, r => (r.status === 'na' ? 'N/A' : r.status === 'included' ? 'Yes' : 'Missing')], ['Page', 15, r => r.page ?? '—', 'right']], rows: toc, rowKey: r => r.key })));
}

function addOutline(doc, entries) {
  if (!entries.length) return;
  const ctx = doc.context, pages = doc.getPages();
  const root = ctx.nextRef();
  const refs = entries.map(() => ctx.nextRef());
  entries.forEach((e, i) => ctx.assign(refs[i], ctx.obj({
    Title: PDFHexString.fromText(e.title), Parent: root, Dest: [pages[e.page].ref, PDFName.of('Fit')],
    ...(i > 0 ? { Prev: refs[i - 1] } : {}), ...(i < refs.length - 1 ? { Next: refs[i + 1] } : {}),
  })));
  ctx.assign(root, ctx.obj({ Type: 'Outlines', First: refs[0], Last: refs[refs.length - 1], Count: refs.length }));
  doc.catalog.set(PDFName.of('Outlines'), root);
}

// The whole book. strict (release): a file that can't be read fails the build; preview skips it.
export async function buildBookPdf(projectId, { preliminary = true, revision = null, strict = false } = {}) {
  const project = await queryOne('SELECT id, project_no, customer_name, company, bom_release_revision FROM projects WHERE id = ?', [projectId]);
  const book = await getBook(projectId);
  const summary = await bookStatus(projectId, book);
  const src = await sourceItems(projectId);
  const parts = [];
  for (const row of summary.rows) {
    let items = [];
    if (row.status === 'included') {
      try { items = await lineParts(project, row, src); } catch (e) { if (strict) throw new Error(`${row.label}: ${e.message}`); }
    }
    const loaded = [];
    for (const it of items) {
      try { const d = await PDFDocument.load(it.buf, { ignoreEncryption: true }); loaded.push({ ...it, doc: d, pages: d.getPageCount() }); }
      catch (e) { if (strict) throw new Error(`${row.label}: ${it.ref} is not a readable PDF`); }
    }
    parts.push({ ...row, items: loaded });
  }
  const stamp = preliminary ? `PRELIMINARY · ${new Date().toISOString().slice(0, 10)}` : `Released revision ${revision}`;
  // Front matter length decides the page numbers in the contents, so render until it stops changing.
  let frontPages = 2, front;
  for (let i = 0; i < 3; i++) {
    let page = frontPages + 1;
    const toc = parts.map(p => { const n = p.items.reduce((a, it) => a + it.pages, 0); const r = { ...p, page: n ? page : null }; page += n; return r; });
    front = await PDFDocument.load(await renderToBuffer(h(Front, { project, book, toc, stamp })));
    if (front.getPageCount() === frontPages) break;
    frontPages = front.getPageCount();
  }
  const out = await PDFDocument.create();
  for (const p of await out.copyPages(front, front.getPageIndices())) out.addPage(p);
  const outline = [{ title: 'Table of contents', page: 1 }];
  for (const p of parts) {
    if (p.items.length) outline.push({ title: `${p.section ? `${p.section} ` : ''}${p.label}`, page: out.getPageCount() });
    for (const it of p.items) for (const pg of await out.copyPages(it.doc, it.doc.getPageIndices())) out.addPage(pg);
  }
  const font = await out.embedFont(StandardFonts.Helvetica);
  const total = out.getPageCount();
  out.getPages().forEach((pg, i) => {
    const { width } = pg.getSize();
    pg.drawText(`${project.project_no} Data Book · Page ${i + 1} of ${total}`, { x: width - 190, y: 10, size: 7, font, color: rgb(0.3, 0.3, 0.3) });
    if (preliminary) pg.drawText('PRELIMINARY - NOT RELEASED', { x: 20, y: 10, size: 7, font, color: rgb(0.75, 0.1, 0.1) });
  });
  addOutline(out, outline);
  out.setTitle(`${project.project_no} Data Book${preliminary ? ' (preliminary)' : ` rev ${revision}`}`);
  const buf = Buffer.from(await out.save());
  return { buf, pages: total, summary, manifest: buildManifest(parts.map(p => ({ ...p, items: p.items }))) };
}

export { shippingBlockers };
