// app/api/competitors/[id]/route.js — remove a competitor entry (Sales; a member only their own).
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { salesScope } from '@/lib/sales-visibility';
import { audit } from '@/lib/usb';

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  if (!(isPM(user) || canAccessDepartment(user, 'Sales'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const row = await queryOne('SELECT id, competitor, created_by FROM customer_competitors WHERE id = ?', [params.id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const me = salesScope(user);
  if (me && row.created_by !== me) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await execute('DELETE FROM customer_competitors WHERE id = ?', [params.id]);
  await audit('competitor_removed', { actor: user.username, detail: `#${row.id} ${row.competitor}` });
  return NextResponse.json({ ok: true });
}
