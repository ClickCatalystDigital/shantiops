// app/api/leads/[id]/route.js — V3_CHANGES.md §12. Plain field-level PATCH, same shape as
// app/api/opportunities/[id]/route.js.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  if (!CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const existing = await queryOne('SELECT * FROM leads WHERE id = ?', [params.id]);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canAccessDepartment(user, existing.owner_dept)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const b = await req.json();
  const fields = [];
  const args = [];
  const STATUSES = ['new', 'contacted', 'qualified', 'converted', 'lost'];
  for (const [key, col] of [
    ['lead_name', 'lead_name'], ['company_name', 'company_name'], ['phone', 'phone'],
    ['email', 'email'], ['source', 'source'], ['notes', 'notes'], ['campaign_id', 'campaign_id'],
    ['territory', 'territory'], ['industry', 'industry'], ['next_contact_date', 'next_contact_date'],
    ['assigned_to', 'assigned_to'],
    // Phase 2.1/3.1 — the PO wizard's Step 1, and Close Sales Call/Order Lost.
    ['lost_reason', 'lost_reason'], ['branch_id', 'branch_id'], ['product_id', 'product_id'],
    ['expected_order_date', 'expected_order_date'], ['week_number', 'week_number'],
  ]) {
    if (b[key] !== undefined) { fields.push(`${col} = ?`); args.push(b[key] || null); }
  }
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    fields.push('status = ?'); args.push(b.status);
  }
  if (b.sales_call_status !== undefined) {
    fields.push('sales_call_status = ?'); args.push(b.sales_call_status || null);
  }
  if (b.is_vip !== undefined) { fields.push('is_vip = ?'); args.push(b.is_vip ? 1 : 0); }
  // Order Lost (Phase 3.1) explicitly sets these two together — an intentional close, not an
  // implicit reopen-clear below.
  if (b.sales_call_closed_at !== undefined) {
    fields.push('sales_call_closed_at = ?', 'sales_call_closed_by = ?');
    args.push(b.sales_call_closed_at || null, b.sales_call_closed_at ? user.username : null);
  } else if (fields.length) {
    // Real activity happening again is itself the signal a "closed" lead is no longer actually
    // closed (Gap #30) — any other edit implicitly clears the closed banner, no "Reopen" button.
    fields.push('sales_call_closed_at = NULL', 'sales_call_closed_by = NULL');
  }
  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  fields.push('updated_at = CURRENT_TIMESTAMP');
  args.push(params.id);
  await execute(`UPDATE leads SET ${fields.join(', ')} WHERE id = ?`, args);
  await audit('lead_updated', { actor: user.username, detail: `#${params.id}` });
  return NextResponse.json({ ok: true });
}
