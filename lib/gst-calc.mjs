// lib/gst-calc.mjs — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 2. Dependency-free, same precedent
// as lib/bom-structure.mjs / lib/qc-inspections.mjs: real calculation logic (tax split, FY
// numbering) lives here, never inline in a route, with a matching *-selfcheck.mjs.
// US build (lib/market.js): calendar-year books ("2026"), document numbers joined with '-'
// (AB-1-2026), and one sales-tax amount per line instead of the CGST/SGST/IGST split.
import { IS_US } from './market.js';

// Indian financial year: April 1 – March 31, labeled "YYYY-YY" (e.g. 2026-04-01 -> "2026-27").
export function financialYear(dateISO) {
  const [y, m] = dateISO.split('-').map(Number);
  if (IS_US) return String(y);
  const startYear = m >= 4 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

// CGST+SGST for an intra-state sale (customer's state == issuing company's state), IGST for
// inter-state. Rounds each component to 2 decimals independently, same as every other money
// field in this app (fmt/toFixed(2) at render time) — not carrying fractional paise.
export function gstSplit({ taxableAmount, ratePct, companyStateCode, customerStateCode }) {
  const taxAmount = round2((taxableAmount || 0) * (ratePct || 0) / 100);
  if (IS_US) return { cgst: 0, sgst: 0, igst: 0, taxAmount }; // sales tax: one amount, no split
  const intraState = !!companyStateCode && !!customerStateCode && companyStateCode === customerStateCode;
  if (intraState) {
    const half = round2(taxAmount / 2);
    return { cgst: half, sgst: round2(taxAmount - half), igst: 0, taxAmount };
  }
  return { cgst: 0, sgst: 0, igst: taxAmount, taxAmount };
}

// A financial-year document number: India AB/1/2026-27, US AB-1-2026. parts: prefix, [series,] seq, fy.
export const docNo = (...parts) => parts.join(IS_US ? '-' : '/');

// Phase 3 — flat section rate per bill, no per-vendor cumulative threshold tracking (that needs
// Vendor Bills to exist to accumulate against, and is deliberately deferred). thresholdAmount
// null/0 means "always deduct" (some sections have no minimum).
export function tdsAmount({ payableAmount, ratePct, thresholdAmount }) {
  if (thresholdAmount && (payableAmount || 0) < thresholdAmount) return 0;
  return round2((payableAmount || 0) * (ratePct || 0) / 100);
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
