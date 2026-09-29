// app/api/sales-invoices/route.js — list, and create a draft invoice directly (Invoices tab → Add
// Sales Invoice: for a sale that never had a quotation, e.g. spares or an imported order). The
// quotation route (app/api/quotations/[id]/convert-to-invoice) stays the main path; both use the same
// numbering, per-line GST split and reverse-charge rule.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { getSalesInvoices } from '@/lib/data';
import { scopeRows } from '@/lib/sales-visibility';
import { execute, queryOne, nextCounterValue } from '@/lib/db';
import { requireCrmAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { notifyDepartment, notifyPMs } from '@/lib/notify';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';
import { financialYear } from '@/lib/gst-calc.mjs';
import { quotationTotals } from '@/lib/sales-lines.mjs';
import { todayISO } from '@/lib/date';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return isPM(user) || CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  // Dispatch reads this too now — the packing-list sales_invoice_id picker (Dispatch accounting
  // integration, 2026-08-23) needs to list a project's invoices to link a shipment against.
  if (!canAccessCrm(user) && !canAccessDepartment(user, 'Accounts') && !canAccessDepartment(user, 'Dispatch')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const projectId = new URL(req.url).searchParams.get('project_id');
  const rows = await getSalesInvoices({ projectId: projectId ? Number(projectId) : undefined });
  return NextResponse.json(await scopeRows(user, 'invoices', rows)); // plan 2a
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const actionDenied = await requireCrmAction(user, 'sales.invoice.create');
  if (actionDenied) return actionDenied;
  const b = await req.json();

  const customer = b.customer_id ? await queryOne('SELECT id, name, state_code FROM customers WHERE id = ?', [b.customer_id]) : null;
  if (!customer) return NextResponse.json({ error: 'Pick a customer' }, { status: 400 });
  const company = COMPANY_NAMES.includes(b.company) ? b.company : COMPANY_NAMES[0];
  const invoiceDate = b.invoice_date || todayISO();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) || (b.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(b.due_date))) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }
  const raw = Array.isArray(b.items) ? b.items.filter(it => String(it.item_description || '').trim()) : [];
  if (!raw.length) return NextResponse.json({ error: 'At least one line item is required' }, { status: 400 });
  for (const it of raw) {
    for (const [label, v] of [['Qty', it.qty], ['Rate', it.rate], ['GST %', it.gst_pct]]) {
      if (v !== '' && v != null && !(Number(v) >= 0)) return NextResponse.json({ error: `${label} must be a number ≥ 0` }, { status: 400 });
    }
  }
  const saleOrder = b.sale_order_id ? await queryOne('SELECT id, customer_id FROM sale_orders WHERE id = ?', [b.sale_order_id]) : null;
  if (b.sale_order_id && !saleOrder) return NextResponse.json({ error: 'Sale Order not found' }, { status: 400 });
  const project = saleOrder ? await queryOne('SELECT id FROM projects WHERE sale_order_id = ?', [saleOrder.id]) : null;

  const companyRow = await queryOne('SELECT * FROM company_settings WHERE company = ?', [company]);
  const t = quotationTotals(raw.map(it => ({
    item_description: String(it.item_description).trim(), hsn_code: it.hsn_code ? String(it.hsn_code).trim() : null,
    qty: it.qty === '' || it.qty == null ? 1 : Number(it.qty), uom: it.uom || null, rate: Number(it.rate) || 0,
    gst_pct: it.gst_pct === '' ? null : it.gst_pct, discount_pct: it.discount_pct || 0,
  })), { companyStateCode: companyRow?.state_code || null, customerStateCode: customer.state_code || null, fallbackGstPct: 18 });
  const isReverseCharge = !!b.is_reverse_charge;
  const total = isReverseCharge ? t.subtotal : t.subtotal + t.taxAmount;

  const fy = financialYear(invoiceDate);
  const seq = await nextCounterValue(`invoice_no:${company}:${fy}`, 0);
  const invoiceNo = `${companyRow?.invoice_prefix || 'INV'}/${seq}/${fy}`;
  const { lastId } = await execute(
    `INSERT INTO sales_invoices
       (invoice_no, company, customer_id, sale_order_id, project_id, invoice_date, due_date, notes,
        subtotal, cgst_amount, sgst_amount, igst_amount, tax_amount, total, is_reverse_charge, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [invoiceNo, company, customer.id, saleOrder?.id ?? null, project?.id ?? null, invoiceDate, b.due_date || null, String(b.notes || '').trim() || null,
      t.subtotal, t.cgst, t.sgst, t.igst, t.taxAmount, total, isReverseCharge ? 1 : 0, user.username]);
  const invoiceId = Number(lastId);
  let sort = 0;
  for (const it of t.lines) {
    await execute(
      `INSERT INTO sales_invoice_items (sales_invoice_id, item_description, hsn_code, qty, uom, rate, amount, gst_rate_pct, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [invoiceId, it.item_description, it.hsn_code, it.qty, it.uom, it.rate, it.amount, it.gst_pct, sort++]);
  }
  await audit('sales_invoice_created', { actor: user.username, detail: `${invoiceNo} (manual)` });
  try {
    const note = { kind: 'sales_invoice_created', title: `New Sales Invoice: ${invoiceNo}`, body: customer.name, dedupe_key: `invoice_created:${invoiceId}` };
    await notifyDepartment('Accounts', note);
    await notifyPMs(note, { except: user.id });
  } catch { /* best-effort */ }
  return NextResponse.json({ id: invoiceId, invoice_no: invoiceNo });
}
