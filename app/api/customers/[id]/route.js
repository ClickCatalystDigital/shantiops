import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, isInternal, canAccessDepartment, isPM, isDepartmentHead } from '@/lib/auth';
import { requireCrmAction } from '@/lib/action-permissions';
import { getCustomerDetail } from '@/lib/data';
import { audit } from '@/lib/usb';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return isPM(user) || CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const detail = await getCustomerDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  // Sibling POST /api/customers already gates on this key — the edit/deactivate path (2026-09-23
  // isolation fix) didn't, so it stayed open to Marketing even after requireCrmAction's own fix.
  const actionDenied = await requireCrmAction(user, 'sales.customer.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const fields = [];
  const args = [];
  for (const key of ['name', 'gst_no', 'pan', 'website', 'phone', 'email', 'address', 'city', 'state', 'state_code', 'pin_code', 'active',
    'service_tax_no', 'vat_no', 'registration_no', 'ecc_no', 'nature_of_business', 'product_line', 'sells_via', 'turnover_band']) {
    if (b[key] === undefined) continue;
    const v = b[key] === '' ? null : b[key];
    if (key === 'name' && !String(v || '').trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    fields.push(`${key} = ?`); args.push(['gst_no', 'pan'].includes(key) && v ? String(v).trim().toUpperCase() : v);
  }
  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  args.push(params.id);
  await execute(`UPDATE customers SET ${fields.join(', ')} WHERE id = ?`, args);

  // A deactivated customer must not keep live portal access — mirror the flag onto their linked
  // login (and restore it symmetrically on reactivation, same assumption). Deliberately not
  // touching portal_enabled/email prefs, only whether the account can log in at all.
  if (b.active !== undefined) {
    const customer = await queryOne('SELECT portal_user_id FROM customers WHERE id = ?', [params.id]);
    if (customer?.portal_user_id) {
      await execute('UPDATE users SET active = ? WHERE id = ?', [b.active ? 1 : 0, customer.portal_user_id]);
    }
  }

  await audit(b.active === 0 ? 'customer_deactivated' : 'customer_updated', { actor: user.username, detail: `#${params.id}` });
  return NextResponse.json({ ok: true });
}

// Head-only, hard delete — refuses anything with real business activity (a duplicate/test row with
// zero history is what this is actually for; a real customer with history should be deactivated via
// PATCH {active:0} instead, which also disables their portal login). crm_notes/contacts/addresses/
// customer_competitors cascade on their own; every other real link blocks the delete outright.
export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isDepartmentHead(user, 'Sales') && !isDepartmentHead(user, 'Marketing')) {
    return NextResponse.json({ error: 'Only a Sales or Marketing head can delete a customer' }, { status: 403 });
  }
  const existing = await queryOne('SELECT id, name FROM customers WHERE id = ?', [params.id]);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const checks = [
    ['projects', 'customer_id', 'project(s)'],
    ['tasks', 'customer_id', 'task(s)'],
    ['sale_orders', 'customer_id', 'sale order(s)'],
    ['opportunities', 'customer_id', 'opportunit(y/ies)'],
    ['leads', 'converted_customer_id', 'enquir(y/ies) converted to this customer'],
    ['quotations', 'customer_id', 'quotation(s)'],
    ['sales_invoices', 'customer_id', 'sales invoice(s)'],
    ['price_lists', 'customer_id', 'price list entr(y/ies)'],
  ];
  const blocks = [];
  for (const [table, col, label] of checks) {
    const r = await queryOne(`SELECT COUNT(*) n FROM ${table} WHERE ${col} = ?`, [params.id]);
    if (r.n > 0) blocks.push(`${r.n} ${label}`);
  }
  if (blocks.length) {
    return NextResponse.json({ error: `Can't delete — this customer has ${blocks.join(', ')} linked. Deactivate it instead (Active toggle).` }, { status: 409 });
  }

  await execute('DELETE FROM customers WHERE id = ?', [params.id]);
  await audit('customer_deleted', { actor: user.username, detail: `#${params.id} ${existing.name}` });
  return NextResponse.json({ ok: true });
}
