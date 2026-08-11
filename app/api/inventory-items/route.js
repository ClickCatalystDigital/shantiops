// app/api/inventory-items/route.js — V2-CHANGES.md Group 6 Phase 6.2 (D8). Stores' inventory
// CRUD. GET is isInternal-gated (Phase 6.4's /pr source picker for 'stock' items needs any
// department to search inventory, same reasoning as /api/sale-orders' GET); writes are Stores-only.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getSessionUser, isInternal, requireDepartment } from '@/lib/auth';
import { getInventoryItems } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function GET() {
  const user = getSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await getInventoryItems());
}

export async function POST(req) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;

  const b = await req.json();
  const description = String(b.description || '').trim();
  if (!description) return NextResponse.json({ error: 'Description is required' }, { status: 400 });

  const { lastId } = await execute(
    `INSERT INTO inventory_items (description, spec, on_hand, location, reorder_point, item_code)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [description, b.spec || null, Number(b.on_hand) || 0, b.location || null,
      b.reorder_point != null && b.reorder_point !== '' ? Number(b.reorder_point) : null, b.item_code || null]
  );
  await audit('inventory_item_created', { actor: user.username, detail: description });
  return NextResponse.json({ id: Number(lastId) });
}
