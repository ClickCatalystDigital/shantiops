// app/api/sale-orders/[id]/route.js — V3_CHANGES.md §12 Phase 2e. sale_orders previously had no
// [id] route at all (list + create only). Adds detail (with items) + status PATCH.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, canAccessDepartment, isPM } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getSaleOrderDetail } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

const STATUSES = ['open', 'fulfilled', 'cancelled'];

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
  for (const key of ['status', 'description', 'company']) {
    if (b[key] !== undefined) { fields.push(`${key} = ?`); args.push(b[key]); }
  }
  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  args.push(params.id);
  await execute(`UPDATE sale_orders SET ${fields.join(', ')} WHERE id = ?`, args);
  return NextResponse.json({ ok: true });
}
