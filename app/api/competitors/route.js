// app/api/competitors/route.js — Sales CRM plan 4. Competitors seen on a customer or an enquiry
// (who else quoted, at what price, and whether we lost the order to them). GET ?customer_id= or
// ?lead_id= lists them; POST adds one. An enquiry's competitor also belongs to its customer once
// the enquiry is linked to one, so the customer's view shows every enquiry's competitors.
import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { hiddenSalesRecord, salesScope } from '@/lib/sales-visibility';
import { audit } from '@/lib/usb';

const canSales = u => isPM(u) || canAccessDepartment(u, 'Sales');

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!canSales(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const leadId = sp.get('lead_id');
  const customerId = sp.get('customer_id');
  if (leadId) {
    const hidden = await hiddenSalesRecord(user, 'lead', leadId);
    if (hidden) return hidden;
  }
  const rows = await queryAll(
    `SELECT cc.*, l.company_name AS lead_name, c.name AS customer_name, l.account_manager, l.assigned_to, l.initiated_by, l.created_by AS lead_created_by
       FROM customer_competitors cc LEFT JOIN leads l ON l.id = cc.lead_id LEFT JOIN customers c ON c.id = cc.customer_id
      WHERE ${leadId ? 'cc.lead_id = ?' : customerId ? 'cc.customer_id = ?' : '1 = 1'}
      ORDER BY cc.created_at DESC`,
    leadId ? [leadId] : customerId ? [customerId] : []
  );
  // Plan 2a: a Sales member sees competitors on their own enquiries, plus ones logged on a customer directly.
  const me = salesScope(user);
  const visible = me ? rows.filter(r => !r.lead_id || [r.account_manager, r.assigned_to, r.initiated_by, r.lead_created_by].includes(me) || r.created_by === me) : rows;
  return NextResponse.json(visible.map(({ account_manager, assigned_to, initiated_by, lead_created_by, ...r }) => r));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!canSales(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  const competitor = String(b.competitor || '').trim();
  if (!competitor) return NextResponse.json({ error: 'Competitor name is required' }, { status: 400 });
  if (!b.lead_id && !b.customer_id) return NextResponse.json({ error: 'An enquiry or a customer is required' }, { status: 400 });
  const price = b.price === '' || b.price == null ? null : Number(b.price);
  if (price != null && !(price >= 0)) return NextResponse.json({ error: 'Price must be a number ≥ 0' }, { status: 400 });
  let customerId = b.customer_id ? Number(b.customer_id) : null;
  if (b.lead_id) {
    const hidden = await hiddenSalesRecord(user, 'lead', b.lead_id);
    if (hidden) return hidden;
    const lead = await queryOne('SELECT converted_customer_id FROM leads WHERE id = ?', [b.lead_id]);
    if (!lead) return NextResponse.json({ error: 'Enquiry not found' }, { status: 404 });
    customerId = customerId || lead.converted_customer_id || null;
  }
  if (customerId && !(await queryOne('SELECT id FROM customers WHERE id = ?', [customerId]))) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
  }
  const { lastId } = await execute(
    `INSERT INTO customer_competitors (customer_id, lead_id, competitor, product, price, lost_to, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [customerId, b.lead_id || null, competitor, String(b.product || '').trim() || null, price, b.lost_to ? 1 : 0,
      String(b.notes || '').trim() || null, user.username]
  );
  await audit('competitor_added', { actor: user.username, detail: `${competitor}${b.lead_id ? ` on LD-${b.lead_id}` : ''}${customerId ? ` / customer ${customerId}` : ''}` });
  return NextResponse.json({ id: Number(lastId) });
}
