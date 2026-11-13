// lib/pdf-upload.js — one checked PDF upload: real PDF signature, size limit, SHA-256, stored in R2.
// Used by inspection reports, WPS and welder qualification files (docs/gulf-coast-asme-plan.md).
import { putObject } from './r2';

export const MAX_PDF_BYTES = 20 * 1024 * 1024;

export async function sha256Hex(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Check a File from formData without storing it: { buf, sha256, size } or { error }.
export async function readPdf(file) {
  if (!file || typeof file.arrayBuffer !== 'function') return { error: 'No file' };
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > MAX_PDF_BYTES) return { error: 'File is over 20 MB' };
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') return { error: 'Not a PDF file' };
  return { buf, sha256: await sha256Hex(buf), size: buf.length };
}

export async function putPdf({ buf, sha256 }, prefix) {
  const key = `${prefix}/${sha256.slice(0, 16)}-${Date.now()}.pdf`;
  await putObject(key, buf, 'application/pdf');
  return key;
}

// Returns { key, sha256, size } or { error } for a File from formData.
export async function storePdf(file, prefix) {
  const r = await readPdf(file);
  if (r.error) return r;
  try { return { key: await putPdf(r, prefix), sha256: r.sha256, size: r.size }; }
  catch (e) { return { error: e.message }; } // e.g. uploads turned off in the public demo
}
