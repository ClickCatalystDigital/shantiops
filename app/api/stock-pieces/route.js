// app/api/stock-pieces/route.js — Cutting & Remnant Management. Stores receives a plate/section as
// a physical piece (not a plain on_hand bump); GET lists a line's pieces for the Inventory tab's
// expanded view and Production's Cut picker.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, isInternal, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { receivePiece, listPieces } from '@/lib/stock-pieces';
import { audit } from '@/lib/usb';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const params = new URL(req.url).searchParams;
  const inventoryItemId = params.get('inventory_item_id');
  const bomItemId = params.get('bom_item_id');
  if (!inventoryItemId && !bomItemId) {
    return NextResponse.json({ error: 'inventory_item_id or bom_item_id is required' }, { status: 400 });
  }
  return NextResponse.json(await listPieces({
    inventoryItemId: inventoryItemId ? Number(inventoryItemId) : null,
    bomItemId: bomItemId ? Number(bomItemId) : null,
  }));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Stores', 'stores.inventory.write');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  if (!b.inventory_item_id || !b.kind) {
    return NextResponse.json({ error: 'inventory_item_id and kind are required' }, { status: 400 });
  }
  try {
    const result = await receivePiece({
      inventoryItemId: Number(b.inventory_item_id), kind: b.kind,
      length_mm: b.length_mm, width_mm: b.width_mm, thickness_mm: b.thickness_mm,
      density: b.density, kg_per_m: b.kg_per_m, heat_no: b.heat_no, test_certificate_id: b.test_certificate_id,
      bomItemId: b.bom_item_id ? Number(b.bom_item_id) : undefined,
      username: user.username,
    });
    await audit('stock_piece_received', { actor: user.username, detail: `${result.code} · ${result.weight_kg} kg` });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
