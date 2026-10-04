// The supplier's own delivery details, on their private RFQ link (public: the token is the auth, and
// every call re-checks it and its expiry). Adds or edits a dispatch against an issued PO of THIS supplier
// that came out of THIS RFQ — never any other order.
import { NextResponse } from 'next/server';
import { getRfqByToken } from '@/lib/data';
import { createPoDispatch, updatePoDispatch } from '@/lib/po-dispatch';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';

async function load(token, poId) {
  const rs = await getRfqByToken(token);
  if (!rs) return { res: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  if (rs.token_expires && rs.token_expires < Date.now()) return { res: NextResponse.json({ error: 'This link has expired' }, { status: 410 }) };
  const order = rs.orders.find(o => o.id === Number(poId));
  if (!order) return { res: NextResponse.json({ error: 'That order is not available on this link' }, { status: 404 }) };
  return { rs, order };
}
// Procurement staff open this same page to enter what a supplier told them on the phone: those entries are
// recorded under their own name, anyone else is the supplier.
async function actorFor(rs) {
  const user = await getFreshSessionUser();
  return user && (canAccessDepartment(user, 'Procurement') || canAccessDepartment(user, 'Stores')) ? user.username : `supplier:${rs.supplier_id}`;
}
const poFor = (rs, order) => ({ id: order.id, po_no: order.po_no, supplier_name: rs.supplier_name });

// Body: { po_id, dispatched_on, items: [{ po_item_id, qty }], carrier + invoice fields }
export async function POST(req, { params }) {
  const b = await req.json();
  const { rs, order, res } = await load(params.token, b.po_id);
  if (res) return res;
  const r = await createPoDispatch(poFor(rs, order), b, await actorFor(rs));
  return r.error ? NextResponse.json({ error: r.error }, { status: r.status || 400 }) : NextResponse.json({ ok: true, id: r.id });
}

// Body: { po_id, dispatch_id, ...same fields (items optional) }
export async function PUT(req, { params }) {
  const b = await req.json();
  const { rs, order, res } = await load(params.token, b.po_id);
  if (res) return res;
  const r = await updatePoDispatch(poFor(rs, order), Number(b.dispatch_id), b, await actorFor(rs));
  return r.error ? NextResponse.json({ error: r.error }, { status: r.status || 400 }) : NextResponse.json({ ok: true });
}
