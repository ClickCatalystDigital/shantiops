// lib/gate-pass-pdf.js — printable Gate Pass slip, handed to a security guard on the way out the
// gate. Built on the shared lib/report-pdf.js frame (same pattern as lib/bom-pdf.js) — no company
// axis exists on gate_passes, so "Shanti Boilers" is the fixed default, same precedent bom-pdf.js
// already set for a document with no per-row company.
import React from 'react';
import { View, Text, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { ReportDocument, ReportTable, fmtDate } from './report-pdf.js';

const s = StyleSheet.create({
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12, fontSize: 9 },
  field: { marginBottom: 4 },
  label: { color: '#666' },
  sign: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 40 },
  signBox: { width: '42%', borderTopWidth: 1, borderColor: '#333', paddingTop: 4, textAlign: 'center', fontSize: 8 },
});

const COLS = [
  ['#', 6, (it, i) => i + 1],
  ['Description', 62, (it) => it.description],
  ['Qty', 16, (it) => it.qty_text || '—'],
  ['Returned', 16, (it) => it.returned ? 'Yes' : 'No', 'right'],
];

function GatePassDoc({ gp }) {
  return (
    <ReportDocument company="Shanti Boilers" title={`GATE PASS — ${gp.type === 'returnable' ? 'RETURNABLE' : 'NON-RETURNABLE'}`} subtitle={`GP-${gp.gp_no}`}>
      <View style={s.metaRow}>
        <View>
          <Text style={s.field}><Text style={s.label}>Party / destination: </Text>{gp.party || '—'}</Text>
          <Text style={s.field}><Text style={s.label}>Responsible person: </Text>{gp.responsible_person || '—'}</Text>
          <Text style={s.field}><Text style={s.label}>Purpose: </Text>{gp.purpose || '—'}</Text>
        </View>
        <View>
          <Text style={s.field}><Text style={s.label}>Date: </Text>{fmtDate(gp.created_at)}</Text>
          {gp.type === 'returnable' && (
            <Text style={s.field}><Text style={s.label}>Expected return: </Text>{fmtDate(gp.expected_return_date) || '—'}</Text>
          )}
          <Text style={s.field}><Text style={s.label}>Status: </Text>{gp.status}</Text>
        </View>
      </View>
      <ReportTable cols={COLS} rows={gp.items} />
      <View style={s.sign}>
        <View style={s.signBox}><Text>Issued by</Text></View>
        <View style={s.signBox}><Text>Security / Gate</Text></View>
      </View>
    </ReportDocument>
  );
}

export async function renderGatePassPdf({ gp }) {
  return renderToBuffer(<GatePassDoc gp={gp} />);
}
