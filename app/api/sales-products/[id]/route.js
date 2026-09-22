// app/api/sales-products/[id]/route.js — edit, active toggle. No DELETE — a product may already be
// referenced from real leads/quotation/sale-order lines, same deactivate-don't-delete convention
// as branches/sales_stages.
import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { requireCrmAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

const EDITABLE = ['product_code', 'product_name', 'product_type', 'description', 'price', 'active'];

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = await requireCrmAction(user, 'sales.product.write');
  if (denied) return denied;

  const b = await req.json();
  const fields = [];
  const args = [];
  for (const key of EDITABLE) {
    if (b[key] === undefined) continue;
    fields.push(`${key} = ?`);
    args.push(key === 'active' ? (b[key] ? 1 : 0) : (key === 'price' ? (b[key] != null ? Number(b[key]) : null) : b[key]));
  }
  if (!fields.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  fields.push('updated_at = CURRENT_TIMESTAMP');
  args.push(params.id);

  try {
    await execute(`UPDATE sales_products SET ${fields.join(', ')} WHERE id = ?`, args);
    await audit('sales_product_edited', { actor: user.username, detail: `product #${params.id}` });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (String(err).toLowerCase().includes('unique')) {
      return NextResponse.json({ error: 'A product with that code already exists' }, { status: 409 });
    }
    throw err;
  }
}
