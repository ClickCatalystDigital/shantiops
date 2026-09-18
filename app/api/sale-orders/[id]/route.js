// app/api/sale-orders/[id]/route.js — V3_CHANGES.md §12 Phase 2e. sale_orders previously had no
// [id] route at all (list + create only). Adds detail (with items) + status PATCH.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, canAccessDepartment, isPM } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getSaleOrderDetail } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

const STATUSES = ['open', 'fulfilled', 'cancelled'];
const TRACK_STATUSES = ['Pending', 'Ready', 'WIP', 'Dispatched', 'Closed'];

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const detail = await getSaleOrderDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
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
  for (const [body, col] of [['invoice_ref', 'invoice_ref'], ['sales_person', 'sales_person_override']]) {
    if (b[body] !== undefined) { fields.push(`${col} = ?`); args.push(String(b[body]).trim() || null); }
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
  // Payment Tracker milestone checkboxes (Advance … Cleared Issue) — plain 0/1 flags.
  for (const key of ['advance', 'dispatched', 'site_completed', 'commissioning', 'pending_issue', 'cleared_issue']) {
    if (b[`stage_${key}`] !== undefined) { fields.push(`stage_${key} = ?`); args.push(b[`stage_${key}`] ? 1 : 0); }
  }
  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  args.push(params.id);
  await execute(`UPDATE sale_orders SET ${fields.join(', ')} WHERE id = ?`, args);
  return NextResponse.json({ ok: true });
}
