// lib/calc-report-pdf.js — Phase 3.1 (PDF calculation report). Modeled on lib/quotation-pdf.js (same
// @react-pdf/renderer approach, same header/meta/table shape) — generates from a snapshot's frozen
// data (lib/calc.js's saveSnapshot already pins inputs + exact formula versions + results), so the
// report always matches what "Reproduce" in the Audit panel would recompute.
import React from 'react';
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { round } from './calc-engine';

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 8, fontFamily: 'Helvetica', color: '#111' },
  center: { textAlign: 'center' },
  company: { fontSize: 13, fontWeight: 'bold' },
  sub: { fontSize: 7, color: '#555', marginTop: 2 },
  title: { fontSize: 10, fontWeight: 'bold', marginTop: 6, marginBottom: 4, textAlign: 'center' },
  metaRow: { flexDirection: 'row', marginBottom: 8, marginTop: 4 },
  metaCol: { width: '50%' },
  metaLine: { flexDirection: 'row', paddingVertical: 1 },
  metaLabel: { color: '#666', width: 70 },
  metaVal: { fontWeight: 'bold', flex: 1 },
  sectionTitle: { fontSize: 8.5, fontWeight: 'bold', marginTop: 10, marginBottom: 4, backgroundColor: '#eee', padding: 3 },
  tHead: { flexDirection: 'row', backgroundColor: '#eee', borderTop: 1, borderBottom: 1, borderColor: '#999' },
  tRow: { flexDirection: 'row', borderBottom: 1, borderColor: '#ddd', minHeight: 14 },
  cell: { paddingVertical: 3, paddingHorizontal: 3, borderRight: 1, borderColor: '#ddd' },
  note: { fontSize: 6.5, color: '#777', marginTop: 2 },
  signRow: { flexDirection: 'row', marginTop: 26, justifyContent: 'space-between' },
  signBox: { width: '30%', borderTop: 1, borderColor: '#333', paddingTop: 4, textAlign: 'center', fontSize: 7 },
});

const INPUT_COLS = [['Variable', 30], ['Value', 20], ['Unit', 20], ['Type', 30]];
const TRACE_COLS = [['Formula', 26], ['Ver', 6], ['Expression', 34], ['Result', 16], ['Standard / clause', 18]];
const VALID_COLS = [['Check', 40], ['Severity', 12], ['Result', 12], ['Message', 36]];
const REF_COLS = [['Standard', 40], ['Clause', 30], ['Edition', 30]];

function Row({ cols, vals }) {
  return (
    <View style={s.tRow} wrap={false}>
      {cols.map(([, w], j) => <Text key={j} style={[s.cell, { width: `${w}%` }]}>{vals[j] ?? '—'}</Text>)}
    </View>
  );
}

function Table({ cols, rows }) {
  return (
    <>
      <View style={s.tHead}>{cols.map(([label, w], i) => <Text key={i} style={[s.cell, { width: `${w}%`, fontWeight: 'bold' }]}>{label}</Text>)}</View>
      {rows.map((vals, i) => <Row key={i} cols={cols} vals={vals} />)}
    </>
  );
}

