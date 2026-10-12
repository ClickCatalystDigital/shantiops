// app/api/inventory-items/lookup-code/route.js — smart search backend (2026-08-26). Resolves a
// PL-/LN- piece code, SR- serial code, or IM- catalog code to the one inventory_items row that owns
// it, for StoresWorkspace.jsx's Inventory search fallback (lib/data.js's findInventoryItemIdByCode).
import { NextResponse } from 'next/server';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { findInventoryItemIdByCode } from '@/lib/data';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const code = new URL(req.url).searchParams.get('code');
  const inventoryItemId = await findInventoryItemIdByCode(code);
  return NextResponse.json({ inventory_item_id: inventoryItemId });
}
