// Welding rods, gas, discs — consumed doing the work, never a BOM line item (§3.1).
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Production');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Production', 'production.jobcard.consumable');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const itemName = String(b.item_name || '').trim();
  if (!itemName) return NextResponse.json({ error: 'Item name is required' }, { status: 400 });

  const { lastId } = await execute(
    `INSERT INTO job_card_consumables (job_card_id, item_name, qty, unit, created_by) VALUES (?, ?, ?, ?, ?)`,
    [params.id, itemName, b.qty ? Number(b.qty) : null, String(b.unit || '').trim() || null, user.username]
  );
  return NextResponse.json({ id: Number(lastId) });
}
