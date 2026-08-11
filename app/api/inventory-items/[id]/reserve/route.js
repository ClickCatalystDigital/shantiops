// app/api/inventory-items/[id]/reserve/route.js — V2-CHANGES.md Group 6 Phase 6.3 (D9). Stores
// commits stock against an open request without yet handing it out — see lib/procurement.js's
// reserveFromStock for the exclusivity/split-on-shortfall logic.
import { NextResponse } from 'next/server';
import { getSessionUser, requireDepartment } from '@/lib/auth';
import { reserveFromStock } from '@/lib/procurement';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;

  const b = await req.json();
  if (!b.bom_item_id || !b.qty) {
    return NextResponse.json({ error: 'bom_item_id and qty are required' }, { status: 400 });
  }

  try {
    const result = await reserveFromStock({
      inventoryItemId: Number(params.id), bomItemId: Number(b.bom_item_id), qty: b.qty, username: user.username,
    });
    await audit('inventory_reserved', {
      actor: user.username,
      detail: `inventory ${params.id} -> bom_item ${result.bomItemId}: reserved ${result.reservedQty}${result.shortfall > 0 ? ` (shortfall ${result.shortfall} still procuring)` : ''}`,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
