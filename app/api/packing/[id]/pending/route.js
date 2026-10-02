// app/api/packing/[id]/pending/route.js — this list's project's still-pending BOM lines (ready and
// waiting), for the "Add item" dialog on a packing list. Read-only; same set Dispatch's Pending tab shows.
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getPendingPackingItems } from '@/lib/data';

export async function GET(req, { params }) {
  const denied = requireDepartment(await getFreshSessionUser(), 'Dispatch');
  if (denied) return denied;
  const pl = await queryOne('SELECT project_id FROM packing_lists WHERE id = ?', [params.id]);
  if (!pl) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!pl.project_id) return NextResponse.json([]);
  const all = await getPendingPackingItems();
  return NextResponse.json(all.filter(it => it.project_id === pl.project_id));
}
