// lib/installation-report-pdf.js — Commissioning Report and Field Service Report PDFs, driven by the
// same template as the form (lib/installation-report-template.mjs) so they can't drift.
import React from 'react';
import { View, Text, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { ReportDocument, ReportTable, fmtDate } from './report-pdf.js';
import { sectionsFor } from './installation-report-template.mjs';

// Helvetica is WinAnsi: no glyph for these; swap to plain ASCII rather than print a stray box.
const safe = (v) => String(v ?? '')
  .replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/Ω/g, 'ohm').replace(/→/g, '->')
  .replace(/₂/g, '2').replace(/₃/g, '3').replace(/⁻/g, '-').replace(/[−–]/g, '-');

const s = StyleSheet.create({
  section: { marginTop: 8, marginBottom: 2, fontSize: 9, fontWeight: 'bold', backgroundColor: '#f3f3f3', padding: 3 },
  kv: { flexDirection: 'row', flexWrap: 'wrap' },
  kvCell: { width: '50%', flexDirection: 'row', paddingVertical: 2, paddingRight: 6 },
  kvWide: { width: '100%', flexDirection: 'row', paddingVertical: 2 },
  label: { color: '#555', width: '42%' },
  val: { flex: 1, fontWeight: 'bold' },
  sign: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20 },
});

const STATUS = { ok: 'OK', ng: 'NG' };
const fieldVal = (fl, v) => (fl.type === 'date' ? fmtDate(v) : v) || '—';

function Fields({ section, values }) {
  return (
    <View style={s.kv}>
      {section.fields.filter(fl => fl.type !== 'signature').map(fl => (
        <View key={fl.key} style={fl.type === 'textarea' ? s.kvWide : s.kvCell} wrap={false}>
          <Text style={[s.label, fl.type === 'textarea' && { width: '21%' }]}>{fl.label}</Text>
          <Text style={s.val}>{safe(fieldVal(fl, values[fl.key]))}</Text>
        </View>
      ))}
    </View>
  );
}

function TableSection({ section, rows }) {
  const cols = section.columns;
  const w = section.key === 'motors' ? [26, 8, 8, 9, 9, 9, 9, 10, 12] : null;
  const fixedOf = (c) => (c.key === 'label' ? (cols.length <= 2 ? 50 : 34) : 14);
  const editable = cols.filter(c => !c.fixed);
  const rest = (100 - cols.filter(c => c.fixed).reduce((n, c) => n + fixedOf(c), 0)) / (editable.length || 1);
  const spec = cols.map((c, i) => [
    c.label,
    w ? w[i] : c.fixed ? fixedOf(c) : rest,
    (r) => safe(c.kind === 'status' ? (STATUS[r[c.key]] || '—') : c.kind === 'date' ? fmtDate(r[c.key]) : r[c.key]) || '—',
  ]);
  return <ReportTable cols={spec} rows={rows} rowKey={(r, i) => i} />;
}

function Report({ report, sections, title, sign }) {
  const { fields = {}, tables = {} } = report.data;
  return (
    <ReportDocument company={report.company || 'Shanti Boilers'} title={title}
      subtitle={`${report.report_no} · ${report.project_no} · ${fmtDate(report.report_date) || ''}`}>
      {sections.map(sec => (
        <View key={sec.key}>
          <Text style={s.section}>{safe(sec.title)}</Text>
          {sec.kind === 'fields' ? <Fields section={sec} values={fields} /> : <TableSection section={sec} rows={tables[sec.key] || []} />}
        </View>
      ))}
      <View style={s.sign} wrap={false}>
        {sign.map(([t, key]) => (
          <View key={t} style={{ width: `${Math.floor(94 / sign.length)}%`, textAlign: 'center' }}>
            <View style={{ height: 44, justifyContent: 'flex-end', alignItems: 'center' }}>
              {String(fields[key] || '').startsWith('data:image') ? <Image src={fields[key]} style={{ height: 42, objectFit: 'contain' }} /> : null}
            </View>
            <Text style={{ borderTopWidth: 1, borderColor: '#333', paddingTop: 3, fontSize: 7 }}>{t}</Text>
          </View>
        ))}
      </View>
    </ReportDocument>
  );
}

export async function renderInstallationReportPdf(report) {
  const commissioning = report.call_type === 'Commissioning';
  return renderToBuffer(
    <Report report={report} sections={sectionsFor(report.call_type)}
      title={commissioning ? 'COMMISSIONING REPORT' : `FIELD SERVICE REPORT — ${report.call_type.toUpperCase()}`}
      sign={commissioning ? [['Commissioning Engineer', 'sig_engineer'], ['Customer Representative', 'sig_customer'], ['Third Party Inspector', 'sig_tpi']] : [['Sr. Engineer', 'sig_engineer'], ['Customer', 'sig_customer']]} />
  );
}
