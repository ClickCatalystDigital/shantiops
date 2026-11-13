// Fictional sample documents for the US demo (mill test reports, WPS, WPQ, drawings...). Every page says
// SAMPLE: none of these is a real company's document. Used by the US seed (files behind the demo records) and by
// make-us-sample-docs.mjs (the PDFs a presenter drags into Batch upload / the Data Book on camera).
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// doc: { title, org, address, fields: [[label, value]], tables: [{ title, cols: [label], widths: [pts], rows: [[...]] }], notes: [text], sign }
export async function samplePdf(doc) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([612, 792]);
  let y = 750;
  const text = (s, x, size = 9, f = font, color = rgb(0.1, 0.1, 0.1)) => page.drawText(String(s ?? ''), { x, y, size, font: f, color });
  const newPage = () => { page = pdf.addPage([612, 792]); y = 750; };
  const need = h => { if (y - h < 60) newPage(); };
  if (doc.org) { text(doc.org, 40, 14, bold); y -= 15; }
  if (doc.address) { text(doc.address, 40, 8, font, rgb(0.35, 0.35, 0.35)); y -= 22; }
  text(doc.title, 40, 13, bold); y -= 20;
  page.drawLine({ start: { x: 40, y: y + 8 }, end: { x: 572, y: y + 8 }, thickness: 0.6, color: rgb(0.6, 0.6, 0.6) });
  for (const [label, value] of doc.fields || []) {
    need(14); text(`${label}:`, 40, 9, bold); text(value, 190, 9); y -= 13;
  }
  for (const t of doc.tables || []) {
    y -= 10; need(40);
    if (t.title) { text(t.title, 40, 10, bold); y -= 15; }
    const xs = t.widths.reduce((a, w) => [...a, a[a.length - 1] + w], [40]);
    t.cols.forEach((c, i) => text(c, xs[i], 8, bold)); y -= 4;
    page.drawLine({ start: { x: 40, y }, end: { x: xs[xs.length - 1], y }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) }); y -= 11;
    for (const r of t.rows) { need(13); r.forEach((v, i) => text(v, xs[i], 8)); y -= 12; }
  }
  for (const n of doc.notes || []) { y -= 8; need(14); text(n, 40, 8, font, rgb(0.3, 0.3, 0.3)); y -= 11; }
  if (doc.sign) { y -= 30; need(40); page.drawLine({ start: { x: 380, y: y + 12 }, end: { x: 560, y: y + 12 }, thickness: 0.5 }); text(doc.sign, 380, 8); }
  for (const p of pdf.getPages()) p.drawText('SAMPLE DOCUMENT - fictional, for demonstration only', { x: 40, y: 24, size: 7, font, color: rgb(0.7, 0.2, 0.2) });
  return Buffer.from(await pdf.save());
}

// A mill test report: several heats, chemistry and tensile results in the unit the mill prints.
export function mtrDoc({ certNo, mill, address, spec, product, date, po, unit = 'ksi', heats }) {
  return {
    org: mill, address, title: 'CERTIFIED MILL TEST REPORT',
    fields: [['Certificate no.', certNo], ['Date', date], ['Customer PO', po], ['Specification', spec], ['Product', product]],
    tables: [
      { title: 'Chemical analysis (heat, %)', cols: ['Heat no.', 'C', 'Mn', 'P', 'S', 'Si'], widths: [90, 60, 60, 60, 60, 60],
        rows: heats.map(h => [h.heat, h.c, h.mn, h.p, h.s, h.si]) },
      { title: `Mechanical properties (${unit})`, cols: ['Heat no.', 'Piece', 'Size', 'Yield', 'Tensile', 'Elong. %'], widths: [80, 70, 130, 60, 60, 60],
        rows: heats.map(h => [h.heat, h.piece || '-', h.size, h.ys, h.uts, h.el]) },
    ],
    notes: ['We hereby certify that the material described above has been manufactured and tested in accordance with the specification.',
      'Melted and manufactured in the USA.'],
    sign: 'Quality Assurance Manager',
  };
}
