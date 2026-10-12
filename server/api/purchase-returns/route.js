// app/api/purchase-returns/route.js — STERP "Purchase Returns" (SYSTEM.md §5o), the Procurement-
// side mirror of app/api/sales-returns/route.js. Same gating shape.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, isInternal } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getPurchaseReturns } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await getPurchaseReturns());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Procurement', 'procurement.return.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const description = String(b.item_description || '').trim();
  if (!b.po_id) return NextResponse.json({ error: 'Purchase Order is required' }, { status: 400 });
  if (!description) return NextResponse.json({ error: 'Item description is required' }, { status: 400 });
  const qty = Number(b.qty);
  if (!(qty > 0)) return NextResponse.json({ error: 'Quantity must be a positive number' }, { status: 400 });

  const po = await queryOne('SELECT id FROM purchase_orders WHERE id = ?', [b.po_id]);
  if (!po) return NextResponse.json({ error: 'Purchase Order not found' }, { status: 404 });

  const { lastId } = await execute(
    `INSERT INTO purchase_returns (po_id, po_item_id, item_description, qty, reason, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [b.po_id, b.po_item_id || null, description, qty, b.reason || null, user.username]
  );
  await audit('purchase_return_created', { actor: user.username, detail: `PO ${b.po_id}: ${description}` });
  return NextResponse.json({ id: Number(lastId) });
}
