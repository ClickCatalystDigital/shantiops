// lib/sales-call-details-import.mjs — pure parsing + normalising for the old CRM's "Sales Projection
// Enquiry List" export (sales_call_details1..3.csv, 5,121 enquiries, 2020-2026). Used by
// scripts/import-sales-call-details.mjs. No DB import.
// Layout: 3 title lines, then a 24-column header (S.N ... Next Followup Date). A few rows have
// unquoted commas in Address (extra columns): the extras are merged back into Address; a row with
// too FEW columns can't be read reliably and is reported, never guessed.
import { parseCsv, clean } from './legacy-crm-import.mjs';
import { isoDate } from './enquiry-import.mjs';

export const COLS = 24;
const EMAIL = /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/;
export const STAGE_MAP = {
  'LEAD - COLD': 'Lead - Cold', 'LEAD - HOT': 'Lead - Hot', 'LEAD PROJECT - DROPED': 'Lead Project - Dropped',
  'PROPOSALS': 'Proposals', 'HOT OFFERS': 'Hot Offers', 'ORDER RECEIVED': 'Order Received',
  'ORDER LOST': 'Order Lost', 'FOLLOW UP STAGE': 'Follow up stage', 'OEM FOLLOW UPS MONTHLY': 'OEM Follow Ups Monthly',
};

// "91-9876543210" / "+91 98765 43210" / "09876543210" -> "9876543210"; other shapes keep their digits
// (landline with area code etc.); fewer than 6 digits is not a phone.
export function normPhone(v) {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d.length >= 6 ? d : '';
}
const phones = v => [...new Set(String(v ?? '').split(/[\/,;]+/).map(normPhone).filter(Boolean))];
const emails = v => [...new Set(String(v ?? '').toLowerCase().split(/[\s,;]+/).filter(e => EMAIL.test(e)))];
const titleCase = s => clean(s).toLowerCase().replace(/(^|\s)\S/g, m => m.toUpperCase());
const num = v => { const n = Number(String(v || '').replace(/,/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };

// The "Contact Person" cell reads "Mob. No. 91-9370736745\n \n Tel. No. 9370736745\n \n Email Id x@y.com".
export function parseContactCell(cell) {
  const s = String(cell ?? '');
  const grab = re => [...s.matchAll(re)].map(m => m[1]);
  return {
    mobiles: grab(/Mob\. No\.\s*([^\n]*)/g).flatMap(phones),
    tels: grab(/Tel\. No\.\s*([^\n]*)/g).flatMap(phones),
    emails: grab(/Email Id\s*([^\n]*)/g).flatMap(emails),
  };
}

// Splits "84021000-BOILER-A, 84021000-BOILER-B" on the 8-digit HSN prefixes the export prints;
// without any, on commas (same rule as the earlier projection-enquiries import).
export function splitProducts(raw) {
  const s = clean(raw);
  if (!s) return [];
  const marks = [...s.matchAll(/(\d{8})-/g)].map(m => m.index);
  if (!marks.length) return s.split(',').map(clean).filter(Boolean);
  return marks.map((m, i) => clean(s.slice(m + 9, marks[i + 1] ?? s.length)).replace(/,+$/, '').trim()).filter(Boolean);
}

// texts: the file contents. Returns { rows, bad } — bad = [{ serial, reason }].
export function parseSalesCallDetails(texts) {
  const rows = [], bad = [];
  for (const text of texts) {
    const all = parseCsv(String(text).replace(/^﻿/, ''));
    const hi = all.findIndex(r => clean(r[0]) === 'S.N');
    if (hi < 0) throw new Error('header row "S.N" not found');
    for (let r of all.slice(hi + 1)) {
      if (!/^\d+$/.test(clean(r[0]))) continue; // trailing fragments of a broken row
      const serial = Number(clean(r[0]));
      if (r.length < COLS) { bad.push({ serial, name: clean(r[1]), reason: `only ${r.length} columns (row is cut off)` }); continue; }
      if (r.length > COLS) { const extra = r.length - COLS; r = [...r.slice(0, 3), r.slice(3, 4 + extra).join(','), ...r.slice(4 + extra)]; }
      const name = clean(r[1]), enquiryDate = isoDate(clean(r[4]));
      if (!name || !enquiryDate) { bad.push({ serial, name, reason: !name ? 'no customer' : `unreadable date "${clean(r[4])}"` }); continue; }
      const cc = parseContactCell(r[7]);
      const em = [...new Set([...emails(r[12]), ...cc.emails, ...emails(r[11])])];
      const ph = [...new Set([...cc.mobiles, ...phones(r[9])])];
      const tel = [...new Set([...cc.tels, ...phones(r[10])])].filter(t => !ph.includes(t));
      const stageRaw = clean(r[15]).toUpperCase();
      rows.push({
        serial, name, shortName: clean(r[2]) || null, address: clean(String(r[3]).replace(/ALL$/, '')) || null,
        enquiryDate, state: /^(all|na|n\/a|-)?$/i.test(clean(r[6])) ? null : titleCase(r[6]),
        email: em[0] || null, extraEmails: em.slice(1), phone: ph[0] || null,
        telephone: [...ph.slice(1), ...tel].join(', ') || null,
        products: splitProducts(r[14]), stage: STAGE_MAP[stageRaw] || null, stageRaw,
        value: num(r[16]), expectedDate: isoDate(clean(r[17])), manager: clean(r[18]) || null,
        followupDate: isoDate(clean(r[20])), action: clean(r[21]) || null, plan: clean(r[22]) || null,
        nextDate: isoDate(clean(r[23])),
        contactName: clean(r[8]) || null, contactPhone: normPhone(r[9]) || null, contactEmail: emails(r[11])[0] || null,
      });
    }
  }
  return { rows, bad };
}

// Same enquiry printed twice: same name, date and value -> once.
export function dedupeRows(rows, keyName) {
  const seen = new Set(), out = [], dups = [];
  for (const r of rows) {
    const k = `${keyName(r.name)}|${r.enquiryDate}|${r.value ?? ''}`;
    if (seen.has(k)) dups.push(r); else { seen.add(k); out.push(r); }
  }
  return { rows: out, dups };
}
