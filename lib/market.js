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

// "Today" as YYYY-MM-DD in the deployment's zone (en-CA formats as ISO).
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE });
export const todayInZone = (d = new Date()) => DAY_FMT.format(d);
