// lib/customer-match.mjs — Sales CRM plan 1k. "Is this customer already in the list?" Used before
// an enquiry becomes a customer and on Add Customer / Add Enquiry. Matches on any of:
//   - the same GST No (exact, case/space-insensitive) — strongest signal;
//   - the same phone (last 10 digits);
//   - a similar name: company words ignoring legal suffixes (Pvt/Ltd/…), Jaccard ≥ 0.6, or every
//     word of the shorter name inside the longer one (≥ 2 words), so "Shanti Boilers" ~
//     "Shanti Boilers & Pressure Vessels Pvt Ltd".
// Suggestion only — a person always decides. Pure, no DB import (reuses match-utils normalizeWords).
import { normalizeWords } from './match-utils.js';

const SUFFIX = new Set(['pvt', 'ltd', 'limited', 'private', 'llp', 'company', 'the', 'and', 'inc', 'corp', 'corporation', 'co']);
const nameWords = s => [...new Set(normalizeWords(s).filter(w => !SUFFIX.has(w)))];
const gstKey = s => String(s || '').replace(/\s+/g, '').toUpperCase();
const phoneKey = s => { const d = String(s || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };

export function customerMatchReasons(input, c) {
  const reasons = [];
  if (gstKey(input.gst_no) && gstKey(input.gst_no) === gstKey(c.gst_no)) reasons.push('same GST No');
  const p = phoneKey(input.phone);
  if (p && (p === phoneKey(c.phone) || p === phoneKey(c.mobile))) reasons.push('same phone');
  const a = nameWords(input.name), b = nameWords(c.name);
  if (a.length && b.length) {
    const inter = a.filter(w => b.includes(w)).length;
    const jaccard = inter / new Set([...a, ...b]).size;
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    if (jaccard >= 0.6 || (short.length >= 2 && short.every(w => long.includes(w)))) reasons.push('similar name');
  }
  return reasons;
}

export function similarCustomers(input, customers = [], { limit = 5, excludeId = null } = {}) {
  return customers
    .filter(c => c.id !== excludeId)
    .map(c => ({ id: c.id, name: c.name, gst_no: c.gst_no || null, phone: c.phone || null, reasons: customerMatchReasons(input, c) }))
    .filter(m => m.reasons.length)
    .sort((x, y) => y.reasons.length - x.reasons.length || x.name.localeCompare(y.name))
    .slice(0, limit);
}
