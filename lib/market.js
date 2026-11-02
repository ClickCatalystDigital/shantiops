// lib/market.js — which country this deployment is for. One value per deployment, never per visitor:
// MARKET at runtime (server), NEXT_PUBLIC_MARKET at build time (inlined into the browser bundle).
// Unset = 'IN', so every existing deployment (the client's live app, the Indian demo) behaves exactly as
// before. 'NA' = the North American demo (boiler-erp-us): USD, en-US, US Central time, calendar-year
// books, one sales-tax rate, imperial units by default, ASME paperwork, Letter paper, +1 phones, and the
// India-only modules (GST returns, e-way bill, TDS, PF/ESI/PT, IndiaMART, statutory rate sync) hidden.
// Pure: safe to import from server, client and .mjs self-checks.

const RAW = process.env.NEXT_PUBLIC_MARKET || process.env.MARKET || 'IN';
export const MARKET = RAW === 'NA' || RAW === 'US' ? 'NA' : 'IN';
export const IS_US = MARKET === 'NA';

export const LOCALE = IS_US ? 'en-US' : 'en-IN';
export const TIME_ZONE = IS_US ? 'America/Chicago' : 'Asia/Kolkata';
export const CURRENCY = IS_US ? 'USD' : 'INR';
export const CURRENCY_SYMBOL = IS_US ? '$' : '₹';
export const PAPER = IS_US ? 'LETTER' : 'A4';
export const PHONE_CC = IS_US ? '1' : '91';
// First month (1-12) of the financial year: India April–March, US calendar year.
export const FY_START_MONTH = IS_US ? 1 : 4;
// 'metric' | 'imperial': the Units setting's default (users can switch; stored values are always metric).
export const DEFAULT_UNITS = IS_US ? 'imperial' : 'metric';
// The tax on a sales invoice: GST (CGST/SGST/IGST) or one US sales-tax rate.
export const TAX_LABEL = IS_US ? 'Sales tax' : 'GST';
// Pressure-equipment code the QC folder is filed under.
export const CODE_LABEL = IS_US ? 'ASME' : 'IBR';

// Modules that only exist in India; hidden (nav, routes, help) in the US build.
export const INDIA_ONLY = ['gst', 'gstr', 'gstr2b', 'eway', 'einvoice', 'tds', 'pf', 'esi', 'pt', 'indiamart', 'rate-sync', 'tally'];
export const indiaOnly = key => IS_US && INDIA_ONLY.includes(key);

// US wording for the few Indian-English words the screens use. word('quotation') etc.; India gets the key.
const US_WORDS = {
  quotation: 'estimate', Quotation: 'Estimate', Quotations: 'Estimates', enquiry: 'inquiry', Enquiry: 'Inquiry', Enquiries: 'Inquiries',
  dispatch: 'shipping', Dispatch: 'Shipping', 'test certificate': 'mill test report', 'Test Certificate': 'Mill Test Report',
  'Test Certificates': 'Mill Test Reports',
};
export const word = w => (IS_US && US_WORDS[w]) || w;

// US wording for text the app builds from its Indian vocabulary (labels, notifications, statuses). India: unchanged.
// Whole words, case kept. Applied to notifications (lib/notify.js) and to the rendered screen (components/UsWords.jsx).
// ponytail: one display-time word map instead of editing ~600 screens; a US client deployment would get real labels.
const US_SWAPS = [
  [/\bEnquir(y|ies)\b/g, m => 'Inquir' + m.slice(6)], [/\benquir(y|ies)\b/g, m => 'inquir' + m.slice(6)], [/\bENQUIR(Y|IES)\b/g, m => 'INQUIR' + m.slice(6)],
  [/\bQuotation(s?)\b/g, 'Estimate$1'], [/\bquotation(s?)\b/g, 'estimate$1'], [/\bQUOTATION(S?)\b/g, 'ESTIMATE$1'],
  [/\bDispatched\b/g, 'Shipped'], [/\bdispatched\b/g, 'shipped'], [/\bDispatch(es)?\b/g, 'Shipping'], [/\bdispatch(es)?\b/g, 'shipping'],
  [/\bDISPATCH(ED)?\b/g, m => (m.endsWith('ED') ? 'SHIPPED' : 'SHIPPING')],
  [/\bTest Certificate(s?)\b/g, 'Mill Test Report$1'], [/\btest certificate(s?)\b/g, 'mill test report$1'], [/\bTEST CERTIFICATE(S?)\b/g, 'MILL TEST REPORT$1'],
  [/\bIGST \/ GST\b/g, 'Sales tax'], [/\bGSTIN\b/g, 'Tax ID'], [/\bGST No\.?/g, 'Tax ID'], [/\bGST %/g, 'Tax %'], [/\bGST\b/g, 'Sales tax'],
  [/\bHSN\/SAC\b/g, 'Commodity code'], [/\bHSN( Code)?\b/g, 'Commodity code'], [/\bPAN\b/g, 'EIN'], [/\bIBR\b/g, 'ASME'], [/\bNos\b/g, 'EA'],
];
export function usWords(text) {
  if (!IS_US || !text || typeof text !== 'string') return text;
  let t = text;
  for (const [re, to] of US_SWAPS) t = t.replace(re, to);
  return t;
}

// "Today" as YYYY-MM-DD in the deployment's zone (en-CA formats as ISO).
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE });
export const todayInZone = (d = new Date()) => DAY_FMT.format(d);
