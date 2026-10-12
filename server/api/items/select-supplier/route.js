// Award (or revert) a set of bom_items to one supplier in one action — the Item Master grouped
// PMB view in Procurement (same item, several projects). Same per-row logic as
// app/api/pr-items/[id]/select-supplier/route.js, keyed by explicit bom_item ids instead of a PR
// line. A row with no quote from the chosen supplier is skipped, not failed.
import { NextResponse } from 'next/server';
import { queryAll, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { selectQuoteForItem, deselectQuoteForItem } from '@/lib/procurement';

async function gate() {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement') || await requireAction(user, 'Procurement', 'procurement.quote.select');
  return { user, denied };
}
const ids = b => [...new Set((Array.isArray(b.bom_item_ids) ? b.bom_item_ids : []).map(Number).filter(Boolean))];

export async function POST(req) {
  const { user, denied } = await gate();
  if (denied) return denied;
  const b = await req.json();
  const supplierId = Number(b.supplier_id);
  const list = ids(b);
  if (!supplierId) return NextResponse.json({ error: 'Pick a supplier' }, { status: 400 });
  if (!list.length) return NextResponse.json({ error: 'No items given' }, { status: 400 });

  const awarded = [];
  for (const id of list) {
    const quote = await queryOne(
      'SELECT id FROM supplier_quotes WHERE bom_item_id = ? AND supplier_id = ? ORDER BY id DESC LIMIT 1', [id, supplierId]);
    if (!quote) continue;
    const result = await selectQuoteForItem(id, quote.id);
    awarded.push({ bom_item_id: id, po_id: result.poId });
  }
  if (!awarded.length) return NextResponse.json({ error: 'This supplier has not quoted any of these items' }, { status: 400 });
  await audit('supplier_selected', { actor: user.username, detail: `item group: supplier ${supplierId}, ${awarded.length} item(s)` });
  return NextResponse.json({ ok: true, awarded });
}

export async function DELETE(req) {
  const { user, denied } = await gate();
  if (denied) return denied;
  const list = ids(await req.json());
  if (!list.length) return NextResponse.json({ error: 'No items given' }, { status: 400 });
  const rows = await queryAll(
    `SELECT id FROM bom_items WHERE selected_quote_id IS NOT NULL AND id IN (${list.map(() => '?').join(',')})`, list);
  if (!rows.length) return NextResponse.json({ error: 'Nothing awarded on these items' }, { status: 404 });
  for (const row of rows) await deselectQuoteForItem(row.id);
  await audit('supplier_selection_reverted', { actor: user.username, detail: `item group: ${rows.length} item(s)` });
  return NextResponse.json({ ok: true });
}
