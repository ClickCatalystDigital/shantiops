// app/api/purchase-orders/route.js

// Create a draft PO from a set of already supplier-selected BOM items (any project — a PO can
// span several, the same MS angle bought once for multiple boilers). All items must already carry
// a selected_quote_id (via /select-supplier) and share one supplier — that's what makes a single
// PO coherent. po_no follows the real business's own numbering: NNN/SB/YYYY-YY (Indian financial
// year, April-March), continuing the sequence the sample POs are already on (counters.po_no seeded
// at 578 in lib/db.js).
import { NextResponse } from 'next/server';
import { execute, queryAll, nextCounterValue } from '@/lib/db';
import { getSessionUser, requireDepartment } from '@/lib/auth';
import { getPurchaseOrders } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function GET(req) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const filter = {};
  if (searchParams.get('status')) filter.status = searchParams.get('status');
  if (searchParams.get('supplier_id')) filter.supplier_id = Number(searchParams.get('supplier_id'));
  return NextResponse.json(await getPurchaseOrders(filter));
}

export async function POST(req) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;

  const b = await req.json();
  const itemIds = Array.isArray(b.items) ? b.items.map(Number).filter(Boolean) : [];
  if (!itemIds.length) return NextResponse.json({ error: 'Pick at least one item' }, { status: 400 });

  const placeholders = itemIds.map(() => '?').join(',');
  const rows = await queryAll(
    `SELECT b.id, b.project_id, b.material_description, b.qty_text,
            sq.supplier_id, sq.unit_price, sq.uom
       FROM bom_items b JOIN supplier_quotes sq ON sq.id = b.selected_quote_id
      WHERE b.id IN (${placeholders})`,
    itemIds
  );
  if (rows.length !== itemIds.length) {
    return NextResponse.json({ error: 'Every item needs a selected supplier first' }, { status: 400 });
  }
  const supplierIds = new Set(rows.map(r => r.supplier_id));
  if (supplierIds.size > 1) {
    return NextResponse.json({ error: 'All items on one PO must share the same supplier' }, { status: 400 });
  }

  const now = new Date();
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; // FY = Apr-Mar
  const seq = await nextCounterValue('po_no', 578);
  const poNo = `${seq}/SB/${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`;

  const { lastId } = await execute(
    `INSERT INTO purchase_orders
       (po_no, supplier_id, is_split, quote_source, quote_date, indent_ref, delivery_address,
        payment_terms, discount_pct, gst_pct, special_instructions, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [poNo, rows[0].supplier_id, b.is_split ? 1 : 0, b.quote_source || null, b.quote_date || null,
      b.indent_ref || null, b.delivery_address || null, b.payment_terms || null,
      Number(b.discount_pct) || 0, b.gst_pct != null ? Number(b.gst_pct) : 18, b.special_instructions || null,
      user.username]
  );
  const poId = Number(lastId);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    // qty_text is free-typed spreadsheet text ("2 Nos", "12 SQ MTR") — parseFloat pulls the
    // leading number out of it; falls back to 1 when it can't (never blocks PO creation on it).
    const qty = parseFloat(r.qty_text) || 1;
    const amount = Math.round(qty * r.unit_price * 100) / 100;
    await execute(
      `INSERT INTO po_items (po_id, bom_item_id, project_id, description, qty, uom, rate, amount, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [poId, r.id, r.project_id, r.material_description, qty, r.uom, r.unit_price, amount, i]
    );
  }

  await audit('po_created', { actor: user.username, detail: `${poNo}: ${rows.length} item(s), supplier ${rows[0].supplier_id}` });
  return NextResponse.json({ id: poId, po_no: poNo });
}
