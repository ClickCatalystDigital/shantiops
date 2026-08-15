// app/api/scope-of-supply/[id]/route.js — PATCH covers editing the spec and releasing it
// (draft -> released), same field-level shape as app/api/opportunities/[id]/route.js.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';

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
  if (b.spec !== undefined) { fields.push('spec = ?'); args.push(b.spec || null); }
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
