// lib/crm.js — shared CRM logic reused across more than one route. Currently just the
// Lead -> Customer + Opportunity resolution (Sales CRM expansion Phase 2.0/3.2's "customer
// resolution" prerequisite): find-or-create a customer by exact name, create its first
// Opportunity seeded from the Lead's own current sales_call_status, and mark the Lead converted.
// Extracted out of app/api/leads/[id]/convert/route.js so "Create Commercial Offer"/"Create PO"
// can silently run the identical logic on a not-yet-converted lead instead of duplicating it.
import { execute, queryOne } from '@/lib/db';
import { audit } from '@/lib/usb';

export async function resolveLeadToCustomer(lead, { title, username } = {}) {
  if (lead.status === 'converted' && lead.converted_customer_id) {
    return { customerId: lead.converted_customer_id, opportunityId: lead.converted_opportunity_id };
  }

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

  const { lastId: oppId } = await execute(
    `INSERT INTO opportunities (customer_id, customer_name, title, stage, owner_dept, campaign_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [customerId, companyName, title || `${companyName} — opportunity`, lead.sales_call_status || 'Lead - Cold',
      lead.owner_dept, lead.campaign_id, username || lead.created_by]
  );

  await execute(
    `UPDATE leads SET status = 'converted', converted_customer_id = ?, converted_opportunity_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [customerId, Number(oppId), lead.id]
  );
  await audit('lead_converted', { actor: username || 'system', detail: `lead #${lead.id} -> customer #${customerId}, opportunity #${Number(oppId)}` });
  return { customerId, opportunityId: Number(oppId) };
}
