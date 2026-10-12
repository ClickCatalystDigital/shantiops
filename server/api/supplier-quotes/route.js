// app/api/supplier-quotes/route.js

// Log a quote — one item or a batch (one supplier quoting several items at once), same endpoint:
// the body always carries `items`, a single-element array for the single-item case. Append-only,
// nothing here is ever updated or deleted — this is the price-history log (§5a).
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { advancePurchaseStatus } from '@/lib/procurement';

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Procurement', 'procurement.quotes.record');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const supplierId = Number(b.supplier_id);
  const items = Array.isArray(b.items) ? b.items : [];
  if (!supplierId) return NextResponse.json({ error: 'Pick a supplier' }, { status: 400 });
  if (!items.length) return NextResponse.json({ error: 'At least one item is required' }, { status: 400 });
  for (const it of items) {
    if (!it.bom_item_id || !(Number(it.unit_price) > 0)) {
      return NextResponse.json({ error: 'Every item needs a price' }, { status: 400 });
    }
  }

  const supplier = await queryOne('SELECT id FROM suppliers WHERE id = ?', [supplierId]);
  if (!supplier) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });

  // batch_id groups rows from one "quoted N items at once" entry; a single-item quote leaves it
  // NULL. Doesn't need to be globally unique across all time — Date.now() is enough to distinguish
  // this batch from any other, no crypto dependency needed for that.
  const batchId = items.length > 1 ? `batch-${Date.now()}` : null;
  const ids = [];
  for (const it of items) {
    const bomItem = await queryOne('SELECT id, project_id FROM bom_items WHERE id = ?', [it.bom_item_id]);
    if (!bomItem) continue; // skip a bad id rather than failing the whole batch
    const { lastId } = await execute(
      `INSERT INTO supplier_quotes
        (supplier_id, bom_item_id, project_id, unit_price, uom, expected_delivery_days, expected_delivery_date,
         payment_terms, quote_source, valid_until, notes, batch_id, quoted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [supplierId, bomItem.id, bomItem.project_id, Number(it.unit_price), it.uom || b.uom || null,
        b.expected_delivery_days || null, b.expected_delivery_date || null, b.payment_terms || null,
        b.quote_source || null, b.valid_until || null, b.notes || null, batchId, user.username]
    );
    ids.push(Number(lastId));
    // V2-CHANGES.md Phase 5.1 — logging a quote is a real forward action now, not just data
    // sourcing goes on to read later: it's Procurement's first real signal an item has moved from
    // "still need to contact suppliers" to "at least one quote is in."
    await advancePurchaseStatus(bomItem.id, 'Comparison');
  }
  if (!ids.length) return NextResponse.json({ error: 'No valid items' }, { status: 400 });

  await audit('supplier_quote_logged', {
    actor: user.username,
    detail: `supplier ${supplierId}: ${ids.length} item(s)${batchId ? ' (batch)' : ''}`,
  });
  return NextResponse.json({ ids });
}
