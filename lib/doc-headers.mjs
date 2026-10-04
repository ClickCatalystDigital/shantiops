// Per-document header and footer choices, saved per company in company_settings.doc_headers_json
// (Accounts → Company Entities → Document headers). Pure: shared by the PDF frame, the API and the screen.
// A document with nothing saved prints exactly as it did before this existed.
export const DOC_FONTS = {
  sans: { label: 'Sans', pdf: 'Helvetica-Bold', css: 'Helvetica, Arial, sans-serif' },
  serif: { label: 'Serif', pdf: 'Times-Bold', css: '"Times New Roman", Times, serif' },
  mono: { label: 'Mono', pdf: 'Courier-Bold', css: '"Courier New", Courier, monospace' },
};
export const LOGO_POSITIONS = ['none', 'left', 'center', 'right'];
// Footer blocks a document can show, in print order. Values come from the company's own details.
export const FOOTER_PARTS = [['address', 'Address'], ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website'], ['gstin', 'GSTIN']];
const PART_KEYS = FOOTER_PARTS.map(([k]) => k);

// key, label, group, sample title, default title size (pt), default logo position.
// sub:false = no address line beside the logo (purchase order). box = logo space in points.
export const DOCS = [
  { key: 'quotation', label: 'Commercial Offer (quotation)', group: 'Sales', title: 'COMMERCIAL OFFER', size: 10 },
  { key: 'sale_order', label: 'Sales Order', group: 'Sales', title: 'SALES ORDER', size: 10 },
  { key: 'sos', label: 'Order Acknowledgement (Scope of Supply)', group: 'Sales', title: 'ORDER ACKNOWLEDGEMENT', size: 11.5 },
  { key: 'invoice', label: 'Tax Invoice', group: 'Sales', title: 'TAX INVOICE', size: 10 },
  { key: 'po', label: 'Purchase Order', group: 'Purchase', title: 'PURCHASE ORDER', size: 13, logo: 'left', sub: false, box: [300, 72] },
  { key: 'vendor_bill', label: 'Vendor Bill', group: 'Purchase', title: 'VENDOR BILL', size: 10 },
  { key: 'packing', label: 'Packing List', group: 'Stores & Dispatch', title: 'MASTER PACKING LIST', size: 10 },
  { key: 'gate_pass', label: 'Gate Pass', group: 'Stores & Dispatch', title: 'GATE PASS', size: 10 },
  { key: 'material_indent', label: 'Material Indent', group: 'Stores & Dispatch', title: 'MATERIAL INDENT', size: 10 },
  { key: 'bom', label: 'Bill of Materials and pending items', group: 'Engineering & Production', title: 'MASTER BILL OF MATERIALS', size: 10 },
  { key: 'calc', label: 'Calculation Sheet', group: 'Engineering & Production', title: 'CALCULATION SHEET', size: 10 },
  { key: 'job_card', label: 'Job Card', group: 'Engineering & Production', title: 'JOB CARD', size: 10 },
  { key: 'costing', label: 'Project / Work Order Costing', group: 'Engineering & Production', title: 'PROJECT COSTING', size: 10 },
  { key: 'service_report', label: 'Service and Commissioning Reports', group: 'Service', title: 'COMMISSIONING REPORT', size: 10 },
  { key: 'service_expense', label: 'Cash Request / Travel Claim', group: 'Service', title: 'TRAVELLING EXPENSES BILL', size: 10 },
  { key: 'payslip', label: 'Payslip', group: 'HR', title: 'PAYSLIP', size: 10 },
  { key: 'report', label: 'All reports (Reports tab)', group: 'Reports', title: 'TRIAL BALANCE', size: 10 },
];
const BY_KEY = Object.fromEntries(DOCS.map(d => [d.key, d]));
export const docDef = key => BY_KEY[key] || BY_KEY.report;

export function parseDocHeaders(json) {
  try { const o = typeof json === 'string' ? JSON.parse(json || '{}') : json; return o && typeof o === 'object' ? o : {}; } catch { return {}; }
}

// Keep only known documents and valid values; anything else is dropped. null/'' = use the default.
export function cleanDocHeaders(input) {
  const out = {};
  for (const [key, v] of Object.entries(parseDocHeaders(input))) {
    if (!BY_KEY[key] || !v || typeof v !== 'object') continue;
    const c = {};
    if (LOGO_POSITIONS.includes(v.logo)) c.logo = v.logo;
    if (DOC_FONTS[v.font]) c.font = v.font;
    const size = Number(v.size);
    if (v.size !== null && v.size !== '' && size >= 7 && size <= 24) c.size = Math.round(size * 2) / 2;
    const footer = String(v.footer || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (footer) c.footer = footer;
    const parts = PART_KEYS.filter(k => Array.isArray(v.footerParts) && v.footerParts.includes(k));
    if (parts.length) c.footerParts = parts;
    if (Object.keys(c).length) out[key] = c;
  }
  return out;
}

// What one document prints for one company. `saved` = the raw saved choices (blank when none).
export function docHeader(headers, key, hasLogo = true) {
  const def = docDef(key), saved = parseDocHeaders(headers)[def.key] || {};
  const logo = hasLogo ? (saved.logo || def.logo || 'none') : 'none';
  return { logo, font: saved.font || 'sans', size: saved.size || def.size, footer: saved.footer || '', footerParts: saved.footerParts || [], sub: def.sub !== false || logo === 'none', box: def.box || [220, 56], saved };
}

// The footer as printed: one line of the chosen company details, then the extra line.
// info = { address, phone, email, website, gstin } of the company; blank values are skipped.
export function footerLines(cfg, info = {}) {
  const text = { address: info.address, phone: info.phone && `Ph: ${info.phone}`, email: info.email, website: info.website, gstin: info.gstin && `GSTIN: ${info.gstin}` };
  const details = cfg.footerParts.map(k => text[k]).filter(Boolean).join('  ·  ');
  return [details, cfg.footer].filter(Boolean);
}
// Points to keep free at the page bottom for the footer (a long line wraps at about 150 characters).
export const footerHeight = lines => lines.reduce((n, l) => n + Math.ceil(l.length / 150) * 8, 0);

if (import.meta.url === `file://${process.argv[1]}`) {
  const eq = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
  eq(docHeader({}, 'po').logo, 'left'); eq(docHeader({}, 'po', false).logo, 'none'); eq(docHeader({}, 'po').sub, false);
  eq(docHeader({}, 'invoice').logo, 'none'); eq(docHeader({}, 'nope').size, 10);
  eq(cleanDocHeaders({ po: { logo: 'top', font: 'comic', size: 99, footer: '  a \n b ' }, x: { logo: 'left' }, invoice: { logo: 'right', size: '12.2' } }),
    { po: { footer: 'a b' }, invoice: { logo: 'right', size: 12 } });
  eq(cleanDocHeaders('{bad'), {});
  eq(docHeader('{"invoice":{"logo":"center","font":"serif"}}', 'invoice').font, 'serif');
  const c = docHeader({ po: { footerParts: ['gstin', 'bogus', 'address'], footer: 'Thank you' } }, 'po');
  eq(cleanDocHeaders({ po: { footerParts: ['gstin', 'bogus', 'address'] } }), { po: { footerParts: ['address', 'gstin'] } });
  eq(footerLines(c, { address: 'Hyderabad', gstin: '36X', phone: '1' }), ['GSTIN: 36X  ·  Hyderabad', 'Thank you']);
  eq(footerLines(docHeader({}, 'po'), { address: 'x' }), []);
  eq(footerHeight(['a', 'b'.repeat(200)]), 24);
  console.log('doc-headers ok');
}
