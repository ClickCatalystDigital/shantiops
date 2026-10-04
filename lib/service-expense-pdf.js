// lib/service-expense-pdf.js — printable Cash Requisition / Travelling Expenses Bill, on the shared
// report frame (same pattern as lib/material-indent-pdf.js). Rendered fresh from the request row.
import React from 'react';
import { View, Text, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { ReportDocument, ReportTable, ReportTotals, tokens, fmt, fmtDate } from './report-pdf.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getObjectBuffer } from './r2.js';
import { amountInWords, STATUS_LABEL, sumRows, tourSummary } from './service-expense.mjs';

const s = StyleSheet.create({
  box: { borderWidth: 0.5, borderColor: '#999', padding: 6, marginBottom: 8 },
  row: { flexDirection: 'row', marginBottom: 3, fontSize: 9 },
  label: { width: 95, color: '#555' },
  val: { flex: 1, fontWeight: 'bold' },
  h: { fontSize: 9, fontWeight: 'bold', marginTop: 8, marginBottom: 3 },
  reject: { fontSize: 9, color: '#b00020', marginBottom: 8 },
  signRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 28, gap: 24 },
});

const Row = ({ label, children }) => <View style={s.row}><Text style={s.label}>{label}</Text><Text style={s.val}>{children || '—'}</Text></View>;
const rs = n => fmt(n, { currency: true });
const col = (key, label, w, right) => [label, w, r => (key === 'amount' ? fmt(r[key]) : /date$/.test(key) && r[key] ? fmtDate(r[key]) : r[key]), right && 'right'];

function trail(r) {
  return [
    r.manager_by && `${r.manager_by} (Manager${r.manager_at ? `, ${fmtDate(r.manager_at)}` : ''})`,
    r.executive_by && `${r.executive_by} (Executive${r.executive_at ? `, ${fmtDate(r.executive_at)}` : ''})`,
  ].filter(Boolean).join('; ');
}

function Table({ title, rows, cols }) {
  if (!rows?.length) return null;
  return (
    <View>
      <Text style={s.h}>{title}</Text>
      <ReportTable cols={cols} rows={rows} />
      <ReportTotals pairs={[['Total', fmt(sumRows(rows))]]} />
    </View>
  );
}

