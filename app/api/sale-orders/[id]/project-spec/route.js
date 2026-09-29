// GET /api/sale-orders/[id]/project-spec — the defaults the New Project form pre-fills after a Sale Order is
// picked: { series, model_design, model_capacity, model_pressure }. Read-only; all null when unknown.
import { NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { hiddenSalesRecord } from '@/lib/sales-visibility';
import { getOrderSpecDefaults } from '@/lib/order-spec-server';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const hidden = await hiddenSalesRecord(user, 'sale_order', params.id);
  if (hidden) return hidden;
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { product_id, ...spec } = await getOrderSpecDefaults(Number(params.id));
  return NextResponse.json(spec);
}
