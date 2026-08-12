// app/api/crm-saved-views/route.js — Frappe CRM parity: Saved View / Pinned View. Scoped to the
// requesting user (their own saved filters, not a shared team list — same personal-scope model
// Frappe CRM's own saved views use). GET lists this user's views for an entity; POST creates one.
import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getSessionUser, isInternal } from '@/lib/auth';

export async function GET(req) {
  const user = getSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const entity = new URL(req.url).searchParams.get('entity') || 'leads';
  const rows = await queryAll(
    'SELECT * FROM crm_saved_views WHERE user = ? AND entity = ? ORDER BY pinned DESC, created_at DESC',
    [user.username, entity]
  );
  return NextResponse.json(rows.map(r => ({ ...r, filters: JSON.parse(r.filters || '{}') })));
}

export async function POST(req) {
  const user = getSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'View name is required' }, { status: 400 });
  const entity = b.entity || 'leads';
  const { lastId } = await execute(
    'INSERT INTO crm_saved_views (user, entity, name, filters, pinned) VALUES (?, ?, ?, ?, ?)',
    [user.username, entity, name, JSON.stringify(b.filters || {}), b.pinned ? 1 : 0]
  );
  return NextResponse.json({ id: Number(lastId) });
}
