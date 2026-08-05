// Pick (or revert) the winning quote for a BOM line — a structured action, not a generic field
// edit, so it goes through its own endpoint rather than the BOM_FIELD_OWNERS-gated PATCH
// /api/bom-items/[id]. Reverting only clears the pointer; supplier_quotes history is untouched.
//
// Also drives the Selection tab's auto-draft PO (§4.2): picking a quote adds this item to (or
// starts) that supplier's one open draft PO; reverting pulls it back out. lib/procurement.js owns
// the actual PO bookkeeping so both directions stay in one place.
//
// V2-CHANGES.md D2 (Phase 5.0): this is also where supplier_quotes.is_selected (tri-state — null
// undecided, 1 winner, 0 rejected sibling) gets set — the training-signal column for a later
// "learning mode." Quotes themselves stay append-only/immutable; only this outcome flag moves.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getSessionUser, requireDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { selectQuoteForItem, removeItemFromDraftPO } from '@/lib/procurement';

export async function POST(req, { params }) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;

  const b = await req.json();
  let result;
  try {
    result = await selectQuoteForItem(params.id, b.quote_id);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.message === 'Item not found' ? 404 : 400 });
  }
  await audit('supplier_selected', { actor: user.username, detail: `item ${params.id}: quote ${result.quote.id}` });
  return NextResponse.json({ ok: true, po_id: result.poId });
}

export async function DELETE(req, { params }) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;

  const item = await queryOne('SELECT id FROM bom_items WHERE id = ?', [params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await execute('UPDATE bom_items SET selected_quote_id = NULL WHERE id = ?', [params.id]);
  // D2: undo means undecided again — reset every quote on this item, not just the former winner.
  await execute('UPDATE supplier_quotes SET is_selected = NULL WHERE bom_item_id = ?', [params.id]);
  await removeItemFromDraftPO(item.id);
  await audit('supplier_selection_reverted', { actor: user.username, detail: `item ${params.id}` });
  return NextResponse.json({ ok: true });
}
