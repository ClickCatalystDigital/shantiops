// scripts/seed-sales-marketing-demo.mjs — additive Sales+Marketing demo pipeline (4.5-DATA-
// INVENTORY.md 2026-08-21 entry). Unlike scripts/seed-demo-pipeline.mjs (a full destructive wipe of
// every project/BOM/QC/etc table — would destroy the 10-project manufacturing lineup + SB-1039),
// this script only ever touches its own marked rows, same additive precedent as
// scripts/seed-stores-gate-demo.mjs. Re-runnable: deletes its own rows first (children before
// parents for FKs), then re-inserts, every time.
//
// Marker convention: every seeded row gets created_by = MARK ('sm-demo-seed'). `contacts` has no
// created_by column, so those rows are marked via notes = MARK instead.
//
// Framing: reuses the EXISTING 12 customers (repeat/expansion business), per the explicit decision
// not to invent new prospects. The 11 pre-existing converted leads and their customers/quotations/
// sale orders/opportunities are never touched — only new rows are added alongside them.
//
// Run: node --env-file=.env.local scripts/seed-sales-marketing-demo.mjs

import { createClient } from '@libsql/client';

const MARK = 'sm-demo-seed';

const client = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function run(sql, args = []) {
  return client.execute({ sql, args });
}

async function insert(sql, args = []) {
  const r = await run(sql, args);
  return Number(r.lastInsertRowid);
}

// ---------------------------------------------------------------------------------------------
// 0. Wipe this script's own previously-seeded rows (children first, FK order), then repair the
//    sale_order_no counter drift (SO-20 was created manually last session; counter still said 19,
//    so the next app-generated SO would collide on SO-20). quotation_no is already safe (23, next
//    call returns 24 — no existing QTN-24, checked live before writing this).
// ---------------------------------------------------------------------------------------------
async function wipeOwnRows() {
  console.log('Wiping previously-seeded sm-demo-seed rows...');
  await run(`DELETE FROM sales_credit_note_items WHERE sales_credit_note_id IN (SELECT id FROM sales_credit_notes WHERE created_by = ?)`, [MARK]);
  await run(`DELETE FROM sales_credit_notes WHERE created_by = ?`, [MARK]);
  await run(`DELETE FROM sales_invoice_items WHERE sales_invoice_id IN (SELECT id FROM sales_invoices WHERE created_by = ?)`, [MARK]);
  // A Dispatch-side demo packing list (not created_by=MARK, so untouched by this script otherwise)
  // links back to one of these invoices via packing_lists.sales_invoice_id (no ON DELETE action on
  // that FK) — clear the link first, same defensive pattern as the campaign_id clears below, or a
  // re-run's sales_invoices delete fails.
  await run(`UPDATE packing_lists SET sales_invoice_id = NULL WHERE sales_invoice_id IN (SELECT id FROM sales_invoices WHERE created_by = ?)`, [MARK]);
  await run(`DELETE FROM sales_invoices WHERE created_by = ?`, [MARK]);
  await run(`DELETE FROM sales_returns WHERE created_by = ?`, [MARK]);
  await run(`DELETE FROM sale_order_items WHERE sale_order_id IN (SELECT id FROM sale_orders WHERE created_by = ?)`, [MARK]);
  await run(`DELETE FROM sale_orders WHERE created_by = ?`, [MARK]);
  await run(`DELETE FROM quotation_items WHERE quotation_id IN (SELECT id FROM quotations WHERE created_by = ?)`, [MARK]);
  await run(`DELETE FROM quotations WHERE created_by = ?`, [MARK]);
  await run(`DELETE FROM opportunity_items WHERE opportunity_id IN (SELECT id FROM opportunities WHERE created_by = ?)`, [MARK]);
  await run(`DELETE FROM opportunities WHERE created_by = ?`, [MARK]);
  await run(`DELETE FROM crm_notes WHERE lead_id IN (SELECT id FROM leads WHERE created_by = ?)`, [MARK]);
  await run(`DELETE FROM leads WHERE created_by = ?`, [MARK]);
  // The pre-existing "Trade fair 2026" opportunity (not created_by=MARK, so not deleted above)
  // gets linked to our campaign below — clear that link first or a re-run's campaign delete
  // fails on the FK. Defensively clears any lead too, in case a future addition links one.
  await run(`UPDATE opportunities SET campaign_id = NULL WHERE campaign_id IN (SELECT id FROM campaigns WHERE created_by = ?)`, [MARK]);
  await run(`UPDATE leads SET campaign_id = NULL WHERE campaign_id IN (SELECT id FROM campaigns WHERE created_by = ?)`, [MARK]);
  await run(`DELETE FROM campaigns WHERE created_by = ?`, [MARK]);
  await run(`DELETE FROM contacts WHERE notes = ?`, [MARK]);
  await run(`DELETE FROM price_lists WHERE created_by = ?`, [MARK]);
  // crm_assignment_rules is upserted below (UNIQUE(owner_dept)), never deleted here.
}

