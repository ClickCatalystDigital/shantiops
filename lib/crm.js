// lib/crm.js — shared CRM logic reused across more than one route. Currently just the
// Lead -> Customer + Opportunity resolution (Sales CRM expansion Phase 2.0/3.2's "customer
// resolution" prerequisite): find-or-create a customer by exact name, create its first
// Opportunity seeded from the Lead's own current sales_call_status, and mark the Lead converted.
// Extracted out of app/api/leads/[id]/convert/route.js so "Create Commercial Offer"/"Create PO"
// can silently run the identical logic on a not-yet-converted lead instead of duplicating it.
import { execute, queryAll, queryOne } from '@/lib/db';
import { audit } from '@/lib/usb';
import { DEFAULT_STAGE, isKnownStage, leadStateForStage } from '@/lib/lead-stage.mjs';

// Sales CRM plan 1a/1c — the ONLY way an enquiry's stage changes. Validates the stage against the
// live sales_stages list, keeps leads.status in step with it (open|won|lost), and writes one
// lead_stage_history row per real change. `db` is anything with execute() (a withTransaction tx or
// the default client). Returns { changed, from, to } or throws { status: 400 } on a bad stage.
export async function setLeadStage(leadId, toStage, username, { db = null } = {}) {
  const run = (sql, args) => (db ? db.execute({ sql, args }) : execute(sql, args));
  const stages = await queryAll('SELECT name, sort_order, is_won, is_lost FROM sales_stages WHERE active = 1');
  const target = toStage || DEFAULT_STAGE;
  if (!isKnownStage(stages, target)) {
    throw Object.assign(new Error(`Unknown stage "${target}"`), { status: 400 });
  }
  const lead = await queryOne('SELECT id, sales_call_status FROM leads WHERE id = ?', [leadId]);
  if (!lead) throw Object.assign(new Error('Not found'), { status: 404 });
  const from = lead.sales_call_status || null;
  if (from === target) return { changed: false, from, to: target };
  await run(
    'UPDATE leads SET sales_call_status = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [target, leadStateForStage(stages, target), leadId]
  );
  await run('INSERT INTO lead_stage_history (lead_id, from_stage, to_stage, changed_by) VALUES (?, ?, ?, ?)',
    [leadId, from, target, username || null]);
  return { changed: true, from, to: target };
}

export async function resolveLeadToCustomer(lead, { title, username } = {}) {
  // Linked to a customer already — conversion is a link, not a status (plan 1a).
  if (lead.converted_customer_id) {
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
    `UPDATE leads SET converted_customer_id = ?, converted_opportunity_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [customerId, Number(oppId), lead.id]
  );
  await audit('lead_converted', { actor: username || 'system', detail: `lead #${lead.id} -> customer #${customerId}, opportunity #${Number(oppId)}` });
  return { customerId, opportunityId: Number(oppId) };
}
