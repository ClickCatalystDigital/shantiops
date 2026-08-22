// app/api/purchase-orders/[id]/record-bill/route.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 3.
// Same "convert" playbook as app/api/quotations/[id]/convert-to-invoice, purchase direction: PO's
// own lines copy into a Vendor Bill, tax split via lib/gst-calc.mjs, optional flat-rate TDS
// deduction from Phase 1's vendor_tds_rates.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getPurchaseOrderDetail } from '@/lib/data';
import { audit } from '@/lib/usb';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';
import { gstSplit, tdsAmount } from '@/lib/gst-calc.mjs';
import { todayISO } from '@/lib/date';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Procurement', 'procurement.vendor_bill.write');
  if (actionDenied) return actionDenied;

  const detail = await getPurchaseOrderDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { po, items } = detail;
  if (po.status !== 'issued') {
    return NextResponse.json({ error: 'Only an issued PO can have a bill recorded against it' }, { status: 409 });
  }

  const b = await req.json();
  if (!b.bill_no) return NextResponse.json({ error: 'bill_no is required' }, { status: 400 });
  const company = COMPANY_NAMES.includes(b.company) ? b.company : (COMPANY_NAMES.includes(po.company) ? po.company : COMPANY_NAMES[0]);
  const companyRow = await queryOne('SELECT * FROM company_settings WHERE company = ?', [company]);

  const billDate = b.bill_date || todayISO();
  const ratePct = Number(b.gst_rate_pct) || 0;
  const subtotal = items.reduce((sum, it) => sum + Number(it.amount || 0), 0);
  const split = gstSplit({
    taxableAmount: subtotal,
    ratePct,
    companyStateCode: companyRow?.state_code,
    customerStateCode: po.supplier_state_code ?? null,
  });
  const total = subtotal + split.taxAmount;

  let tdsSection = null, tdsRatePct = 0, tdsAmt = 0;
  if (b.tds_rate_id) {
    const rate = await queryOne('SELECT * FROM vendor_tds_rates WHERE id = ?', [b.tds_rate_id]);
    if (rate) {
      tdsSection = rate.section;
      tdsRatePct = rate.rate_pct;
      tdsAmt = tdsAmount({ payableAmount: total, ratePct: rate.rate_pct, thresholdAmount: rate.threshold_amount });
    }
  }
  // Reverse charge: vendor invoice carries no GST, so what's actually owed to the vendor excludes
  // the tax portion too (lib/ledger.mjs's vendorBillLines() posts the self-assessed liability).
  const isReverseCharge = !!b.is_reverse_charge;
  const payableAmount = (isReverseCharge ? subtotal : total) - tdsAmt;

  const { lastId } = await execute(
    `INSERT INTO vendor_bills
       (bill_no, po_id, company, bill_date, due_date, subtotal, cgst_amount, sgst_amount, igst_amount,
        tax_amount, total, tds_section, tds_rate_pct, tds_amount, payable_amount, is_reverse_charge, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [b.bill_no, po.id, company, billDate, b.due_date ?? null, subtotal, split.cgst, split.sgst, split.igst,
      split.taxAmount, total, tdsSection, tdsRatePct, tdsAmt, payableAmount, isReverseCharge ? 1 : 0, user.username]
  );
  const billId = Number(lastId);
  let sortOrder = 0;
  for (const it of items) {
    await execute(
      `INSERT INTO vendor_bill_items (vendor_bill_id, item_description, hsn_code, qty, uom, rate, amount, gst_rate_pct, sort_order, bom_item_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [billId, it.description, null, it.qty, it.uom, it.rate, it.amount, ratePct, sortOrder++, it.bom_item_id ?? null]
    );
  }
  await audit('vendor_bill_recorded', { actor: user.username, detail: `${b.bill_no} against ${po.po_no}` });
  return NextResponse.json({ id: billId, bill_no: b.bill_no });
}
