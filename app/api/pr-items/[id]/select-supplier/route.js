// Award (or revert) a whole PR line's constituents to one supplier in one action — the group-level
// equivalent of app/api/bom-items/[id]/select-supplier/route.js, whose per-item logic this reuses
// unmodified. `params.id` is a pr_items.id (a shared PR line), not a bom_items.id.
//
// Every bom_items row sharing this pr_item_id (one per project split) gets the same supplier
// applied, each at whatever price that supplier quoted that project's own line — a constituent
// with no quote from the chosen supplier is skipped, not failed, so partial coverage is allowed
// and surfaced in the UI rather than blocking the whole action. Because selectQuoteForItem already
// looks up "that supplier's one open draft PO," every awarded constituent naturally lands on the
// same single draft PO with its own line item — PO/GRN/costing/QC-traceability structure is
// unchanged, still per-project. The header-level purchase_requisitions.status/awarded_supplier_id
// rollup is refreshed inside selectQuoteForItem/deselectQuoteForItem themselves, not here.
import { NextResponse } from 'next/server';
import { queryAll, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { selectQuoteForItem, deselectQuoteForItem } from '@/lib/procurement';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Procurement', 'procurement.quote.select');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const supplierId = Number(b.supplier_id);
  if (!supplierId) return NextResponse.json({ error: 'Pick a supplier' }, { status: 400 });

  const rows = await queryAll('SELECT id FROM bom_items WHERE pr_item_id = ?', [params.id]);
  if (!rows.length) return NextResponse.json({ error: 'PR line not found' }, { status: 404 });

  const awarded = [];
  for (const row of rows) {
    const quote = await queryOne(
      'SELECT id FROM supplier_quotes WHERE bom_item_id = ? AND supplier_id = ? ORDER BY id DESC LIMIT 1',
      [row.id, supplierId]
    );
    if (!quote) continue; // this project's split has no quote from this supplier — skip, don't fail the whole batch
    const result = await selectQuoteForItem(row.id, quote.id);
    awarded.push({ bom_item_id: row.id, po_id: result.poId });
  }
  if (!awarded.length) {
    return NextResponse.json({ error: 'This supplier has not quoted any item in this PR line' }, { status: 400 });
  }

  await audit('supplier_selected', {
    actor: user.username,
    detail: `pr item ${params.id}: supplier ${supplierId}, ${awarded.length} item(s)`,
  });
  return NextResponse.json({ ok: true, awarded });
}

export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Procurement', 'procurement.quote.select');
  if (actionDenied) return actionDenied;

  const rows = await queryAll(
    'SELECT id FROM bom_items WHERE pr_item_id = ? AND selected_quote_id IS NOT NULL',
    [params.id]
  );
  if (!rows.length) return NextResponse.json({ error: 'Nothing awarded on this PR line' }, { status: 404 });

  for (const row of rows) await deselectQuoteForItem(row.id);

  await audit('supplier_selection_reverted', {
    actor: user.username,
    detail: `pr item ${params.id}: ${rows.length} item(s)`,
  });
  return NextResponse.json({ ok: true });
}
