// lib/crm.js — shared CRM logic reused across more than one route: setLeadStage() (the only way
// an enquiry's stage changes) and the Lead -> Customer resolution (Sales CRM expansion Phase
// 2.0/3.2's "customer resolution" prerequisite): find-or-create a customer by exact name and link
// the Lead to it. Only Marketing leads still get an Opportunity (plan 1b).
// Extracted out of app/api/leads/[id]/convert/route.js so "Create Commercial Offer"/"Create PO"
// can silently run the identical logic on a not-yet-converted lead instead of duplicating it.
import { execute, queryAll, queryOne, withTransaction } from '@/lib/db';
import { audit } from '@/lib/usb';
import { DEFAULT_STAGE, isKnownStage, leadStateForStage } from '@/lib/lead-stage.mjs';
import { linesTotal, normalizeProductLines } from '@/lib/sales-lines.mjs';

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

// Sales CRM plan 1e — an enquiry's product lines. The form always sends the whole list, so a save
// replaces it. Split in two so a route can validate BEFORE creating the enquiry:
// resolveProductLines() checks the input (throws { status: 400 }), writeLeadProducts() stores it.
export async function resolveProductLines(input) {
  const ids = [...new Set((Array.isArray(input) ? input : []).map(l => Number(l?.product_id)).filter(Boolean))];
  const products = ids.length
    ? await queryAll(`SELECT id, product_name, unit, price, gst_pct FROM sales_products WHERE id IN (${ids.map(() => '?').join(',')})`, ids)
    : [];
  const { lines, error } = normalizeProductLines(input, new Map(products.map(p => [Number(p.id), p])));
  if (error) throw Object.assign(new Error(error), { status: 400 });
  return lines;
}

// Mirrors the first line into leads.product_id / leads.product so the older single-product reports
// keep working, and — unless the caller set expected_value itself — sets the enquiry's expected
// value to the lines' total (qty blank = 1; lines with no rate add nothing). Never touches
// updated_at: saving products on a brand-new enquiry must not count as "first response" (SLA).
export async function writeLeadProducts(leadId, lines, { setExpectedValue = true } = {}) {
  const priced = lines.filter(l => l.rate != null);
  const total = linesTotal(priced.map(l => ({ qty: l.qty ?? 1, rate: l.rate })));
  const first = lines[0] || null;
  const setValue = setExpectedValue && priced.length > 0;
  await withTransaction(async tx => {
    await tx.execute({ sql: 'DELETE FROM lead_products WHERE lead_id = ?', args: [leadId] });
    for (const l of lines) {
      await tx.execute({
        sql: `INSERT INTO lead_products (lead_id, product_id, description, qty, unit, rate, gst_pct, sort_order)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [leadId, l.product_id, l.description, l.qty, l.unit, l.rate, l.gst_pct, l.sort_order],
      });
    }
    await tx.execute({
      sql: `UPDATE leads SET product_id = ?, product = ?${setValue ? ', expected_value = ?' : ''} WHERE id = ?`,
      args: [first?.product_id ?? null, first?.description ?? null, ...(setValue ? [total] : []), leadId],
    });
  });
  return { lines, expectedValue: setValue ? total : undefined };
}

export async function resolveLeadToCustomer(lead, { title, username, customerId: chosenId = null } = {}) {
  // Linked to a customer already — conversion is a link, not a status (plan 1a).
  if (lead.converted_customer_id) {
    return { customerId: lead.converted_customer_id, opportunityId: lead.converted_opportunity_id };
  }

  const companyName = lead.company_name || lead.lead_name;
  // Plan 1k — the person picked an existing customer from the duplicate check.
  let customer = chosenId
    ? await queryOne('SELECT * FROM customers WHERE id = ? AND active = 1', [chosenId])
    : await queryOne('SELECT * FROM customers WHERE name = ?', [companyName]);
  if (chosenId && !customer) throw Object.assign(new Error('That customer no longer exists'), { status: 400 });
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

  // Sales CRM plan 1b — for Sales the enquiry IS the deal, so no Opportunity record is created;
  // quotations/orders link back to the lead instead. Marketing leads keep creating one (Marketing's
  // /pipeline is unchanged until it gets its own plan).
  let oppId = null;
  if ((lead.owner_dept || 'Sales') !== 'Sales') {
    const res = await execute(
      `INSERT INTO opportunities (customer_id, customer_name, title, stage, owner_dept, campaign_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [customerId, companyName, title || `${companyName} — opportunity`, lead.sales_call_status || 'Lead - Cold',
        lead.owner_dept, lead.campaign_id, username || lead.created_by]
    );
    oppId = Number(res.lastId);
  }

  await execute(
    `UPDATE leads SET converted_customer_id = ?, converted_opportunity_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [customerId, oppId, lead.id]
  );
  await audit('lead_converted', { actor: username || 'system', detail: `lead #${lead.id} -> customer #${customerId}${oppId ? `, opportunity #${oppId}` : ''}` });
  return { customerId, opportunityId: oppId };
}
