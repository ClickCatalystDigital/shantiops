// app/api/scope-of-supply/[id]/route.js — PATCH covers editing the document header (title, the
// commercial refs/terms the printable version needs) and releasing it (draft -> released), same
// field-level shape as app/api/opportunities/[id]/route.js.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';

const TEXT_FIELDS = ['po_no', 'payment_terms', 'freight_terms', 'delivery_terms', 'prepared_by'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Design') && !canAccessDepartment(user, 'Engineering')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const existing = await queryOne('SELECT id FROM scope_of_supply WHERE id = ?', [params.id]);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const fields = [];
  const args = [];
  if (b.title !== undefined) { fields.push('title = ?'); args.push(String(b.title).trim()); }
  for (const f of TEXT_FIELDS) {
    if (b[f] !== undefined) { fields.push(`${f} = ?`); args.push(b[f] || null); }
  }
  if (b.po_date !== undefined) { fields.push('po_date = ?'); args.push(b.po_date || null); }
  if (b.tax_pct !== undefined) { fields.push('tax_pct = ?'); args.push(Number(b.tax_pct) || 0); }
  if (b.status !== undefined) {
    if (!['draft', 'released'].includes(b.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    fields.push('status = ?'); args.push(b.status);
  }
  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  fields.push('updated_at = CURRENT_TIMESTAMP');
  args.push(params.id);
  await execute(`UPDATE scope_of_supply SET ${fields.join(', ')} WHERE id = ?`, args);
  return NextResponse.json({ ok: true });
}
