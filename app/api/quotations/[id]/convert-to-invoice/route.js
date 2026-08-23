// app/api/quotations/[id]/convert-to-invoice/route.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 2.
// Same "accept -> auto-create the next record" playbook as convert/route.js's Quotation -> Sale
// Order, one step further: Quotation -> Sales Invoice. Tax split (CGST+SGST vs IGST) is the one
// real calc in this phase — lib/gst-calc.mjs, not inline here.
import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne, nextCounterValue } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { requireCrmAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { notifyDepartment, notifyPMs } from '@/lib/notify';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';
import { financialYear, gstSplit } from '@/lib/gst-calc.mjs';
import { todayISO } from '@/lib/date';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return isPM(user) || CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const actionDenied = await requireCrmAction(user, 'sales.invoice.create');
  if (actionDenied) return actionDenied;

  const quotation = await queryOne(
    `SELECT q.*, c.name AS customer_name, c.state_code AS customer_state_code FROM quotations q JOIN customers c ON c.id = q.customer_id WHERE q.id = ?`,
    [params.id]
  );
  if (!quotation) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (quotation.status !== 'accepted') {
    return NextResponse.json({ error: 'Only an accepted quotation can be converted' }, { status: 409 });
  }
  const items = await queryAll('SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY sort_order', [params.id]);

  const b = await req.json().catch(() => ({}));
  const company = COMPANY_NAMES.includes(b.company) ? b.company : COMPANY_NAMES[0];
  const companyRow = await queryOne('SELECT * FROM company_settings WHERE company = ?', [company]);
  const saleOrder = await queryOne('SELECT id FROM sale_orders WHERE quotation_id = ?', [params.id]);
  // The project this invoice belongs to, if one exists yet — via the same sale_order_id link
  // projects.sale_order_id already carries (§7). Found missing while live-testing the Customer
  // Portal's new invoice list (§6): without this, every invoice silently had project_id NULL and
  // never showed up for the customer who owns that exact order.
  const project = saleOrder ? await queryOne('SELECT id FROM projects WHERE sale_order_id = ?', [saleOrder.id]) : null;

  const invoiceDate = b.invoice_date || todayISO();
  const fy = financialYear(invoiceDate);
  const seq = await nextCounterValue(`invoice_no:${company}:${fy}`, 0);
  const invoiceNo = `${companyRow?.invoice_prefix || 'INV'}/${seq}/${fy}`;

  const split = gstSplit({
    taxableAmount: quotation.subtotal,
    ratePct: quotation.tax_pct,
    companyStateCode: companyRow?.state_code,
    customerStateCode: quotation.customer_state_code,
  });
  // Reverse charge: the customer self-assesses GST entirely, so nothing is charged to them for it —
  // the invoice total is just the taxable value (lib/ledger.mjs's salesInvoiceLines() posts nothing
  // to GST Output Payable in this case either).
  const isReverseCharge = !!b.is_reverse_charge;
  const total = isReverseCharge ? quotation.subtotal : quotation.subtotal + split.taxAmount;

  const { lastId } = await execute(
    `INSERT INTO sales_invoices
       (invoice_no, company, customer_id, sale_order_id, quotation_id, project_id, invoice_date, due_date,
        subtotal, cgst_amount, sgst_amount, igst_amount, tax_amount, total, is_reverse_charge, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [invoiceNo, company, quotation.customer_id, saleOrder?.id ?? null, quotation.id, project?.id ?? null, invoiceDate, b.due_date ?? null,
      quotation.subtotal, split.cgst, split.sgst, split.igst, split.taxAmount, total, isReverseCharge ? 1 : 0, user.username]
  );
  const invoiceId = Number(lastId);
  let sortOrder = 0;
  for (const it of items) {
    await execute(
      `INSERT INTO sales_invoice_items (sales_invoice_id, item_description, hsn_code, qty, uom, rate, amount, gst_rate_pct, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [invoiceId, it.item_description, it.hsn_code, it.qty, it.uom, it.rate, it.amount, quotation.tax_pct, sortOrder++]
    );
  }
  await audit('quotation_converted_to_invoice', { actor: user.username, detail: `${quotation.quotation_no} -> ${invoiceNo}` });
  try {
    const note = { kind: 'sales_invoice_created', title: `New Sales Invoice: ${invoiceNo}`, body: quotation.customer_name || null, dedupe_key: `invoice_created:${invoiceId}` };
    await notifyDepartment('Accounts', note);
    await notifyPMs(note, { except: user.id });
  } catch (err) { /* notification is best-effort */ }
  return NextResponse.json({ id: invoiceId, invoice_no: invoiceNo });
}
