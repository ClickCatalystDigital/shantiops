// lib/enquiry-import.mjs — pure parsing + matching for the old CRM's "sales calls" list (a PDF of
// 605 enquiries, extracted to CSV, 2026-09-25). Used by scripts/import-enquiries.mjs.
// The list has: customer, short name, address, district, state, enquiry date, phones, email,
// products. No stage, no A/C manager, no value — so nothing here invents them.
// Product text was cut off by the PDF's column width ("BOILER SPA", "F GAS DUCTI"), so it is kept
// as written and never matched to the Product Master (a guess would put the wrong product on a quote).
// Customers are linked only on an exact multi-word name match to exactly one customer; anything
// less certain goes to the review list. No DB import.
import { parseCsv, clean } from './legacy-crm-import.mjs';
import { customerKey, customerMatchReasons } from './customer-match.mjs';

const blankish = v => { const s = clean(v); return !s || /^(na|n\/a|nil|-|all)$/i.test(s) ? '' : s; };

// "25/08/2026" -> "2026-08-25"; anything else -> null.
export function isoDate(v) {
  const m = clean(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// "6304747635 | 7569309007 | NA" -> ['6304747635', '7569309007']
export const splitPhones = v => clean(v).split('|').map(blankish).filter(Boolean);

// The printed products cell reads like "FLUE GAS DUCTING, STRAIGHT CHIMNEY/S SINGLE-CYCLONE," —
// trailing commas/spaces are removed; the rest is kept exactly.
export const cleanProducts = v => clean(v).replace(/[\s,]+$/, '');

export function parseEnquiries(text) {
  const [head, ...body] = parseCsv(String(text).replace(/^﻿/, ''));
  const h = head.map(clean);
  const rows = []; const bad = []; const duplicates = [];
  const seen = new Set();
  for (const r of body) {
    if (!r.some(x => clean(x))) continue;
    const o = Object.fromEntries(h.map((k, i) => [k, r[i] ?? '']));
    const name = clean(o.customer);
    const date = isoDate(o.enquiry_date);
    if (!name || !date) { bad.push({ serial: clean(o.serial_no), reason: !name ? 'no customer' : `unreadable date "${clean(o.enquiry_date)}"` }); continue; }
    const phones = splitPhones(o.phone_numbers);
    const row = {
      serial: Number(clean(o.serial_no)) || null,
      name,
      short_name: blankish(o.organization_short_name) || null,
      address: blankish(o.address) || null,
      district: blankish(o.district) || null,
      state: blankish(o.state) || null,
      enquiry_date: date,
      phone: phones[0] || null,
      telephone: phones.slice(1).join(', ') || null,
      email: blankish(o.email).toLowerCase() || null,
      products: cleanProducts(o.products) || null,
      source_pages: clean(o.source_pages) || null,
    };
    // The same enquiry printed twice (same customer, date, products and phone) is imported once.
    const dupKey = [customerKey(name) || name.toLowerCase(), date, (row.products || '').toLowerCase(), row.phone || ''].join('|');
    if (seen.has(dupKey)) { duplicates.push(row); continue; }
    seen.add(dupKey);
    rows.push(row);
  }
  return { rows, bad, duplicates };
}

// The full name with nothing dropped but legal suffixes, spacing and punctuation:
// "P K Trading Company" = "PK TRADING COMPANY", "M/s. J J Innojet Pvt Ltd" = "J J Innojet".
// (customerKey drops short words, so it can't tell "MR Enterprises" from "SS Enterprises".)
const LEGAL = new Set(['pvt', 'ltd', 'limited', 'private', 'llp', 'the', 'and']);
export const compactName = s => clean(s).toLowerCase().replace(/\bm\/s\.?|\(p\)|\bp\.?\s*(?=ltd\b)/g, ' ')
  .split(/[\s.,()&-]+/).filter(w => w && !LEGAL.has(w)).join('').replace(/[^a-z0-9]/g, '');
// The old-CRM import kept same-named organizations apart as "Name (code)" / "Name (district)" /
// "Name (2)" — for matching they are all "Name", so a shared name is seen as shared.
const baseName = s => clean(s).replace(/\s*\([^)]*\)\s*$/, '');

// Index customers by name once. Returns match(row) -> { customer, how } | { customer: null, reason, similar }.
export function customerMatcher(customers = []) {
  const byKey = new Map(); const byCompact = new Map();
  const add = (map, k, c) => { if (!k) return; if (!map.has(k)) map.set(k, []); map.get(k).push(c); };
  for (const c of customers) { add(byKey, customerKey(c.name), c); add(byCompact, compactName(baseName(c.name)), c); }
  return function match(row) {
    const exact = byCompact.get(compactName(row.name)) || [];
    if (exact.length === 1) return { customer: exact[0], how: 'exact name' };
    if (exact.length > 1) return { customer: null, reason: `${exact.length} customers share this name`, similar: exact.slice(0, 5) };
    const hits = byKey.get(customerKey(row.name)) || [];
    // Same name only once short words/initials are dropped ("KL Enterprises" ~ "SS Enterprises") — never automatic.
    if (hits.length) return { customer: null, reason: 'similar names only', similar: hits.slice(0, 5) };
    // Suggestions only (never linked automatically).
    const similar = [];
    for (const c of customers) {
      if (customerMatchReasons({ name: row.name }, c).length) { similar.push(c); if (similar.length >= 5) break; }
    }
    return { customer: null, reason: similar.length ? 'similar names only' : 'no customer with this name', similar };
  };
}

// Enquiries on or after the cutoff stay open (on the Enquiry tab); older ones are imported as
// closed sales calls — history on the customer, not open work.
export const isOpenEnquiry = (row, cutoffIso) => row.enquiry_date >= cutoffIso;
