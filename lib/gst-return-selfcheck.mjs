// lib/gst-return-selfcheck.mjs — run with `node lib/gst-return-selfcheck.mjs`. Same precedent as
// lib/gst-calc.mjs's / lib/ledger.mjs's matching selfchecks.
import assert from 'node:assert/strict';
import { gstr1Summary, itcReconciliation, gstr3bSummary } from './gst-return.mjs';

// GSTR-1: two lines on one invoice (intra-state, CGST+SGST) — apportioned by taxable share, and
// grouped correctly into B2B (by customer GSTIN) and HSN summaries.
{
  const rows = [
    { invoice_no: 'INV-1', invoice_subtotal: 1000, invoice_cgst: 90, invoice_sgst: 90, invoice_igst: 0,
      customer_gstin: '36AAAAA0000A1Z5', customer_name: 'Acme', hsn_code: '8402', uom: 'No', qty: 1, amount: 800 },
    { invoice_no: 'INV-1', invoice_subtotal: 1000, invoice_cgst: 90, invoice_sgst: 90, invoice_igst: 0,
      customer_gstin: '36AAAAA0000A1Z5', customer_name: 'Acme', hsn_code: '7308', uom: 'No', qty: 2, amount: 200 },
  ];
  const s = gstr1Summary(rows);
  assert.equal(s.totalTaxable, 1000);
  assert.equal(s.totalCgst, 90);
  assert.equal(s.totalSgst, 90);
  assert.equal(s.totalIgst, 0);
  assert.equal(s.b2b.length, 1);
  assert.equal(s.b2b[0].invoice_count, 1);
  assert.equal(s.hsn.length, 2);
  const line1 = s.hsn.find(h => h.hsn_code === '8402');
  assert.equal(line1.cgst, 72); // 90 * 800/1000
}

// ITC reconciliation: one matched+eligible line, one matched-but-rejected line, one unmatched line,
// one Vendor Bill with no GSTR-2B counterpart at all.
{
  const gstr2bLines = [
    { supplier_gstin: '36BBBBB1111B1Z1', invoice_no: 'SUP-01', igst: 0, cgst: 900, sgst: 900, itc_availability: 'Yes', ims_status: 'accepted' },
    { supplier_gstin: '36BBBBB1111B1Z1', invoice_no: 'SUP-02', igst: 0, cgst: 100, sgst: 100, itc_availability: 'Yes', ims_status: 'rejected' },
    { supplier_gstin: '36CCCCC2222C1Z1', invoice_no: 'SUP-03', igst: 500, cgst: 0, sgst: 0, itc_availability: 'No', ims_status: 'pending' },
  ];
  const vendorBills = [
    { id: 1, supplier_gstin: '36BBBBB1111B1Z1', bill_no: 'SUP-01' },
    { id: 2, supplier_gstin: '36BBBBB1111B1Z1', bill_no: 'SUP-02' },
    { id: 3, supplier_gstin: '36DDDDD3333D1Z1', bill_no: 'NEVER-IN-2B' },
  ];
  const r = itcReconciliation({ gstr2bLines, vendorBills });
  assert.equal(r.matchedCount, 2);
  assert.equal(r.eligibleItc, 1800); // only SUP-01
  assert.equal(r.excludedItc, 200 + 500);
  assert.equal(r.unmatchedGstr2bCount, 1); // SUP-03
  assert.equal(r.unmatchedVendorBills.length, 1);
  assert.equal(r.unmatchedVendorBills[0].bill_no, 'NEVER-IN-2B');
  const line1 = r.lines.find(l => l.invoice_no === 'SUP-01');
  assert.equal(line1.matched_vendor_bill_id, 1);
  assert.equal(line1.eligible, true);
}

// GSTR-3B: net payable when liability exceeds ITC, carried-forward credit when ITC exceeds liability.
{
  assert.equal(gstr3bSummary({ outwardTax: 18000, eligibleItc: 5000 }).netPayable, 13000);
  const credit = gstr3bSummary({ outwardTax: 5000, eligibleItc: 18000 });
  assert.equal(credit.netPayable, 0);
  assert.equal(credit.itcCarriedForward, 13000);
}

console.log('lib/gst-return.mjs selfcheck: all assertions passed');