function Doc({ r }) {
  const d = r.data;
  const cash = r.kind === 'cash';
  const sum = !cash && tourSummary(d, r.advance_taken);
  return (
    <ReportDocument title={`${cash ? 'CASH REQUISITION' : 'TRAVELLING EXPENSES BILL'} ${r.req_no}`}>
      <View style={s.box}>
        <Row label="Date">{fmtDate(r.form_date)}</Row>
        <Row label={cash ? 'Requested by' : 'Name'}>{r.requester_name}</Row>
        <Row label="Status">{STATUS_LABEL[r.status] || r.status}</Row>
        {cash ? (
          <>
            <Row label="Amount">{rs(r.amount)}</Row>
            <Row label="In words">{amountInWords(r.amount)}</Row>
            <Row label="Purpose">{d.purpose}</Row>
            <Row label="Customers">{r.customers.map(c => c.name).join(', ')}</Row>
            {r.applied?.length > 0 && <Row label="Used as advance">{r.applied.map(a => `${a.req_no} ${rs(a.amount)}`).join(', ')}</Row>}
            <Row label="Remaining">{rs(r.remaining)}</Row>
          </>
        ) : (
          <>
            <Row label="Place of visit">{r.customers[0]?.name}</Row>
            <Row label="Purpose of visit">{d.purpose}</Row>
            <Row label="Chargeable">{d.chargeable === 'no' ? 'Not chargeable' : 'Chargeable'}</Row>
            <Row label="Party name">{d.party_name}</Row>
            <Row label="Remarks">{d.remarks}</Row>
          </>
        )}
        <Row label="Authorized by">{trail(r)}</Row>
      </View>
      {r.status === 'rejected' && <Text style={s.reject}>Rejected by {r.rejected_stage}: {r.rejected_note}</Text>}
      {!cash && (
        <>
          <Table title="1. Travel details" rows={d.travel} cols={[col('dep_date', 'Dep. date', 11), col('dep_time', 'Time', 8), col('dep_place', 'From', 14), col('arr_date', 'Arr. date', 11), col('arr_time', 'Time', 8), col('arr_place', 'To', 14), col('mode', 'Mode', 10), col('class', 'Class', 8), col('amount', 'Amount', 16, true)]} />
          <Table title="2. Lodging" rows={d.lodging} cols={[col('date', 'Date', 70), col('amount', 'Amount', 30, true)]} />
          <Table title="3. Boarding / journey allowance" rows={d.boarding} cols={[col('date', 'Date', 25), col('place', 'Place', 45), col('amount', 'Amount', 30, true)]} />
          <Table title="4. Conveyance" rows={d.conveyance} cols={[col('date', 'Date', 14), col('from', 'From', 22), col('to', 'To', 22), col('mode', 'Mode', 12), col('km', 'Km', 8), col('amount', 'Amount', 22, true)]} />
          <Table title="5. Other expenses" rows={d.other} cols={[col('date', 'Date', 14), col('type', 'Type', 18), col('particulars', 'Particulars', 44), col('amount', 'Amount', 24, true)]} />
          <Text style={s.h}>Tour Summary</Text>
          <ReportTable cols={[['#', 6, (l, i) => i + 1], ['Particulars', 64, l => l[0]], ['Amount', 30, l => fmt(l[1]), 'right']]} rows={sum.lines} />
          <ReportTotals pairs={[
            ['Total', rs(sum.total)],
            [`Advance taken${r.advances?.length ? ` (${r.advances.map(a => a.req_no).join(', ')})` : ''}`, rs(sum.advance)],
            [sum.balance < 0 ? 'Balance payable to company' : 'Balance payable to employee', rs(Math.abs(sum.balance))],
          ]} />
        </>
      )}
      <View style={s.box}>
        <Text style={s.h}>For Accounts department use only</Text>
        <Row label="Settled on">{r.settled_on && fmtDate(r.settled_on)}</Row>
        <Row label="Accounted by">{r.accounted_by}</Row>
        <Row label="Checked">{r.checked_by}</Row>
      </View>
      <View style={s.signRow}>
        <Text style={[tokens.signBox, { width: '30%' }]}>Requested by</Text>
        <Text style={[tokens.signBox, { width: '30%' }]}>Authorized by</Text>
        <Text style={[tokens.signBox, { width: '30%' }]}>Accounts</Text>
      </View>
    </ReportDocument>
  );
}

const SECTION_LABEL = { travel: 'Travel details', lodging: 'Lodging', boarding: 'Boarding / journey allowance', conveyance: 'Conveyance expenses', other: 'Other expenses' };

// The form, then every receipt as extra pages: a PDF's pages are copied, a photo gets its own A4 page
// with a one-line caption. A receipt that can't be read is skipped (the form is the legal part).
export async function renderServiceExpensePdf(r) {
  const form = await renderToBuffer(<Doc r={r} />);
  const files = Object.entries(r.data.attachments || {}).flatMap(([sec, list]) => list.map(a => ({ ...a, sec })));
  if (!files.length) return form;
  const out = await PDFDocument.load(form);
  const font = await out.embedFont(StandardFonts.Helvetica);
  for (const f of files) {
    try {
      const bytes = await getObjectBuffer(f.key);
      if (f.type === 'application/pdf') {
        const src = await PDFDocument.load(bytes);
        (await out.copyPages(src, src.getPageIndices())).forEach(pg => out.addPage(pg));
        continue;
      }
      const img = f.type === 'image/png' ? await out.embedPng(bytes) : await out.embedJpg(bytes);
      const page = out.addPage([595.28, 841.89]);
      const caption = `${r.req_no} - ${SECTION_LABEL[f.sec] || f.sec} - ${f.name}`.replace(/[^\x20-\x7E]/g, '?');
      page.drawText(caption, { x: 36, y: 810, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
      const k = Math.min(523 / img.width, 750 / img.height, 1);
      page.drawImage(img, { x: 36, y: 795 - img.height * k, width: img.width * k, height: img.height * k });
    } catch (err) {
      console.error(`service-expense-pdf: skipped receipt ${f.key}`, err);
    }
  }
  return Buffer.from(await out.save());
}