async function repairCounters() {
  console.log('Repairing counter drift...');
  const so = await run(`SELECT so_no FROM sale_orders`);
  const maxSo = Math.max(0, ...so.rows.map(r => parseInt(String(r.so_no).replace('SO-', ''), 10) || 0));
  await run(
    `INSERT INTO counters (name, value) VALUES ('sale_order_no', ?)
     ON CONFLICT(name) DO UPDATE SET value = MAX(value, excluded.value)`,
    [maxSo]
  );

  const q = await run(`SELECT quotation_no FROM quotations`);
  const maxQ = Math.max(0, ...q.rows.map(r => {
    const m = String(r.quotation_no).match(/QTN-(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }));
  await run(
    `INSERT INTO counters (name, value) VALUES ('quotation_no', ?)
     ON CONFLICT(name) DO UPDATE SET value = MAX(value, excluded.value)`,
    [maxQ]
  );
  console.log(`  sale_order_no floor -> ${maxSo} (next call returns ${maxSo + 1}), quotation_no floor -> ${maxQ}`);
}

async function getCustomerId(name) {
  const r = await run(`SELECT id FROM customers WHERE name = ?`, [name]);
  if (!r.rows.length) throw new Error(`Customer not found: ${name}`);
  return r.rows[0].id;
}

async function main() {
  await wipeOwnRows();
  await repairCounters();

  const cust = {
    godavari: await getCustomerId('Godavari Agro Processors'),
    asianBrown: await getCustomerId('Asian Brown Bleachchem P Ltd'),
    himalayan: await getCustomerId('Himalayan Dairy Pvt Ltd'),
    narmada: await getCustomerId('Narmada Chemicals Ltd'),
    malwaSteel: await getCustomerId('Malwa Steel Industries'),
    bharatSugar: await getCustomerId('Bharat Sugar Mills Ltd'),
    konkanSugars: await getCustomerId('Konkan Sugars Ltd'),
    vindhyaPaper: await getCustomerId('Vindhya Paper Mills Ltd'),
    deccanSugar: await getCustomerId('Deccan Sugar Works'),
    coromandelTextiles: await getCustomerId('Coromandel Textiles Pvt Ltd'),
    kaveriSpinning: await getCustomerId('Kaveri Spinning Mills'),
  };

  // -----------------------------------------------------------------------------------------
  // 1. Marketing — campaigns (currently 0 rows)
  // -----------------------------------------------------------------------------------------
  console.log('Seeding campaigns...');
  const campBoilerExpo = await insert(
    `INSERT INTO campaigns (name, campaign_type, start_date, end_date, status, budget, owner_dept, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    ['Boiler Expo 2026 — Pune', 'trade_show', '2026-07-10', '2026-07-12', 'completed', 500000, 'Marketing', MARK]
  );
  const campEmailOutreach = await insert(
    `INSERT INTO campaigns (name, campaign_type, start_date, end_date, status, budget, owner_dept, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    ['Sugar & Distillery Email Outreach — Q2', 'email', '2026-07-15', '2026-09-15', 'active', 150000, 'Marketing', MARK]
  );
  const campWebsite = await insert(
    `INSERT INTO campaigns (name, campaign_type, start_date, end_date, status, budget, owner_dept, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    ['Website Enquiry Forms', 'digital', '2026-01-01', null, 'active', 50000, 'Marketing', MARK]
  );

  // Link the pre-existing Marketing opportunity ("Trade fair 2026") to the Boiler Expo campaign —
  // this is the one pre-existing row this script modifies, and only an additive column backfill.
  await run(`UPDATE opportunities SET campaign_id = ? WHERE title = 'Trade fair 2026 — inbound enquiries batch' AND campaign_id IS NULL`, [campBoilerExpo]);

  // -----------------------------------------------------------------------------------------
  // 2. Sales funnel — 5 new leads at every working stage, reusing existing customers
  // -----------------------------------------------------------------------------------------
  console.log('Seeding leads...');
  const leadGodavari = await insert(
    `INSERT INTO leads (lead_name, company_name, phone, email, source, campaign_id, status, owner_dept, territory, industry, assigned_to, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['P. Naidu', 'Godavari Agro Processors', '9845019001', 'p.naidu@godavariagro.example', 'trade_show', campBoilerExpo, 'new', 'Sales', 'Andhra Pradesh', 'Agro Processing', 'sales_head', MARK, '2026-08-14 10:00:00']
  );
  const leadAsianBrown = await insert(
    `INSERT INTO leads (lead_name, company_name, phone, email, source, campaign_id, status, owner_dept, territory, industry, assigned_to, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['S. Mehta', 'Asian Brown Bleachchem P Ltd', '9812345001', 's.mehta@asianbrown.example', 'email', campEmailOutreach, 'contacted', 'Sales', 'Gujarat', 'Chemicals', 'sales_head', MARK, '2026-08-12 09:30:00']
  );
  const leadHimalayan = await insert(
    `INSERT INTO leads (lead_name, company_name, phone, email, source, campaign_id, status, owner_dept, territory, industry, assigned_to, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['D. Bisht', 'Himalayan Dairy Pvt Ltd', '9845019002', 'd.bisht@himalayandairy.example', 'website', campWebsite, 'qualified', 'Sales', 'Uttarakhand', 'Dairy', 'sales', MARK, '2026-08-10 11:15:00']
  );
  const leadNarmada = await insert(
    `INSERT INTO leads (lead_name, company_name, phone, email, source, campaign_id, status, owner_dept, territory, industry, assigned_to, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['H. Solanki', 'Narmada Chemicals Ltd', '9845019003', 'h.solanki@narmadachem.example', 'trade_show', campBoilerExpo, 'new', 'Sales', 'Gujarat', 'Chemicals', 'sales_head', MARK, '2026-08-19 14:20:00']
  );
  const leadMalwa = await insert(
    `INSERT INTO leads (lead_name, company_name, phone, email, source, campaign_id, status, owner_dept, territory, industry, assigned_to, notes, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['R. Deshmukh', 'Malwa Steel Industries', '9845019004', 'r.deshmukh@malwasteel.example', 'email', campEmailOutreach, 'lost', 'Sales', 'Madhya Pradesh', 'Steel', 'sales', 'Lost to a competitor on price — see linked opportunity.', MARK, '2026-08-05 16:00:00']
  );

  // -----------------------------------------------------------------------------------------
  // crm_notes — first-contact + follow-up activity on the contacted/qualified/lost leads.
  // Dated a day or two after each lead's created_at so the Agent Performance report's
  // response-time metric (first crm_notes row - lead.created_at) has real data.
  // -----------------------------------------------------------------------------------------
  console.log('Seeding crm_notes...');
  await run(
    `INSERT INTO crm_notes (lead_id, note_type, content, call_type, duration_seconds, created_by, created_at) VALUES (?,?,?,?,?,?,?)`,
    [leadAsianBrown, 'call', 'Spoke with S. Mehta re: steam-line extension for the 8T unit. Interested, wants a formal quote for a 2nd boiler.', 'outgoing', 480, 'sales_head', '2026-08-13 10:00:00']
  );
  await run(
    `INSERT INTO crm_notes (lead_id, note_type, content, created_by, created_at) VALUES (?,?,?,?,?)`,
    [leadAsianBrown, 'email', 'Sent capability deck + past project references (SB-1018) as requested.', 'sales_head', '2026-08-13 15:30:00']
  );
  await run(
    `INSERT INTO crm_notes (lead_id, note_type, content, call_type, duration_seconds, created_by, created_at) VALUES (?,?,?,?,?,?,?)`,
    [leadHimalayan, 'call', 'Discussed AMC + spares contract renewal. Confirmed budget range, wants pricing by end of month.', 'incoming', 360, 'sales', '2026-08-11 09:00:00']
  );
  await run(
    `INSERT INTO crm_notes (lead_id, note_type, content, created_by, created_at) VALUES (?,?,?,?,?)`,
    [leadHimalayan, 'meeting', 'Site visit scheduled with plant head to scope the AMC line items.', 'sales', '2026-08-14 12:00:00']
  );
  await run(
    `INSERT INTO crm_notes (lead_id, note_type, content, created_by, created_at) VALUES (?,?,?,?,?)`,
    [leadMalwa, 'note', 'Quoted 3rd boiler at ₹28L; customer went with a lower-cost competitor. Flagged as Lost.', 'sales', '2026-08-07 10:00:00']
  );

  // -----------------------------------------------------------------------------------------
  // 3. Opportunity pipeline — backfill customer_id on the existing Asian Brown opp, itemize it,
  //    add opportunity_items, and add the one missing stage (Lost) tied to the Malwa Steel lead.
  // -----------------------------------------------------------------------------------------
  console.log('Backfilling + extending opportunities...');
  const oppAsianBrown = (await run(
    `SELECT id FROM opportunities WHERE title = 'Asian Brown — 8T boiler upgrade'`
  )).rows[0]?.id;
  if (oppAsianBrown) {
    await run(`UPDATE opportunities SET customer_id = ? WHERE id = ? AND customer_id IS NULL`, [cust.asianBrown, oppAsianBrown]);
    // opportunity_items has no created_by column, and this parent opportunity itself pre-exists
    // (not created_by=MARK), so wipeOwnRows() never touches its items — delete-then-reinsert here
    // instead, or a re-run would silently triple these 3 rows every time (confirmed: it did).
    await run(`DELETE FROM opportunity_items WHERE opportunity_id = ?`, [oppAsianBrown]);
    await run(
      `INSERT INTO opportunity_items (opportunity_id, item_description, qty, uom, rate, amount, sort_order) VALUES (?,?,?,?,?,?,?)`,
      [oppAsianBrown, '8 TPH Solid Fuel Fired Boiler', 1, 'No', 2600000, 2600000, 0]
    );
    await run(
      `INSERT INTO opportunity_items (opportunity_id, item_description, qty, uom, rate, amount, sort_order) VALUES (?,?,?,?,?,?,?)`,
      [oppAsianBrown, 'Economizer', 1, 'No', 400000, 400000, 1]
    );
    await run(
      `INSERT INTO opportunity_items (opportunity_id, item_description, qty, uom, rate, amount, sort_order) VALUES (?,?,?,?,?,?,?)`,
      [oppAsianBrown, 'Multi Cyclone Dust Collector', 1, 'No', 200000, 200000, 2]
    );
  } else {
    console.warn('  WARNING: "Asian Brown — 8T boiler upgrade" opportunity not found, skipping backfill/items.');
  }

  const oppMalwa = await insert(
    `INSERT INTO opportunities (customer_id, customer_name, title, stage, value_num, owner_dept, source, lost_reason, created_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [cust.malwaSteel, 'Malwa Steel Industries', 'Malwa Steel — 3rd boiler', 'Lost', 2800000, 'Sales', 'email', 'Lost to competitor on price', MARK]
  );

  // -----------------------------------------------------------------------------------------
  // 4. Quotations at every status — draft, sent, and a fresh accepted one (feeds the new SO).
  // -----------------------------------------------------------------------------------------
  console.log('Seeding quotations...');
  const qtnDraft = await insert(
    `INSERT INTO quotations (quotation_no, customer_id, opportunity_id, quotation_date, valid_until, status, subtotal, tax_pct, tax_amount, total, terms, notes, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['QTN-24/SB/2026-27', cust.asianBrown, oppAsianBrown || null, '2026-08-15', '2026-09-15', 'draft', 3200000, 18, 576000, 3776000,
      'Advance 30% with order, balance against dispatch.', 'For the 8T boiler upgrade opportunity — steam-line extension.', MARK]
  );
  await run(
    `INSERT INTO quotation_items (quotation_id, item_description, qty, uom, rate, amount, sort_order) VALUES (?,?,?,?,?,?,?)`,
    [qtnDraft, '8 TPH Solid Fuel Fired Boiler', 1, 'No', 2600000, 2600000, 0]
  );
  await run(
    `INSERT INTO quotation_items (quotation_id, item_description, qty, uom, rate, amount, sort_order) VALUES (?,?,?,?,?,?,?)`,
    [qtnDraft, 'Economizer + MCDC', 1, 'No', 600000, 600000, 1]
  );

  const qtnSent = await insert(
    `INSERT INTO quotations (quotation_no, customer_id, quotation_date, valid_until, status, subtotal, tax_pct, tax_amount, total, terms, notes, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['QTN-25/SB/2026-27', cust.godavari, '2026-08-16', '2026-09-16', 'sent', 4800000, 18, 864000, 5664000,
      'Advance 30% with order, 40% before dispatch, 30% on commissioning.', 'Repeat order — 2nd husk-fired boiler, 8 TPH.', MARK]
  );
  await run(
    `INSERT INTO quotation_items (quotation_id, item_description, qty, uom, rate, amount, sort_order) VALUES (?,?,?,?,?,?,?)`,
    [qtnSent, '8 TPH Husk Fired Boiler @ 17.5 Kg/cm2', 1, 'No', 4800000, 4800000, 0]
  );

  const qtnAccepted = await insert(
    `INSERT INTO quotations (quotation_no, customer_id, quotation_date, valid_until, status, subtotal, tax_pct, tax_amount, total, terms, notes, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['QTN-26/SB/2026-27', cust.himalayan, '2026-08-11', '2026-09-11', 'accepted', 950000, 18, 171000, 1121000,
      'Advance 50% with order, balance on completion.', 'AMC + spares contract renewal, converted from the qualified lead.', MARK]
  );
  await run(
    `INSERT INTO quotation_items (quotation_id, item_description, qty, uom, rate, amount, sort_order) VALUES (?,?,?,?,?,?,?)`,
    [qtnAccepted, 'Annual Maintenance Contract — 3 TPH unit', 1, 'No', 700000, 700000, 0]
  );
  await run(
    `INSERT INTO quotation_items (quotation_id, item_description, qty, uom, rate, amount, sort_order) VALUES (?,?,?,?,?,?,?)`,
    [qtnAccepted, 'Spares kit (gaskets, valves, gauges)', 1, 'Set', 250000, 250000, 1]
  );

  // -----------------------------------------------------------------------------------------
  // 5. Sale Orders — one fresh, unconverted, open SO from the Himalayan accepted quotation, so
  //    it appears in the Design-head "Convert Sale Order" picker (ConvertSaleOrderButton.jsx).
  // -----------------------------------------------------------------------------------------
  console.log('Seeding the new open Sale Order...');
  const soHimalayan = await insert(
    `INSERT INTO sale_orders (so_no, customer_name, customer_id, quotation_id, description, subtotal, tax_pct, tax_amount, total, company, status, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['SO-21', 'Himalayan Dairy Pvt Ltd', cust.himalayan, qtnAccepted, 'Converted from QTN-26/SB/2026-27',
      950000, 18, 171000, 1121000, 'Shanti Boilers', 'open', MARK]
  );
  await run(
    `INSERT INTO sale_order_items (sale_order_id, item_description, qty, uom, rate, amount, sort_order) VALUES (?,?,?,?,?,?,?)`,
    [soHimalayan, 'Annual Maintenance Contract — 3 TPH unit', 1, 'No', 700000, 700000, 0]
  );
  await run(
    `INSERT INTO sale_order_items (sale_order_id, item_description, qty, uom, rate, amount, sort_order) VALUES (?,?,?,?,?,?,?)`,
    [soHimalayan, 'Spares kit (gaskets, valves, gauges)', 1, 'Set', 250000, 250000, 1]
  );

  // -----------------------------------------------------------------------------------------
  // 6. Commercial back-end — against real converted SOs/projects so the numbers are honest.
  //    Asian Brown = SB-1018 (SO-11), Narmada = SB-1029 (SO-17), Himalayan = SB-1031 (SO-19).
  // -----------------------------------------------------------------------------------------
  console.log('Seeding sales_returns / invoices / credit notes...');
  const soNarmadaId = (await run(`SELECT id FROM sale_orders WHERE so_no = 'SO-17'`)).rows[0].id;
  await run(
    `INSERT INTO sales_returns (sale_order_id, item_description, qty, reason, inspection_outcome, created_by)
     VALUES (?,?,?,?,?,?)`,
    [soNarmadaId, 'Pressure Gauge (Steam) — 2 units', 2, 'Customer reports gauges reading inconsistently against calibration.', 'pending', MARK]
  );

  const soAsianBrownId = (await run(`SELECT id FROM sale_orders WHERE so_no = 'SO-11'`)).rows[0].id;
  const soHimalayanExistingId = (await run(`SELECT id FROM sale_orders WHERE so_no = 'SO-19'`)).rows[0].id;
  const projAsianBrownId = (await run(`SELECT id FROM projects WHERE project_no = 'SB-1018'`)).rows[0].id;
  const projHimalayanId = (await run(`SELECT id FROM projects WHERE project_no = 'SB-1031'`)).rows[0].id;

  const invSeq1 = await (async () => {
    const r = await run(
      `INSERT INTO counters (name, value) VALUES ('invoice_no:Shanti Boilers:2026-27', 3)
       ON CONFLICT(name) DO UPDATE SET value = value + 1
       RETURNING value`
    );
    return r.rows[0].value;
  })();
  // Interstate (Asian Brown's GSTIN starts 24 — Gujarat; company is Telangana 36) -> IGST only, no
  // CGST/SGST split. Report-Engine verification (2026-08-22) caught this seed row leaving
  // cgst/sgst/igst_amount at their schema default (0) while tax_amount/total were set explicitly —
  // the real creation flow (convert-to-invoice/route.js) always computes the split via gstSplit();
  // this seed script just hadn't been kept in sync.
  const invDraft = await insert(
    `INSERT INTO sales_invoices (invoice_no, company, customer_id, sale_order_id, quotation_id, project_id, invoice_date, due_date, status, subtotal, igst_amount, tax_amount, total, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [`SB/${invSeq1}/2026-27`, 'Shanti Boilers', cust.asianBrown, soAsianBrownId, 11, projAsianBrownId, '2026-08-20', '2026-09-19', 'draft', 4200000, 756000, 756000, 4956000, MARK]
  );
  await run(
    `INSERT INTO sales_invoice_items (sales_invoice_id, item_description, qty, uom, rate, amount, gst_rate_pct, sort_order) VALUES (?,?,?,?,?,?,?,?)`,
    [invDraft, '3 TPH Solid Fuel Fired Boiler', 1, 'No', 4200000, 4200000, 18, 0]
  );

  const invSeq2 = await (async () => {
    const r = await run(
      `INSERT INTO counters (name, value) VALUES ('invoice_no:Shanti Boilers:2026-27', 4)
       ON CONFLICT(name) DO UPDATE SET value = value + 1
       RETURNING value`
    );
    return r.rows[0].value;
  })();
  // Interstate too (Himalayan Dairy's GSTIN starts 05 — Uttarakhand) -> IGST only, same fix as above.
  const invIssued = await insert(
    `INSERT INTO sales_invoices (invoice_no, company, customer_id, sale_order_id, quotation_id, project_id, invoice_date, due_date, status, subtotal, igst_amount, tax_amount, total, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [`SB/${invSeq2}/2026-27`, 'Shanti Boilers', cust.himalayan, soHimalayanExistingId, 19, projHimalayanId, '2026-08-05', '2026-09-04', 'issued', 6800000, 1224000, 1224000, 8024000, MARK]
  );
  await run(
    `INSERT INTO sales_invoice_items (sales_invoice_id, item_description, qty, uom, rate, amount, gst_rate_pct, sort_order) VALUES (?,?,?,?,?,?,?,?)`,
    [invIssued, '2.5 TPH Solid Fuel Fired Boiler', 1, 'No', 6800000, 6800000, 18, 0]
  );

  const cnSeq = await (async () => {
    const r = await run(
      `INSERT INTO counters (name, value) VALUES ('credit_note_no:Shanti Boilers:2026-27', 3)
       ON CONFLICT(name) DO UPDATE SET value = value + 1
       RETURNING value`
    );
    return r.rows[0].value;
  })();
  const cnDraft = await insert(
    `INSERT INTO sales_credit_notes (credit_note_no, sales_invoice_id, company, credit_note_date, reason, amount, status, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    [`SB/CN/${cnSeq}/2026-27`, invIssued, 'Shanti Boilers', '2026-08-21', 'Freight overcharge adjustment', 50000, 'draft', MARK]
  );
  await run(
    `INSERT INTO sales_credit_note_items (sales_credit_note_id, item_description, qty, rate, amount) VALUES (?,?,?,?,?)`,
    [cnDraft, 'Freight adjustment', 1, 50000, 50000]
  );

  // Report Engine (2026-08-24) — Sales Register was only reading 2 distinct customers' worth of
  // invoices; getSalesRegisterLines() has no sale_order_id/project_id requirement (both nullable on
  // sales_invoices), so these are standalone invoices against 5 more customers instead of needing
  // fresh SOs/projects to hang them off. Every one of these customers' GSTIN state code (24/27/23/
  // 33) differs from Shanti Boilers' own (36 — Telangana), so all are interstate -> IGST only, same
  // as the two existing seed invoices above.
  console.log('Seeding additional sales_invoices for Sales Register coverage...');
  const extraInvoices = [
    [cust.konkanSugars, '2026-07-18', 2450000, 'paid'],
    [cust.vindhyaPaper, '2026-07-29', 1875000, 'paid'],
    [cust.deccanSugar, '2026-08-08', 3120000, 'issued'],
    [cust.coromandelTextiles, '2026-08-15', 980000, 'issued'],
    [cust.kaveriSpinning, '2026-08-22', 1540000, 'draft'],
  ];
  for (const [i, [customerId, invoiceDate, subtotal, status]] of extraInvoices.entries()) {
    const seq = await (async () => {
      const r = await run(
        `INSERT INTO counters (name, value) VALUES ('invoice_no:Shanti Boilers:2026-27', ?)
         ON CONFLICT(name) DO UPDATE SET value = value + 1
         RETURNING value`,
        [5 + i]
      );
      return r.rows[0].value;
    })();
    const igst = Math.round(subtotal * 0.18);
    const inv = await insert(
      `INSERT INTO sales_invoices (invoice_no, company, customer_id, invoice_date, due_date, status, subtotal, igst_amount, tax_amount, total, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [`SB/${seq}/2026-27`, 'Shanti Boilers', customerId, invoiceDate, null, status, subtotal, igst, igst, subtotal + igst, MARK]
    );
    await run(
      `INSERT INTO sales_invoice_items (sales_invoice_id, item_description, qty, uom, rate, amount, gst_rate_pct, sort_order) VALUES (?,?,?,?,?,?,?,?)`,
      [inv, 'Boiler & accessories per contract', 1, 'No', subtotal, subtotal, 18, 0]
    );
  }

  // -----------------------------------------------------------------------------------------
  // 7. Master/config gaps — contacts, assignment rules, price lists.
  // -----------------------------------------------------------------------------------------
  console.log('Seeding contacts, assignment rules, price lists...');
  const contactRows = [
    [cust.asianBrown, 'Ramesh Iyer', 'Purchase Manager', '9812340001', 'ramesh.iyer@asianbrown.example', 1],
    [cust.godavari, 'Lakshmi Rao', 'Plant Head', '9845010001', 'lakshmi.rao@godavariagro.example', 1],
    [cust.himalayan, 'Vikram Bisht', 'Purchase Manager', '9845020001', 'vikram.bisht@himalayandairy.example', 1],
    [cust.narmada, 'Anita Solanki', 'Plant Head', '9845030001', 'anita.solanki@narmadachem.example', 1],
    [cust.bharatSugar, 'Sanjay Patil', 'Purchase Manager', '9845040001', 'sanjay.patil@bharatsugar.example', 1],
  ];
  for (const [customerId, name, designation, phone, email, isPrimary] of contactRows) {
    await run(
      `INSERT INTO contacts (customer_id, name, designation, phone, email, is_primary, notes) VALUES (?,?,?,?,?,?,?)`,
      [customerId, name, designation, phone, email, isPrimary, MARK]
    );
  }

  await run(
    `INSERT INTO crm_assignment_rules (owner_dept, usernames, next_index) VALUES ('Sales', ?, 0)
     ON CONFLICT(owner_dept) DO UPDATE SET usernames = excluded.usernames`,
    [JSON.stringify(['sales_head', 'sales'])]
  );
  await run(
    `INSERT INTO crm_assignment_rules (owner_dept, usernames, next_index) VALUES ('Marketing', ?, 0)
     ON CONFLICT(owner_dept) DO UPDATE SET usernames = excluded.usernames`,
    [JSON.stringify(['marketing_head', 'market'])]
  );

  await run(
    `INSERT INTO price_lists (customer_id, item_id, rate, uom, notes, created_by) VALUES (?,?,?,?,?,?)`,
    [cust.asianBrown, 191, 3000, 'Mtr', 'Negotiated rate for repeat customer — beats the ₹3,200 default.', MARK]
  );
  await run(
    `INSERT INTO price_lists (customer_id, item_id, rate, uom, notes, created_by) VALUES (?,?,?,?,?,?)`,
    [null, 1919, 145, 'kgs', 'Default rate — MS Angle 50x50x5.', MARK]
  );
  await run(
    `INSERT INTO price_lists (customer_id, item_id, rate, uom, notes, created_by) VALUES (?,?,?,?,?,?)`,
    [null, 192, 3400, 'Mtr', 'Default rate — BQ Plate 12mm.', MARK]
  );

  // Re-run the counter repair now that our own SO-21/QTN-24-26 exist — the earlier call only saw
  // pre-existing rows. Idempotent (MAX(value, excluded.value)), safe to call twice.
  await repairCounters();

  console.log('Done.');
  console.log({
    campaigns: [campBoilerExpo, campEmailOutreach, campWebsite],
    leads: [leadGodavari, leadAsianBrown, leadHimalayan, leadNarmada, leadMalwa],
    opportunities: { asianBrownBackfilled: oppAsianBrown, malwaLost: oppMalwa },
    quotations: { draft: qtnDraft, sent: qtnSent, accepted: qtnAccepted },
    saleOrder: soHimalayan,
    invoices: { draft: invDraft, issued: invIssued },
    creditNote: cnDraft,
  });
}

main().catch(e => { console.error(e); process.exit(1); });
