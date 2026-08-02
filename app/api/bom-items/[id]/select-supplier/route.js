// Pick (or revert) the winning quote for a BOM line — a structured action, not a generic field
// edit, so it goes through its own endpoint rather than the BOM_FIELD_OWNERS-gated PATCH
// /api/bom-items/[id]. Reverting only clears the pointer; supplier_quotes history is untouched.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getSessionUser, requireDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;

  const item = await queryOne('SELECT id FROM bom_items WHERE id = ?', [params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const quote = await queryOne(
    'SELECT id FROM supplier_quotes WHERE id = ? AND bom_item_id = ?', [b.quote_id, params.id]);
  if (!quote) return NextResponse.json({ error: 'That quote is not for this item' }, { status: 400 });

  await execute('UPDATE bom_items SET selected_quote_id = ? WHERE id = ?', [quote.id, params.id]);
  await audit('supplier_selected', { actor: user.username, detail: `item ${params.id}: quote ${quote.id}` });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;

  const item = await queryOne('SELECT id FROM bom_items WHERE id = ?', [params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await execute('UPDATE bom_items SET selected_quote_id = NULL WHERE id = ?', [params.id]);
  await audit('supplier_selection_reverted', { actor: user.username, detail: `item ${params.id}` });
  return NextResponse.json({ ok: true });
}
