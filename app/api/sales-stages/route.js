// app/api/sales-stages/route.js — V3_CHANGES.md §12 decision 5. DB-configurable pipeline stages,
// PM-only to manage (same "template manager" precedent as Workflow Stages, SYSTEM.md §3c).
import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getFreshSessionUser, isInternal, requirePM } from '@/lib/auth';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await queryAll('SELECT * FROM sales_stages ORDER BY sort_order'));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requirePM(user);
  if (denied) return denied;

  const b = await req.json();
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  const maxSort = await queryAll('SELECT MAX(sort_order) AS m FROM sales_stages');
  const sortOrder = (maxSort[0]?.m ?? -1) + 1;

  const { lastId } = await execute(
    'INSERT INTO sales_stages (name, sort_order, is_won, is_lost) VALUES (?, ?, ?, ?)',
    [name, sortOrder, b.is_won ? 1 : 0, b.is_lost ? 1 : 0]
  );
  return NextResponse.json({ id: Number(lastId) });
}
