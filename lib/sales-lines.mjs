// lib/sales-lines.mjs — the one place a Sales line's money is computed (docs/sales-crm-plan.md
// 1e–1g): enquiry product lines, quotation lines, and the quotation's GST split. Wraps
// lib/sale-order-calc.mjs (which wraps lib/gst-calc.mjs gstSplit) rather than re-deriving tax, so
// an enquiry, its quotation and the Sale Order made from it always agree. Pure — no DB import.
import { computeSaleOrderTotals } from './sale-order-calc.mjs';

export const DEFAULT_GST_PCT = 18;

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
const num = v => (v === '' || v == null ? 0 : Number(v) || 0);

// qty × rate × (1 − discount %). Rate after discount is always derived, never stored.
export function lineAmount({ qty, rate, discount_pct } = {}) {
  return round2(num(qty) * num(rate) * (1 - num(discount_pct) / 100));
}

export function linesTotal(lines = []) {
  return round2(lines.reduce((a, l) => a + lineAmount(l), 0));
}

// Per-line GST: each line carries its own gst_pct (defaulted from its product), falling back to the
// document rate, then 18%. CGST+SGST when the company and customer are in the same state, else
// IGST — same rule as invoices and the PO wizard. `uniformGstPct` is the rate when every line
// shares one (kept on quotations.tax_pct for the older single-rate displays), else null.
export function quotationTotals(items = [], { companyStateCode = null, customerStateCode = null, fallbackGstPct = DEFAULT_GST_PCT } = {}) {
  const lines = items.map(it => {
    const gst = it.gst_pct === '' || it.gst_pct == null ? num(fallbackGstPct) : num(it.gst_pct);
    return { ...it, amount: lineAmount(it), gst_pct: gst, item_tax_pct: gst };
  });
  const t = computeSaleOrderTotals({ items: lines, companyStateCode, customerStateCode });
  const rates = [...new Set(lines.map(l => l.gst_pct))];
  return { lines, ...t, uniformGstPct: rates.length === 1 ? rates[0] : null };
}

// Enquiry product lines (lead_products) as they arrive from the form. A line needs a description
// or a picked product; blank rows are dropped. Blank unit / rate / GST % take the product's own
// values, so a picked product needs no retyping. `productsById` maps sales_products.id -> row.
// Returns { lines } or { error }.
export function normalizeProductLines(input, productsById = new Map()) {
  if (input == null) return { lines: [] };
  if (!Array.isArray(input)) return { error: 'products must be a list' };
  const lines = [];
  for (const raw of input) {
    const productId = raw?.product_id ? Number(raw.product_id) : null;
    const product = productId ? productsById.get(productId) : null;
    if (productId && !product) return { error: `Unknown product #${productId}` };
    const description = String(raw?.description ?? '').trim() || product?.product_name || '';
    if (!description) continue;
    const numOrNull = (v, fallback) => (v === '' || v == null ? (fallback ?? null) : Number(v));
    const qty = numOrNull(raw.qty, null);
    const rate = numOrNull(raw.rate, product?.price);
    const gst = numOrNull(raw.gst_pct, product?.gst_pct);
    for (const [label, v] of [['Qty', qty], ['Rate', rate], ['GST %', gst]]) {
      if (v != null && (!Number.isFinite(v) || v < 0)) return { error: `${label} must be a number ≥ 0` };
    }
    if (gst != null && gst > 100) return { error: 'GST % must be 100 or less' };
    lines.push({
      product_id: productId, description,
      qty, unit: String(raw?.unit ?? '').trim() || product?.unit || null,
      rate, gst_pct: gst, sort_order: lines.length,
    });
  }
  return { lines };
}
