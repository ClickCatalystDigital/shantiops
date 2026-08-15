// app/api/quotations/route.js — V3_CHANGES.md §12 Phase 2d. quotation_no follows the same
// FY-format sequence po_no uses (app/api/purchase-orders/route.js), a distinct counter/prefix.
// POST accepts the full item list at once (small form, not a separate line-item endpoint like
// opportunities' bulk-PUT — a quotation is created whole, not built up incrementally in the UI).
import { NextResponse } from 'next/server';
import { execute, nextCounterValue } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { getQuotations } from '@/lib/data';
import { audit } from '@/lib/usb';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return isPM(user) || CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

export async function GET() {
  const user = await getFreshSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await getQuotations());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const b = await req.json();
  if (!b.customer_id) return NextResponse.json({ error: 'customer_id is required' }, { status: 400 });
  const items = Array.isArray(b.items) ? b.items.filter(it => String(it.item_description || '').trim()) : [];
  if (!items.length) return NextResponse.json({ error: 'At least one line item is required' }, { status: 400 });

  const now = new Date();
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; // FY = Apr-Mar
  const seq = await nextCounterValue('quotation_no', 0);
  const quotationNo = `QTN-${seq}/SB/${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`;

  const subtotal = items.reduce((a, it) => a + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0);
  const taxPct = Number(b.tax_pct) || 0;
  const taxAmount = subtotal * taxPct / 100;
  const total = subtotal + taxAmount;

  const { lastId } = await execute(
    `INSERT INTO quotations
       (quotation_no, customer_id, opportunity_id, quotation_date, valid_until, subtotal, tax_pct, tax_amount, total, terms, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [quotationNo, b.customer_id, b.opportunity_id || null, b.quotation_date || null, b.valid_until || null,
      subtotal, taxPct, taxAmount, total, b.terms || null, b.notes || null, user.username]
  );
  const quotationId = Number(lastId);
  let sortOrder = 0;
  for (const it of items) {
    const qty = Number(it.qty) || 0;
    const rate = Number(it.rate) || 0;
    await execute(
      `INSERT INTO quotation_items (quotation_id, item_description, hsn_code, qty, uom, rate, amount, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [quotationId, it.item_description.trim(), it.hsn_code || null, qty, it.uom || null, rate, qty * rate, sortOrder++]
    );
  }
  await audit('quotation_created', { actor: user.username, detail: quotationNo });
  return NextResponse.json({ id: quotationId, quotation_no: quotationNo });
}
