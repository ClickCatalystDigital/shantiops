// Purchase Order Terms and Conditions: an optional second page of the PO PDF, saved per company in
// company_settings.po_terms_json (Procurement → Purchase Orders → Terms & Conditions, /procurement/terms).
// Pure: shared by the PDF, the API and the editor. Fonts = the same three as Accounts' document headers.
import { DOC_FONTS } from './doc-headers.mjs';

export const PO_TERMS_DEFAULT_HEADING = 'TERMS AND CONDITIONS';
// Regular (body) face of each of the three PDF built-in fonts; the heading uses DOC_FONTS[...].pdf (bold).
export const BODY_FONT = { sans: 'Helvetica', serif: 'Times-Roman', mono: 'Courier' };
const MAX_BODY = 20000;

export function cleanPoTerms(input) {
  let o = input;
  try { if (typeof o === 'string') o = JSON.parse(o || '{}'); } catch { o = {}; }
  if (!o || typeof o !== 'object') o = {};
  const size = Number(o.headingSize), bodySize = Number(o.bodySize);
  return {
    enabled: !!o.enabled,
    heading: String(o.heading ?? PO_TERMS_DEFAULT_HEADING).replace(/\s+/g, ' ').trim().slice(0, 120),
    headingFont: DOC_FONTS[o.headingFont] ? o.headingFont : 'sans',
    headingSize: size >= 8 && size <= 24 ? Math.round(size * 2) / 2 : 12,
    bodyFont: DOC_FONTS[o.bodyFont] ? o.bodyFont : 'sans',
    bodySize: bodySize >= 6 && bodySize <= 14 ? Math.round(bodySize * 2) / 2 : 8,
    body: String(o.body || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_BODY),
  };
}

// Printed only when switched on and there is some text.
export const poTermsPrinted = t => t.enabled && !!t.body;

if (import.meta.url === `file://${process.argv[1]}`) {
  const eq = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
  const d = cleanPoTerms('{bad');
  eq([d.enabled, d.heading, d.headingFont, d.headingSize, d.bodySize], [false, PO_TERMS_DEFAULT_HEADING, 'sans', 12, 8]);
  const t = cleanPoTerms({ enabled: 1, heading: '  T &  C ', headingFont: 'serif', bodyFont: 'comic', headingSize: 99, bodySize: '9.3', body: 'a\r\n\n\n\nb ' });
  eq([t.enabled, t.heading, t.headingFont, t.bodyFont, t.headingSize, t.bodySize, t.body], [true, 'T & C', 'serif', 'sans', 12, 9.5, 'a\n\nb']);
  eq(poTermsPrinted(t), true); eq(poTermsPrinted({ ...t, body: '' }), false); eq(poTermsPrinted({ ...t, enabled: false }), false);
  eq(cleanPoTerms({ heading: '' }).heading, '');
  console.log('po-terms ok');
}
