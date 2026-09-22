// lib/sale-order-calc.mjs — Sales CRM expansion Phase 2.6. Real calc lives here, never inline in
// a route (same precedent as lib/gst-calc.mjs itself, which this wraps rather than reimplements).
import { gstSplit } from './gst-calc.mjs';

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

// items: [{amount, item_tax_pct}] — each line's own post-discount, pre-tax amount and its own
// tax rate (per-line "Tax on Return (%)"). discountPct applies to the line-item subtotal before
// tax; packing/insurance/freight/other are flat order-level additions, untaxed.
export function computeSaleOrderTotals({ items, discountPct = 0, packingForwarding = 0, insurance = 0, freight = 0, other = 0, companyStateCode, customerStateCode }) {
  const subtotal = round2(items.reduce((s, it) => s + (Number(it.amount) || 0), 0));
  const discountAmount = round2(subtotal * (discountPct || 0) / 100);
  const netAfterDiscount = round2(subtotal - discountAmount);
  // Tax computed per line at its own rate, on its own share of the post-discount net (proportional
  // to the line's own amount) — a single order-wide rate can't represent per-line "Tax on Return".
  let cgst = 0, sgst = 0, igst = 0;
  for (const it of items) {
    const lineAmount = Number(it.amount) || 0;
    if (!lineAmount) continue;
    const lineNet = subtotal > 0 ? netAfterDiscount * (lineAmount / subtotal) : 0;
    const split = gstSplit({ taxableAmount: lineNet, ratePct: Number(it.item_tax_pct) || 0, companyStateCode, customerStateCode });
    cgst += split.cgst; sgst += split.sgst; igst += split.igst;
  }
  cgst = round2(cgst); sgst = round2(sgst); igst = round2(igst);
  const charges = round2((Number(packingForwarding) || 0) + (Number(insurance) || 0) + (Number(freight) || 0) + (Number(other) || 0));
  const total = round2(netAfterDiscount + cgst + sgst + igst + charges);
  return { subtotal, discountAmount, netAfterDiscount, cgst, sgst, igst, taxAmount: round2(cgst + sgst + igst), total };
}
