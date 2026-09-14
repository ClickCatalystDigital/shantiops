// lib/material-indent-pdf.js — Material Indent PDF (plan §11). Built on the shared
// lib/report-pdf.js frame (ReportDocument/ReportTable/tokens), same pattern as lib/bom-pdf.js and
// lib/payslip-pdf.js — an internal Stores-workflow document with no legacy paper form to
// byte-match, so it doesn't belong with the statutory/sample-matched documents (po-pdf.js,
// packing-pdf.js, qc-doc-pdf.js) that stay on bare @react-pdf/renderer for that reason.
//
// Always rendered fresh from whatever `indent`/`items` the caller passes in — no stored snapshot,
// no caching. A route calling this twice (before and after a partial release) gets two different,
// both-correct PDFs, reflecting current DB state each time.
import React from 'react';
import { View, Text, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { ReportDocument, ReportTable, tokens, fmtDate } from './report-pdf.js';

const s = StyleSheet.create({
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4, fontSize: 8 },
  metaCol: { flexDirection: 'column', gap: 2 },
  notes: { fontSize: 8, color: '#555', marginTop: 8, marginBottom: 4 },
  signRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 24, gap: 24 },
});

// Column widths sum to 100 (a real, previously-shipped bug: they summed to 104). Status is
// rendered with underscores replaced by spaces, same convention as every other report's status
// column (e.g. DRAWING_REGISTER_COLS in lib/reports/render.js) — a bare 'partially_released' has
// no space to wrap at, so react-pdf hyphenates mid-word ("partially_re-leased") in a narrow cell.
const COLS = [
  ['#', 4, (it, i) => i + 1],
  ['Item', 22, (it) => it.bom_description || it.inventory_description || '—'],
  ['Spec / MOC', 15, (it) => [it.size_spec, it.moc].filter(Boolean).join(' · ') || '—'],
  ['Requested', 12, (it) => it.qty_requested, 'right'],
  ['Unit', 9, (it) => unitSuffix(it.qty_text) || '—'],
  ['Issued', 12, (it) => it.qty_released || 0, 'right'],
  ['Remaining', 12, (it) => Math.max(0, it.qty_requested - (it.qty_released || 0)), 'right'],
  ['Status', 14, (it) => it.status.replace(/_/g, ' ')],
];

function unitSuffix(qtyText) {
  return String(qtyText || '').replace(/^\s*[\d.]+\s*/, '').trim();
}

function IndentDoc({ indent, items }) {
  return (
    <ReportDocument company="Shanti Boilers" title={`MATERIAL INDENT ${indent.indent_no}`}>
      <View style={s.metaRow}>
        <View style={s.metaCol}>
          <Text>Project: {indent.project_no || '—'}</Text>
          <Text>Requested by: {indent.requested_by || '—'} (Production)</Text>
        </View>
        <View style={s.metaCol}>
          <Text>Date: {fmtDate(indent.created_at)}</Text>
          <Text>Status: {indent.status.replace(/_/g, ' ')}</Text>
        </View>
      </View>
      <ReportTable cols={COLS} rows={items} />
      {indent.notes && <Text style={s.notes}>Notes: {indent.notes}</Text>}
      <View style={s.signRow}>
        <Text style={tokens.signBox}>Issued By (Stores)</Text>
        <Text style={tokens.signBox}>Received By (Name &amp; Signature)</Text>
      </View>
    </ReportDocument>
  );
}

export async function renderMaterialIndentPdf(indent, items) {
  return renderToBuffer(<IndentDoc indent={indent} items={items} />);
}
