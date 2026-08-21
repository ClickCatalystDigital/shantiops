// lib/report-pdf-selfcheck.mjs — smoke test for lib/report-pdf.js: renders a small ReportDocument
// and asserts the output is a real, multi-page PDF whose repeating table header actually repeats
// (the gap that motivated <ReportTable>'s `fixed` header — see REPORT-ENGINE-PLAN). Plain
// React.createElement, no JSX: unlike app code, this runs directly under `node`, no build transform.
// Run: node lib/report-pdf-selfcheck.mjs
import assert from 'node:assert';
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { ReportDocument, ReportTable } from './report-pdf.js';

const h = React.createElement;

// Enough rows to force a second page, so the repeating-header assertion actually means something.
const rows = Array.from({ length: 60 }, (_, i) => ({ id: i, name: `Row ${i + 1}` }));

const doc = h(
  ReportDocument,
  { company: 'Shanti Boilers', title: 'SELF-CHECK REPORT' },
  h(ReportTable, { cols: [['#', 20, (r) => r.id + 1], ['Name', 80, (r) => r.name]], rows })
);

const buf = await renderToBuffer(doc);
assert(Buffer.isBuffer(buf) && buf.length > 0, 'expected a non-empty buffer');
assert(buf.subarray(0, 4).toString('latin1') === '%PDF', 'expected a PDF byte header');

const pdf = await getDocument({ data: new Uint8Array(buf) }).promise;
assert(pdf.numPages >= 2, `expected ≥2 pages to prove the header-repeat check, got ${pdf.numPages}`);

const page1Text = (await (await pdf.getPage(1)).getTextContent()).items.map((it) => it.str).join(' ');
const page2Text = (await (await pdf.getPage(2)).getTextContent()).items.map((it) => it.str).join(' ');
assert(page1Text.includes('Name') && page2Text.includes('Name'), 'expected table header to repeat on page 2');
assert(page1Text.includes('Page 1 of') && page2Text.includes('Page 2 of'), 'expected footer page numbers');

console.log(`ok — report-pdf self-check passed: ${buf.length} bytes, ${pdf.numPages} pages, header repeats`);
