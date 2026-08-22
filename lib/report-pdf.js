// lib/report-pdf.js — shared PDF frame (identity header + footer + repeating table) factored out of
// the near-identical StyleSheet/company-header/table blocks duplicated across
// lib/{bom,packing,payslip,po,qc-doc}-pdf.js. Existing statutory/sample-matched docs (po-pdf,
// qc-doc-pdf, qc-folder-pdf) are intentionally left on their own styles — REPORT-ENGINE-PLAN.md:
// uniform chrome (header/footer), never uniform documents.
//
// Uses React.createElement instead of JSX (unlike every other lib/*-pdf.js) so this file — and its
// self-check — can run directly under plain `node`, not just inside Next's SWC-transformed app.
import React from 'react';
import { Document, Page, View, Text, StyleSheet, renderToStream } from '@react-pdf/renderer';
import { companyProfile } from './company-profiles.js';

const h = React.createElement;

export const tokens = StyleSheet.create({
  page: { padding: 28, paddingBottom: 40, fontSize: 8, fontFamily: 'Helvetica', color: '#111' },
  center: { textAlign: 'center' },
  company: { fontSize: 13, fontWeight: 'bold' },
  sub: { fontSize: 7, color: '#555', marginTop: 2 },
  title: { fontSize: 10, fontWeight: 'bold', marginTop: 6, marginBottom: 4, textAlign: 'center' },
  docId: { fontSize: 8, marginTop: 2, marginBottom: 6, textAlign: 'center', color: '#555' },
  tHead: { flexDirection: 'row', backgroundColor: '#eee', borderTop: 1, borderBottom: 1, borderColor: '#999' },
  tRow: { flexDirection: 'row', borderBottom: 1, borderColor: '#ddd', minHeight: 14 },
  cell: { paddingVertical: 3, paddingHorizontal: 3, borderRight: 1, borderColor: '#ddd' },
  cellRight: { textAlign: 'right' },
  signBox: { width: '45%', borderTop: 1, borderColor: '#333', paddingTop: 4, textAlign: 'center', fontSize: 7 },
  sectionTitle: { fontSize: 9, fontWeight: 'bold', marginTop: 10, marginBottom: 4 },
  empty: { fontSize: 8, color: '#888', textAlign: 'center', marginTop: 12, marginBottom: 12 },
  totalsLine: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginTop: 8, paddingHorizontal: 4 },
  totalsPair: { flexDirection: 'row', gap: 4 },
  totalsLabel: { color: '#666' },
  totalsVal: { fontWeight: 'bold' },
  footer: {
    position: 'absolute', bottom: 14, left: 28, right: 28, fontSize: 6, color: '#888',
    textAlign: 'center', borderTop: 1, borderColor: '#ddd', paddingTop: 3,
  },
});

// "Rs." not "₹" — react-pdf's default Helvetica is a base-14 PDF font (WinAnsi encoding), which has
// no glyph for U+20B9; it silently renders as a stray superscript digit instead of erroring.
export function fmt(n, { currency = false } = {}) {
  const num = Number(n || 0);
  const s = Math.abs(num).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const withSymbol = currency ? `Rs. ${s}` : s;
  return num < 0 ? `(${withSymbol})` : withSymbol;
}

export function fmtDate(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d)) return v;
  return d.toLocaleDateString('en-GB'); // dd/mm/yyyy, matches every other doc's convention
}

// The uniform footer alone — split out so a document with a legitimately different header (e.g.
// packing-pdf.js's Stores contact line instead of the standard GST/phone sub) can still opt into the
// one piece of chrome that's unconditionally uniform, without ReportPage forcing its header on it too.
export function ReportFooter({ generatedBy }) {
  const by = generatedBy ? ` by ${generatedBy}` : '';
  return h(Text, {
    style: tokens.footer,
    fixed: true,
    render: ({ pageNumber, totalPages }) =>
      `Page ${pageNumber} of ${totalPages} · Generated${by} ${new Date().toLocaleString('en-IN')} · Computer-generated, no signature required`,
  });
}

