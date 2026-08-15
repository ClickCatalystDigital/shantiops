// app/api/crm-saved-views/[id]/route.js — pin toggle + delete, both restricted to the view's own
// owner (personal saved filters, same boundary as the create route).
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const existing = await queryOne('SELECT * FROM crm_saved_views WHERE id = ?', [params.id]);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.user !== user.username) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  if (b.pinned === undefined) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  await execute('UPDATE crm_saved_views SET pinned = ? WHERE id = ?', [b.pinned ? 1 : 0, params.id]);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const existing = await queryOne('SELECT * FROM crm_saved_views WHERE id = ?', [params.id]);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.user !== user.username) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  await execute('DELETE FROM crm_saved_views WHERE id = ?', [params.id]);
  return NextResponse.json({ ok: true });
}
