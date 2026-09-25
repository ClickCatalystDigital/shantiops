// app/api/leads/[id]/route.js — V3_CHANGES.md §12. Plain field-level PATCH, same shape as
// app/api/opportunities/[id]/route.js.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { setLeadStage, resolveProductLines, writeLeadProducts } from '@/lib/crm';

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
  for (const [key, col] of [
    ['lead_name', 'lead_name'], ['company_name', 'company_name'], ['phone', 'phone'],
    ['email', 'email'], ['source', 'source'], ['notes', 'notes'], ['campaign_id', 'campaign_id'],
    ['territory', 'territory'], ['industry', 'industry'], ['next_contact_date', 'next_contact_date'],
    ['assigned_to', 'assigned_to'],
    // Phase 2.1/3.1 — the PO wizard's Step 1, and Close Sales Call/Order Lost.
    // product_id is not here: products change only through `products` (plan 1e), which keeps
    // lead_products and the mirrored leads.product_id in step.
    ['lost_reason', 'lost_reason'], ['branch_id', 'branch_id'],
    ['expected_order_date', 'expected_order_date'], ['week_number', 'week_number'],
  ]) {
    if (b[key] !== undefined) { fields.push(`${col} = ?`); args.push(b[key] || null); }
  }
  // The funnel stage is the only status (docs/sales-crm-plan.md 1a): leads.status is derived from
  // it by setLeadStage() and can no longer be set by hand, so a direct `status` is refused.
  if (b.status !== undefined) {
    return NextResponse.json({ error: 'Status follows the funnel stage — set sales_call_status instead' }, { status: 400 });
  }
  const stageChange = b.sales_call_status !== undefined;
  // Plan 1e — the whole product-line list, validated before anything is written.
  let productLines = null;
  if (b.products !== undefined) {
    try { productLines = await resolveProductLines(b.products); }
    catch (err) { return NextResponse.json({ error: err.message }, { status: err.status || 500 }); }
  }
  const productsChange = productLines !== null;
  if (b.is_vip !== undefined) { fields.push('is_vip = ?'); args.push(b.is_vip ? 1 : 0); }
  // The enquiry's own deal value (plan 1b — was the Opportunity's value_num).
  if (b.expected_value !== undefined) {
    const v = b.expected_value === '' || b.expected_value == null ? null : Number(b.expected_value);
    if (v != null && !(Number.isFinite(v) && v >= 0)) return NextResponse.json({ error: 'Expected value must be a positive number' }, { status: 400 });
    fields.push('expected_value = ?'); args.push(v);
  }
  // Order Lost (Phase 3.1) explicitly sets these two together — an intentional close, not an
  // implicit reopen-clear below.
  if (b.sales_call_closed_at !== undefined) {
    fields.push('sales_call_closed_at = ?', 'sales_call_closed_by = ?');
    args.push(b.sales_call_closed_at || null, b.sales_call_closed_at ? user.username : null);
  } else if (fields.length || stageChange || productsChange) {
    // Real activity happening again is itself the signal a "closed" lead is no longer actually
    // closed (Gap #30) — any other edit implicitly clears the closed banner, no "Reopen" button.
    fields.push('sales_call_closed_at = NULL', 'sales_call_closed_by = NULL');
  }
  if (!fields.length && !stageChange && !productsChange) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  // Validate the stage before writing anything, so a bad stage never half-applies the other fields.
  if (stageChange) {
    const known = await queryOne('SELECT 1 FROM sales_stages WHERE name = ? AND active = 1', [b.sales_call_status || 'Lead - Cold']);
    if (!known) return NextResponse.json({ error: `Unknown stage "${b.sales_call_status}"` }, { status: 400 });
  }
  if (fields.length || productsChange) {
    fields.push('updated_at = CURRENT_TIMESTAMP');
    args.push(params.id);
    await execute(`UPDATE leads SET ${fields.join(', ')} WHERE id = ?`, args);
  }
  if (productsChange) {
    await writeLeadProducts(params.id, productLines, { setExpectedValue: b.expected_value === undefined });
  }
  let stage = null;
  if (stageChange) stage = await setLeadStage(params.id, b.sales_call_status, user.username);
  await audit('lead_updated', {
    actor: user.username,
    detail: `#${params.id}${stage?.changed ? ` stage ${stage.from || '—'} -> ${stage.to}` : ''}${productsChange ? ` products ${productLines.length}` : ''}`,
  });
  return NextResponse.json({ ok: true });
}