// Uniform identity header (company name/sub + title) + fixed footer. Body is whatever the document
// needs — this is chrome, not a content template.
export function ReportPage({ company, title, subtitle, generatedBy, orientation = 'portrait', size = 'A4', children }) {
  const profile = companyProfile(company);
  return h(
    Page,
    { size, orientation, style: tokens.page },
    h(
      View,
      { style: tokens.center },
      h(Text, { style: tokens.company }, profile.name),
      h(Text, { style: tokens.sub }, profile.sub),
      title ? h(Text, { style: tokens.title }, title) : null,
      subtitle ? h(Text, { style: tokens.docId }, subtitle) : null,
    ),
    children,
    h(ReportFooter, { generatedBy }),
  );
}

export function ReportDocument({ children, ...pageProps }) {
  return h(Document, null, h(ReportPage, pageProps, children));
}

// Repeating table primitive — cols: [[label, width%, get?, align?]]. Header row is `fixed` so
// react-pdf repeats it on every page (its documented pattern for multi-page tables). None of the
// existing per-document PDFs do this because none of them span more than a page or two today —
// report-engine tables (ledgers, registers) regularly will.
export function ReportTable({ cols, rows, rowKey = (r, i) => r.id ?? i }) {
  return h(
    React.Fragment,
    null,
    h(
      View,
      { style: tokens.tHead, fixed: true },
      cols.map(([label, w, , align], i) =>
        h(Text, { key: i, style: [tokens.cell, { width: `${w}%`, fontWeight: 'bold' }, align === 'right' && tokens.cellRight] }, label)),
    ),
    rows.map((r, i) =>
      h(
        View,
        { key: rowKey(r, i), style: tokens.tRow, wrap: false },
        cols.map(([, w, get, align], j) =>
          h(Text, { key: j, style: [tokens.cell, { width: `${w}%` }, align === 'right' && tokens.cellRight] }, (get ? get(r, i) : r[j]) ?? '—')),
      )),
  );
}

// A report's closing totals line — pairs: [[label, value]]. Every accounts-style report ends with
// one of these (Trial Balance's Dr/Cr, P&L's net profit, ...), so unlike a full table this earns
// being a shared primitive from the start rather than copy-pasted per report.
export function ReportTotals({ pairs }) {
  if (!pairs || !pairs.length) return null;
  return h(
    View,
    { style: tokens.totalsLine },
    pairs.map(([label, value], i) =>
      h(
        View,
        { key: i, style: tokens.totalsPair },
        h(Text, { style: tokens.totalsLabel }, `${label}: `),
        h(Text, { style: tokens.totalsVal }, value),
      )),
  );
}

// Report-engine exports stream instead of buffering (like every existing lib/*-pdf.js's
// renderToBuffer) so a large multi-page report isn't fully materialized in Node memory before the
// response starts.
export function renderReportPdf(element) {
  return renderToStream(element);
}

// Boxed stat tiles, wrapped in a fixed-width grid — for headline-numbers documents (Management
// Report, Manufacturing Performance Summary), not a ledger. NOT built on <ReportTotals>: that
// primitive is a single right-aligned closing-totals line, sized for 2-3 short pairs (Trial
// Balance's Dr/Cr). Tried it first for a 4-long-label headline row — content overflowed the row
// width and react-pdf's flex `gap` silently collapsed, running label and value together with no
// visible space. A fixed-width wrapped grid doesn't have that overflow failure mode: each tile has
// its own width, text wraps inside it instead of squeezing its neighbors. Promoted here from
// lib/reports/management-report-pdf.js once a second document needed the same shape.
const statGridTokens = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  tile: { width: '25%', paddingVertical: 6, paddingRight: 8 },
  tileLabel: { fontSize: 7, color: '#666', marginBottom: 2 },
  tileValue: { fontSize: 10, fontWeight: 'bold' },
});
export function StatGrid({ stats }) {
  return h(
    View,
    { style: statGridTokens.grid },
    stats.map(([label, value]) =>
      h(
        View,
        { key: label, style: statGridTokens.tile },
        h(Text, { style: statGridTokens.tileLabel }, label),
        h(Text, { style: statGridTokens.tileValue }, value),
      )),
  );
}
