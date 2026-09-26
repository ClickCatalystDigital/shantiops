// app/api/sale-orders/[id]/route.js — V3_CHANGES.md §12 Phase 2e. sale_orders previously had no
// [id] route at all (list + create only). Adds detail (with items) + status PATCH.
import { hiddenSalesRecord } from '@/lib/sales-visibility';
import { NextResponse } from 'next/server';
import { checkSalesPerson } from '@/lib/sales-people';
import { execute, queryAll, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, canAccessDepartment, isPM } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getSaleOrderDetail } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';
import { audit } from '@/lib/usb';

const STATUSES = ['open', 'fulfilled', 'cancelled'];
const TRACK_STATUSES = ['Pending', 'Ready', 'WIP', 'Dispatched', 'Closed'];

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const hidden = await hiddenSalesRecord(user, 'sale_order', params.id); // plan 2a: own records only
  if (hidden) return hidden;
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const detail = await getSaleOrderDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // Sales CRM plan 1h — an order with no lines yet suggests its quotation's lines, else its
  // enquiry's products. Only a suggestion: nothing is saved until "Save Items On Order".
  let prefill_items = [];
  if (!detail.items.length) {
    if (detail.quotation_id) {
      prefill_items = await queryAll(
        `SELECT qi.product_id, qi.item_description, qi.hsn_code, qi.qty, qi.uom, qi.rate, qi.discount_pct,
                COALESCE(qi.gst_pct, q.tax_pct) AS item_tax_pct, sp.product_code
           FROM quotation_items qi JOIN quotations q ON q.id = qi.quotation_id
           LEFT JOIN sales_products sp ON sp.id = qi.product_id
          WHERE qi.quotation_id = ? ORDER BY qi.sort_order, qi.id`, [detail.quotation_id]);
    }
    if (!prefill_items.length && detail.lead_id) {
      prefill_items = await queryAll(
        `SELECT lp.product_id, lp.description AS item_description, sp.hsn_code, lp.qty, lp.unit AS uom, lp.rate,
                0 AS discount_pct, COALESCE(lp.gst_pct, sp.gst_pct) AS item_tax_pct, sp.product_code
           FROM lead_products lp LEFT JOIN sales_products sp ON sp.id = lp.product_id
          WHERE lp.lead_id = ? ORDER BY lp.sort_order, lp.id`, [detail.lead_id]);
    }
  }
  return NextResponse.json({ ...detail, prefill_items });
}

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const hidden = await hiddenSalesRecord(user, 'sale_order', params.id); // plan 2a: own records only
  if (hidden) return hidden;
  if (!isPM(user)) {
    const denied = requireDepartment(user, 'Sales');
    if (denied) return denied;
  }
  const actionDenied = await requireAction(user, 'Sales', 'sales.saleorder.status');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  if (b.status !== undefined && !STATUSES.includes(b.status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }
  if (b.company !== undefined && !COMPANY_NAMES.includes(b.company)) {
    return NextResponse.json({ error: 'Invalid company' }, { status: 400 });
  }
  const fields = [];
  const args = [];
  for (const key of ['status', 'description', 'company', 'remarks']) {
    if (b[key] !== undefined) { fields.push(`${key} = ?`); args.push(b[key]); }
  }
  // Payment Tracker inline edits. Blank optional text/date → NULL (falls back to the derived value).
  if (b.track_status !== undefined) {
    if (!TRACK_STATUSES.includes(b.track_status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    fields.push('track_status = ?'); args.push(b.track_status);
  }
  for (const key of ['so_no', 'customer_name']) {
    if (b[key] === undefined) continue;
    const v = String(b[key]).trim();
    if (!v) return NextResponse.json({ error: `${key === 'so_no' ? 'Order ID' : 'Customer name'} can't be blank` }, { status: 400 });
    fields.push(`${key} = ?`); args.push(v);
  }
  if (b.order_date !== undefined) {
    if (b.order_date && !/^\d{4}-\d{2}-\d{2}$/.test(b.order_date)) return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
    fields.push('order_date = ?'); args.push(b.order_date || null);
  }
  if (b.invoice_ref !== undefined) { fields.push('invoice_ref = ?'); args.push(String(b.invoice_ref).trim() || null); }
  if (b.sales_person !== undefined) {
    // Plan 1i — a Sales username; keeping the current value or an already-used legacy name is fine.
    const cur = await queryOne('SELECT sales_person_override FROM sale_orders WHERE id = ?', [params.id]);
    const chk = await checkSalesPerson(b.sales_person, { current: cur?.sales_person_override, allowLegacy: true, label: 'Sales Person' });
    if (chk.error) return NextResponse.json({ error: chk.error }, { status: 400 });
    fields.push('sales_person_override = ?'); args.push(chk.value);
  }
  if (b.total !== undefined) {
    const total = Number(b.total);
    if (!(total >= 0)) return NextResponse.json({ error: 'Order value must be a number' }, { status: 400 });
    // An order with line items derives its total from them (Items & PDF) — editing it here would
    // silently diverge and be overwritten on the next items save.
    const { n } = await queryOne('SELECT COUNT(*) AS n FROM sale_order_items WHERE sale_order_id = ?', [params.id]);
    if (n > 0) return NextResponse.json({ error: 'This order has line items — edit its value via Items & PDF' }, { status: 400 });
    fields.push('total = ?'); args.push(total);
  }
  // Bill Value (Payment Tracker) — typed only while the order has no issued/paid Sales Invoice;
  // once it has one, the invoices are the bill value (lib/order-match.mjs billValueOf).
  if (b.bill_value !== undefined) {
    const v = b.bill_value === '' || b.bill_value == null ? null : Number(b.bill_value);
    if (v !== null && !(v >= 0)) return NextResponse.json({ error: 'Bill value must be a number' }, { status: 400 });
    const { n } = await queryOne("SELECT COUNT(*) AS n FROM sales_invoices WHERE sale_order_id = ? AND status IN ('issued', 'paid')", [params.id]);
    if (n > 0) return NextResponse.json({ error: 'This order has Sales Invoices — its bill value comes from them' }, { status: 400 });
    fields.push('bill_value = ?'); args.push(v);
  }
  // Payment Tracker stage flags (Advance … Cleared Issue) — plain 0/1, set together by the Current Stage dropdown.
  for (const key of ['advance', 'dispatched', 'site_completed', 'commissioning', 'pending_issue', 'cleared_issue']) {
    if (b[`stage_${key}`] !== undefined) { fields.push(`stage_${key} = ?`); args.push(b[`stage_${key}`] ? 1 : 0); }
  }
  // Phase 2 — PO/Sale-Order wizard's own fields. Charges/discount/GST are handled by
  // PUT /api/sale-orders/[id]/items instead (they need to be recomputed together with the line
  // items' own totals), not this generic PATCH.
  for (const key of ['create_as', 'br_order_control_no', 'address_type', 'order_address', 'contact_person',
    'contact_mobile', 'order_stage', 'dispatch_comment', 'installation_comment', 'form_type',
    'expected_payment_mode', 'cheque_dd_no', 'payment_plan']) {
    if (b[key] !== undefined) { fields.push(`${key} = ?`); args.push(b[key] ? String(b[key]).trim() : null); }
  }
  for (const key of ['branch_id', 'contact_id']) {
    if (b[key] !== undefined) { fields.push(`${key} = ?`); args.push(b[key] || null); }
  }
  for (const key of ['expected_delivery_date', 'form_due_on']) {
    if (b[key] !== undefined) { fields.push(`${key} = ?`); args.push(b[key] || null); }
  }
  for (const key of ['advance_with_order', 'against_installation', 'payment_plan_days']) {
    if (b[key] !== undefined) { fields.push(`${key} = ?`); args.push(b[key] === '' || b[key] == null ? null : Number(b[key])); }
  }
  for (const key of ['is_account_clear', 'is_form_applicable']) {
    if (b[key] !== undefined) { fields.push(`${key} = ?`); args.push(b[key] ? 1 : 0); }
  }
  // Sales CRM plan 1h — Order Stage is one of the funnel stages, not free text.
  if (b.order_stage) {
    const st = await queryOne('SELECT 1 FROM sales_stages WHERE name = ? AND active = 1', [String(b.order_stage).trim()]);
    if (!st) return NextResponse.json({ error: `Unknown order stage "${b.order_stage}"` }, { status: 400 });
  }
  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  const before = await queryOne('SELECT * FROM sale_orders WHERE id = ?', [params.id]);
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // Old → new for every column that actually changes, so money-relevant edits leave a trail.
  const changed = fields.map((f, i) => [f.split(' ')[0], args[i]]).filter(([c, v]) => String(before[c] ?? '') !== String(v ?? ''));
  args.push(params.id);
  await execute(`UPDATE sale_orders SET ${fields.join(', ')} WHERE id = ?`, args);
  if (changed.length) {
    await audit('sale_order_edit', { actor: user.username, detail: `${before.so_no}: ${changed.map(([c, v]) => `${c} ${before[c] ?? '—'} → ${v ?? '—'}`).join('; ')}` });
  }
  return NextResponse.json({ ok: true });
}
