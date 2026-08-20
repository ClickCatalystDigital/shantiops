// lib/gst-return.mjs — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5, GST compliance sub-step.
// Dependency-free, same precedent as lib/gst-calc.mjs / lib/ledger.mjs: real calculation logic
// lives here, never inline in a route. Current GST-compliance model (2026-08-20 terminology pass —
// see ACCOUNTING-READINESS.md §7 / ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5), not the old
// GSTR-1/2/3 model: GSTR-1/GSTR-1A/IFF outward, GSTR-2B/IMS-based ITC reconciliation inward, both
// feeding GSTR-3B.

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

// --- GSTR-1 / IFF (outward) — same generator either way, just filed on a different cadence -----
// sales_invoices carries its CGST/SGST/IGST split at document level; sales_invoice_items only
// carries each line's taxable amount. Apportion the document-level split across lines by each
// line's share of the invoice's taxable subtotal — there's no per-line split anywhere to read
// directly.
export function gstr1Summary(rows) {
  const b2bByGstin = new Map();
  const hsnSummary = new Map();
  let totalTaxable = 0, totalCgst = 0, totalSgst = 0, totalIgst = 0;

  for (const r of rows) {
    const taxable = r.amount || 0;
    const share = r.invoice_subtotal ? taxable / r.invoice_subtotal : 0;
    const cgst = round2((r.invoice_cgst || 0) * share);
    const sgst = round2((r.invoice_sgst || 0) * share);
    const igst = round2((r.invoice_igst || 0) * share);
    totalTaxable = round2(totalTaxable + taxable);
    totalCgst = round2(totalCgst + cgst);
    totalSgst = round2(totalSgst + sgst);
    totalIgst = round2(totalIgst + igst);

    const gKey = r.customer_gstin || `no-gstin:${r.customer_name}`;
    if (!b2bByGstin.has(gKey)) {
      b2bByGstin.set(gKey, { customer_gstin: r.customer_gstin || null, customer_name: r.customer_name, invoice_nos: new Set(), taxable: 0, cgst: 0, sgst: 0, igst: 0 });
    }
    const g = b2bByGstin.get(gKey);
    g.invoice_nos.add(r.invoice_no);
    g.taxable = round2(g.taxable + taxable);
    g.cgst = round2(g.cgst + cgst);
    g.sgst = round2(g.sgst + sgst);
    g.igst = round2(g.igst + igst);

    const hKey = r.hsn_code || 'unspecified';
    if (!hsnSummary.has(hKey)) {
      hsnSummary.set(hKey, { hsn_code: r.hsn_code || null, uom: r.uom || null, qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 });
    }
    const h = hsnSummary.get(hKey);
    h.qty = round2(h.qty + (r.qty || 0));
    h.taxable = round2(h.taxable + taxable);
    h.cgst = round2(h.cgst + cgst);
    h.sgst = round2(h.sgst + sgst);
    h.igst = round2(h.igst + igst);
  }

  const b2b = [...b2bByGstin.values()].map(g => ({ ...g, invoice_count: g.invoice_nos.size, invoice_nos: [...g.invoice_nos] }));
  return {
    b2b,
    hsn: [...hsnSummary.values()],
    totalTaxable, totalCgst, totalSgst, totalIgst,
    totalTax: round2(totalCgst + totalSgst + totalIgst),
  };
}

// --- ITC reconciliation (GSTR-2B/IMS vs. Shanti Ops' own Vendor Bills) --------------------------
// Matches on (supplier GSTIN, invoice number) — the two fields a GSTR-2B line and a Vendor Bill
// both carry unambiguously. No fuzzy amount/date matching in this pass; an unmatched pair just
// means someone checks it by hand, same as any bank-reconciliation exception queue.
function matchKey(gstin, invoiceNo) {
  return `${String(gstin || '').trim().toUpperCase()}::${String(invoiceNo || '').trim().toUpperCase()}`;
}

export function itcReconciliation({ gstr2bLines, vendorBills }) {
  const billsByKey = new Map();
  for (const b of vendorBills) billsByKey.set(matchKey(b.supplier_gstin, b.bill_no), b);

  let eligibleItc = 0, excludedItc = 0, matchedCount = 0;
  const lines = gstr2bLines.map(line => {
    const bill = billsByKey.get(matchKey(line.supplier_gstin, line.invoice_no));
    if (bill) matchedCount++;
    const taxAmount = round2((line.igst || 0) + (line.cgst || 0) + (line.sgst || 0));
    // Eligible only when the portal marks it ITC-available AND the recipient has actioned it in
    // IMS as accepted (explicitly, or deemed-accepted by not rejecting it before the GSTR-3B due
    // date). Anything marked "No" by the portal, or rejected in IMS, is excluded here as a flat
    // amount — not run through a Rule 42/43 proportional-reversal calculation, which is real
    // additional complexity out of scope for this pass.
    const eligible = line.itc_availability === 'Yes' && ['accepted', 'deemed_accepted'].includes(line.ims_status);
    if (eligible) eligibleItc = round2(eligibleItc + taxAmount);
    else excludedItc = round2(excludedItc + taxAmount);
    return { ...line, matched_vendor_bill_id: bill?.id ?? null, eligible, tax_amount: taxAmount };
  });

  const gstr2bKeys = new Set(gstr2bLines.map(l => matchKey(l.supplier_gstin, l.invoice_no)));
  const unmatchedVendorBills = vendorBills.filter(b => !gstr2bKeys.has(matchKey(b.supplier_gstin, b.bill_no)));

  return { lines, eligibleItc, excludedItc, matchedCount, unmatchedGstr2bCount: lines.length - matchedCount, unmatchedVendorBills };
}

// --- GSTR-3B (net monthly liability) -------------------------------------------------------------
export function gstr3bSummary({ outwardTax, eligibleItc }) {
  const net = round2(outwardTax - eligibleItc);
  return { outwardTax, eligibleItc, netPayable: net > 0 ? net : 0, itcCarriedForward: net < 0 ? round2(-net) : 0 };
}
