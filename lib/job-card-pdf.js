// lib/job-card-pdf.js — the printed shop-floor Job Card traveler (client's own real format: one row
// per production stage, Fitter/Welder + dates + a Production sign-off, plus Inspection
// Date/TC Number/QC Sign wherever a stage is an actual QC checkpoint). One row = one job_cards row,
// already one-per-route-step via the existing generate-job-cards action — no new aggregation.
import React from 'react';
import { View, Text, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { ReportDocument, ReportTable, fmtDate, tokens } from './report-pdf.js';

const s = StyleSheet.create({
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10, fontSize: 8, gap: 4 },
  metaCell: { width: '33%', marginBottom: 3 },
  metaLabel: { color: '#666' },
  notes: { marginTop: 10, fontSize: 8, minHeight: 30, borderWidth: 1, borderColor: '#ddd', padding: 4 },
  signRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20 },
});

export const COLS = [
  ['S.No', 4, (r, i) => i + 1],
  ['Production Stage', 20, r => `${r.jc_no ? `${r.jc_no} · ` : ''}${r.stage}`],
  ['Fitter/Welder', 12, r => r.workers || '—'],
  ['Start Date', 8, r => fmtDate(r.actual_start) || '—'],
  ['End Date', 8, r => fmtDate(r.actual_end) || '—'],
  ['Production Sign', 10, r => (r.status === 'done' ? (r.workers || '—') : '—')],
  ['Inspection Date', 9, r => (r.requires_qc_hold ? fmtDate(r.qc_released_at) || '—' : '—')],
  ['Test Certificate No.', 13, r => r.test_certificate_no || '—'],
  ['QC Sign', 9, r => (r.requires_qc_hold ? r.qc_released_by || '—' : '—')],
  ['Remarks', 7, r => r.notes || '—'],
];

function Meta({ label, value }) {
  return (
    <View style={s.metaCell}>
      <Text><Text style={s.metaLabel}>{label}: </Text>{value || '—'}</Text>
    </View>
  );
}

function JobCardDoc({ workOrder: wo, rows }) {
  return (
    <ReportDocument company={wo.company || 'Shanti Boilers'} title="JOB CARD" orientation="landscape">
      <View style={s.metaGrid}>
        <Meta label="Job Number" value={wo.wo_no} />
        <Meta label="Project" value={wo.project_no ? `${wo.project_no} — ${wo.customer_name}` : (wo.product_description || 'Stock')} />
        <Meta label="Drawing Approved On" value={fmtDate(wo.drawing_approved_on)} />
        <Meta label="IBR / BVI" value={wo.ibr_bvi} />
        <Meta label="DRG. Nos." value={wo.drg_nos} />
        <Meta label="Boiler Plate Nos." value={wo.boiler_plate_nos} />
        <Meta label="Start Date" value={fmtDate(wo.planned_start)} />
        <Meta label="End Date" value={fmtDate(wo.planned_end)} />
      </View>
      <ReportTable cols={COLS} rows={rows} />
      {wo.notes ? (
        <View style={s.notes}><Text><Text style={s.metaLabel}>NOTES: </Text>{wo.notes}</Text></View>
      ) : null}
      <View style={s.signRow}>
        <Text style={tokens.signBox}>PRODUCTION I/C SIGNATURE</Text>
        <Text style={tokens.signBox}>QC SIGNATURE</Text>
      </View>
    </ReportDocument>
  );
}

export async function renderJobCardPdf({ workOrder, rows }) {
  return renderToBuffer(<JobCardDoc workOrder={workOrder} rows={rows} />);
}
