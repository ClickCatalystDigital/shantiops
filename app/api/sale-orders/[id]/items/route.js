// app/api/sale-orders/[id]/items/route.js — the missing piece: sale_order_items was previously
// only ever written once, at creation (POST /api/quotations/[id]/convert copying a Quotation's own
// lines). A Sale Order created directly (quick-add, or one that predates a project it's since been
// linked to — real case: SB-1109-01-50/SO-22) had no way to ever gain real priced line items.
//
// Whole-list replace (delete + reinsert), not per-item CRUD — matches this codebase's own precedent
// for "the full set is edited together" (Scope of Supply items, BOM template items) rather than
// inventing granular single-item routes nothing else here needs yet. Same gate as the existing
// status PATCH (sales.saleorder.status, labeled "Edit or update a Sale Order" — this is squarely
// that).
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment, canAccessDepartment, isPM } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

export async function PUT(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isPM(user)) {
    const denied = requireDepartment(user, 'Sales');
    if (denied) return denied;
  }
  const actionDenied = await requireAction(user, 'Sales', 'sales.saleorder.status');
  if (actionDenied) return actionDenied;

  const so = await queryOne('SELECT id, tax_pct FROM sale_orders WHERE id = ?', [params.id]);
  if (!so) return NextResponse.json({ error: 'Sale Order not found' }, { status: 404 });

  const b = await req.json();
  const items = Array.isArray(b.items) ? b.items : [];
  // Tax % is Accounts' rate, Sales sees it as a label only (direct request) — real server-side
  // enforcement, not just a disabled client field: a non-Accounts caller submitting a different
  // rate than what's already stored is rejected outright, never silently applied or silently
  // ignored (which would desync what the UI showed them from what actually got saved).
  const requestedTaxPct = Number(b.tax_pct) || 0;
  const canEditTax = isPM(user) || canAccessDepartment(user, 'Accounts');
  if (!canEditTax && requestedTaxPct !== (so.tax_pct || 0)) {
    return NextResponse.json({ error: 'Only Accounts can change the tax rate on a Sale Order' }, { status: 403 });
  }
  const taxPct = canEditTax ? requestedTaxPct : (so.tax_pct || 0);

  // Explicit amount always wins (a lump-sum line) — same idiom scope_of_supply_items already uses;
  // otherwise qty * rate. Matching SoS exactly means every rate/amount here can be a real 0.
  let subtotal = 0;
  const rows = items.map((it, i) => {
    const qty = it.qty !== undefined && it.qty !== '' ? Number(it.qty) : null;
    const rate = it.rate !== undefined && it.rate !== '' ? Number(it.rate) : null;
    const amount = it.amount !== undefined && it.amount !== '' ? Number(it.amount) : (qty != null && rate != null ? qty * rate : 0);
    subtotal += amount;
    return {
      item_description: String(it.item_description || '').trim(),
      hsn_code: it.hsn_code ? String(it.hsn_code).trim() : null,
      qty, uom: it.uom || null, rate, amount, sort_order: i,
    };
  });
  if (rows.some(r => !r.item_description)) {
    return NextResponse.json({ error: 'Every line needs a description' }, { status: 400 });
  }
  const taxAmount = Math.round(subtotal * taxPct) / 100;
  const total = subtotal + taxAmount;

  await execute('DELETE FROM sale_order_items WHERE sale_order_id = ?', [params.id]);
  for (const r of rows) {
    await execute(
      `INSERT INTO sale_order_items (sale_order_id, item_description, hsn_code, qty, uom, rate, amount, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [params.id, r.item_description, r.hsn_code, r.qty, r.uom, r.rate, r.amount, r.sort_order]);
  }
  await execute(
    'UPDATE sale_orders SET subtotal = ?, tax_pct = ?, tax_amount = ?, total = ? WHERE id = ?',
    [subtotal, taxPct, taxAmount, total, params.id]);

  await audit('sale_order_items_updated', { actor: user.username, detail: `SO ${params.id} -> ${rows.length} line(s), total ${total}` });
  return NextResponse.json({ ok: true, subtotal, taxAmount, total });
}