function CalcReportDoc({ snapshot, variables, inputRows, traceRows, checkRows, referenceRows }) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.center}>
          <Text style={s.company}>SHANTI BOILERS &amp; PRESSURE VESSELS PVT LTD</Text>
          <Text style={s.sub}>P-10-10, I.D.A, Nacharam, Hyderabad - 500 056 · GST: 36AAECS7382N1ZN · Ph: 27174042 / 27152164</Text>
          <Text style={s.title}>CALCULATION SHEET</Text>
        </View>

        <View style={s.metaRow}>
          <View style={s.metaCol}>
            <View style={s.metaLine}><Text style={s.metaLabel}>Run</Text><Text style={s.metaVal}>{snapshot.label}</Text></View>
          </View>
          <View style={s.metaCol}>
            <View style={s.metaLine}><Text style={s.metaLabel}>Snapshot ID</Text><Text style={s.metaVal}>{snapshot.id}</Text></View>
            <View style={s.metaLine}><Text style={s.metaLabel}>Date</Text><Text style={s.metaVal}>{snapshot.ts}</Text></View>
            <View style={s.metaLine}><Text style={s.metaLabel}>Prepared by</Text><Text style={s.metaVal}>{snapshot.createdBy || '—'}</Text></View>
          </View>
        </View>

        <Text style={s.sectionTitle}>Design inputs (frozen at save time)</Text>
        <Table cols={INPUT_COLS} rows={inputRows} />

        <Text style={s.sectionTitle}>Execution trace</Text>
        <Table cols={TRACE_COLS} rows={traceRows} />
        <Text style={s.note}>Pinned to the exact formula version approved/live at save time — replaying this run with the current engine ("Reproduce" in Audit) should match exactly unless a formula version or table has since changed.</Text>

        {checkRows.length > 0 && (
          <>
            <Text style={s.sectionTitle}>Validation checks (against current rules)</Text>
            <Table cols={VALID_COLS} rows={checkRows} />
            <Text style={s.note}>Validation rules aren't pinned per snapshot — this reflects the rules in force now, not necessarily at save time.</Text>
          </>
        )}

        {referenceRows.length > 0 && (
          <>
            <Text style={s.sectionTitle}>References</Text>
            <Table cols={REF_COLS} rows={referenceRows} />
          </>
        )}

        <View style={s.signRow}>
          <Text style={s.signBox}>Prepared by</Text>
          <Text style={s.signBox}>Checked by</Text>
          <Text style={s.signBox}>Approved by</Text>
        </View>
      </Page>
    </Document>
  );
}

// Builds the report's table rows from a snapshot + the live registry/methodology + a freshly
// recomputed trace (pinned to the snapshot's exact formula versions/inputs, same mechanism the
// Audit panel's "Reproduce" uses) — the report always shows the full working, not just final values.
export function buildCalcReportRows(snapshot, variables, formulas, trace, checks) {
  const varByName = Object.fromEntries(variables.map((v) => [v.name, v]));
  const formulaById = Object.fromEntries(formulas.map((f) => [f.id, f]));
  const inputRows = Object.entries(snapshot.inputOverride).map(([name, value]) => {
    const v = varByName[name];
    return [name, round(value), v?.unit || '-', v?.type || 'input'];
  });
  const traceRows = trace.map((t) => {
    const f = formulaById[t.formulaId];
    return [
      t.formulaName, `v${t.version}`, t.expr,
      t.error ? 'error' : t.skipped ? 'n/a (guard)' : `${round(t.output)}${f?.unit ? ' ' + f.unit : ''}`,
      f?.source ? [f.source.standard, f.source.clause, f.source.edition].filter(Boolean).join(' · ') : '',
    ];
  });
  const checkRows = checks.map((c) => [c.name, c.severity, c.pass ? 'PASS' : 'FAIL', c.pass ? '—' : c.message]);

  // Phase 3, item 15 ("report indexing") — every distinct standard/clause/edition cited by a
  // formula that actually ran in this trace, deduplicated so a formula reused across a chain (or a
  // standard cited by more than one formula) only lists once.
  const seen = new Set();
  const referenceRows = [];
  trace.forEach((t) => {
    const src = formulaById[t.formulaId]?.source;
    if (!src) return;
    const key = `${src.standard}|${src.clause}|${src.edition}`;
    if (seen.has(key)) return;
    seen.add(key);
    referenceRows.push([src.standard, src.clause || '—', src.edition || '—']);
  });

  return { inputRows, traceRows, checkRows, referenceRows };
}

export async function renderCalcReportPdf(snapshot, variables, formulas, trace, checks) {
  const { inputRows, traceRows, checkRows, referenceRows } = buildCalcReportRows(snapshot, variables, formulas, trace, checks);
  return renderToBuffer(<CalcReportDoc snapshot={snapshot} variables={variables} inputRows={inputRows} traceRows={traceRows} checkRows={checkRows} referenceRows={referenceRows} />);
}
