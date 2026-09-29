// Valve-to-flange style checklist on a packing list: free rows with Prod/QC/Stores tick boxes.
import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';

const TICKS = ['prod_ok', 'qc_ok', 'stores_ok'];

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.edit');
  if (actionDenied) return actionDenied;
  const { description } = await req.json();
  if (!description?.trim()) return NextResponse.json({ error: 'Description is required' }, { status: 400 });
  const r = await execute('INSERT INTO packing_checklist_items (packing_list_id, description) VALUES (?, ?)', [params.id, description.trim()]);
  return NextResponse.json({ id: Number(r.lastId) });
}

// Tick/untick one box, or rename. Ticks are open to Dispatch, QC, Production and Stores (own column).
export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  if (!user || !['Dispatch', 'QC', 'Production', 'Stores'].some(d => canAccessDepartment(user, d))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  const id = Number(b.itemId);
  const sets = [], vals = [];
  for (const k of TICKS) if (k in b) { sets.push(`${k} = ?`); vals.push(b[k] ? 1 : 0); }
  if ('description' in b && b.description?.trim()) { sets.push('description = ?'); vals.push(b.description.trim()); }
  if (!id || !sets.length) return NextResponse.json({ error: 'itemId and a field required' }, { status: 400 });
  await execute(`UPDATE packing_checklist_items SET ${sets.join(', ')} WHERE id = ? AND packing_list_id = ?`, [...vals, id, params.id]);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const id = Number(new URL(req.url).searchParams.get('itemId'));
  if (!id) return NextResponse.json({ error: 'itemId required' }, { status: 400 });
  await execute('DELETE FROM packing_checklist_items WHERE id = ? AND packing_list_id = ?', [id, params.id]);
  return NextResponse.json({ ok: true });
}
