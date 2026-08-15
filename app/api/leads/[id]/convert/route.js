// app/api/leads/[id]/convert/route.js — V3_CHANGES.md §12 decision 2/7. Lead → Customer +
// Opportunity, the first of four uses of the same "accept → auto-create the next record" playbook
// this plan establishes (also: Quotation→Sale Order, Applicant→Employee). Reuses an existing
// customer matched by exact name rather than always creating a duplicate.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const lead = await queryOne('SELECT * FROM leads WHERE id = ?', [params.id]);
  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (lead.status === 'converted') return NextResponse.json({ error: 'Already converted' }, { status: 409 });

  const companyName = lead.company_name || lead.lead_name;
  let customer = await queryOne('SELECT * FROM customers WHERE name = ?', [companyName]);
  let customerId;
  if (customer) {
    customerId = customer.id;
  } else {
    const { lastId } = await execute(
      'INSERT INTO customers (name, phone, email) VALUES (?, ?, ?)',
      [companyName, lead.phone || null, lead.email || null]
    );
    customerId = Number(lastId);
  }

  const b = await req.json().catch(() => ({}));
  const { lastId: oppId } = await execute(
    `INSERT INTO opportunities (customer_id, customer_name, title, owner_dept, campaign_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [customerId, companyName, b.title || `${companyName} — opportunity`, lead.owner_dept, lead.campaign_id, user.username]
  );

  await execute(
    `UPDATE leads SET status = 'converted', converted_customer_id = ?, converted_opportunity_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [customerId, Number(oppId), params.id]
  );
  await audit('lead_converted', { actor: user.username, detail: `lead #${params.id} -> customer #${customerId}, opportunity #${oppId}` });
  return NextResponse.json({ customer_id: customerId, opportunity_id: Number(oppId) });
}
