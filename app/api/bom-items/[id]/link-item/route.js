import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

// Dedicated endpoint, deliberately not routed through the generic PATCH (app/api/bom-items/[id]/
// route.js) or BOM_FIELD_OWNERS — that machinery treats every field as opaque string/trim with no
// FK check, which would silently write a string into this INTEGER FK and skip the history guard
// below. Closes the real gap: bulk BOM import auto-links item_id on an exact name match (bom/import/
// route.js), but a line that misses it has no edit path anywhere today.
export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Engineering');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Engineering', 'engineering.bom.link_item');
  if (actionDenied) return actionDenied;

  const bomItem = await queryOne('SELECT id, item_id FROM bom_items WHERE id = ?', [params.id]);
  if (!bomItem) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const newItemId = b.item_id == null ? null : Number(b.item_id);
  if (newItemId != null) {
    const catalogItem = await queryOne('SELECT id FROM items WHERE id = ?', [newItemId]);
    if (!catalogItem) return NextResponse.json({ error: 'Catalog item not found' }, { status: 404 });
  }

  // Guard applies to ANY real change, including the first-ever link — not just re-linking an
  // already-linked row. Confirmed live (2026-08-24): a bom_item can carry real vendor_bill_items/
  // material_issues history while item_id is still NULL (receiving/issuing doesn't depend on catalog
  // linking), so "first link is always safe/corrective" was a false assumption — that history is
  // currently unattributed, not wrong, and a bad first guess would make it confidently wrong instead
  // of honestly blank. Where-Used/Inventory Aging/Stock Ledger all resolve item_id live against that
  // history regardless of what it changed from.
  if (bomItem.item_id !== newItemId) {
    const hasBill = await queryOne('SELECT 1 FROM vendor_bill_items WHERE bom_item_id = ?', [params.id]);
    const hasIssue = await queryOne('SELECT 1 FROM material_issues WHERE bom_item_id = ?', [params.id]);
    if (hasBill || hasIssue) {
      return NextResponse.json(
        { error: 'This line has receipt/issue history — changing its catalog link would rewrite historical reports' },
        { status: 409 });
    }
  }

  await execute('UPDATE bom_items SET item_id = ? WHERE id = ?', [newItemId, params.id]);

  await audit('bom_item_link_item', {
    actor: user.username,
    detail: JSON.stringify({ bom_item_id: Number(params.id), old_item_id: bomItem.item_id, new_item_id: newItemId }),
  });
  return NextResponse.json({ ok: true });
}
