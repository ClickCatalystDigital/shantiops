// scripts/wipe-project-data-d18.mjs — D18 cutover: wipe every project-related demo table so the app
// can be repopulated with real data. See 4.5-DATA-INVENTORY.md's "2026-08-25" section for the full
// classification/reasoning behind this exact table list.
//
// Ordering: `PRAGMA defer_foreign_keys = ON` (set first, inside the transaction) defers every FK
// check to COMMIT time instead of per-statement — so the DELETE order below doesn't need to be a
// hand-derived topological sort. This was added after the first version of this script (leaf-to-root
// order, no pragma) failed with SQLITE_CONSTRAINT: it had DELETE FROM tables in a specific order but
// had simply omitted several tables entirely (milestones, milestone_stages, packing_lists,
// bom_imports, qc_records, tasks, ncr_records — all genuinely project-related per the inventory doc,
// just dropped when that doc's prose list got transcribed into an ordered plan) — no ordering scheme
// fixes a table that's just missing from the list. The list below was verified programmatically
// against PRAGMA foreign_key_list() on every table, not hand-traced: it includes every table that
// transitively depends on `projects`/`customers`/etc., PLUS `tickets` and `addresses` — both
// originally classified as "kept" (tickets: dead, pre-collapse history; addresses: empty) but each
// has a real FK to a table being deleted here (tickets -> projects/milestones; addresses ->
// customers), so leaving them out would still fail at commit even with FKs deferred. Verified: zero
// "child kept, parent deleted" edges remain across the full FK graph for this exact table set.
//
// Does NOT touch: suppliers, items, employees, operations/workstations/trades, counters, users,
// app_settings, company_settings, holidays, system_migrations, action_permissions/approval_policies,
// chart_of_accounts, gst_rates/income_tax_slabs/professional_tax_slabs/vendor_tds_rates/
// statutory_rates, employment_types/leave_types/designations, the calc_formulas library, machines,
// stage_templates, gate_inward_receipts/gate_passes/gate_pass_items (no project_id column at all),
// inventory_items/inventory_reservations-adjacent masters, any HR/payroll/recruitment table, usb_*.
//
// One-shot, not re-runnable idempotently like the seed-*.mjs scripts (there's nothing to re-delete
// after the first run — every count will just be 0). Run: node --env-file=.env.local scripts/wipe-project-data-d18.mjs
import { createClient } from '@libsql/client';

const client = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

// Order no longer matters (defer_foreign_keys handles it) — grouped roughly leaf-to-root anyway,
// for readability, not correctness.
const TABLES = [
  'qc_document_parts', 'qc_mountings', 'certificate_projects', 'tc_item_match_approvals',
  'job_card_time_logs', 'job_card_consumables', 'work_order_operations', 'work_order_materials',
  'work_order_change_notes', 'material_issues', 'stock_pieces', 'packing_items', 'po_items',
  'pr_items', 'pr_item_projects', 'rfq_items', 'rfq_suppliers', 'vendor_bill_items',
  'sales_invoice_items', 'sales_credit_note_items', 'sale_order_items', 'quotation_items',
  'opportunity_items', 'crm_notes', 'calc_variables', 'calc_snapshots', 'calc_drawing_comments',
  'calc_drawing_files', 'bom_change_notes', 'scope_of_supply_items', 'job_work_inspections',
  'inventory_reservations', 'worker_days', 'attendance_days', 'service_call_visits',
  'purchase_debit_note_items', 'notifications', 'journal_entry_lines', 'customer_receipts',
  'vendor_payments', 'milestone_stages', 'tickets', 'addresses', 'qc_records', 'tasks',
  'ncr_records',
  // Mid-tier
  'qc_documents', 'job_cards', 'work_orders', 'purchase_orders', 'vendor_bills',
  'purchase_debit_notes', 'purchase_returns', 'purchase_requisitions', 'rfqs', 'sale_orders',
  'sales_invoices', 'sales_credit_notes', 'sales_returns', 'quotations', 'opportunities',
  'bom_items', 'supplier_quotes', 'procurement_requests', 'bom_assemblies', 'calc_sheets',
  'calc_drawings', 'scope_of_supply', 'service_calls', 'service_contracts', 'test_certificates',
  'journal_entries', 'milestones', 'bom_imports', 'packing_lists',
  // Root
  'leads', 'campaigns', 'crm_assignment_rules', 'crm_saved_views', 'contacts', 'price_lists',
  'projects', 'customers',
];

async function main() {
  const before = {};
  for (const t of TABLES) before[t] = (await client.execute(`SELECT COUNT(*) n FROM ${t}`)).rows[0].n;

  const tx = await client.transaction('write');
  try {
    await tx.execute('PRAGMA defer_foreign_keys = ON');
    for (const t of TABLES) await tx.execute(`DELETE FROM ${t}`);
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }

  let total = 0;
  for (const t of TABLES) {
    const n = Number(before[t]);
    total += n;
    console.log(`${t}\t${n}`);
  }
  console.log(`\nTotal rows deleted: ${total}`);
}

main().catch(e => { console.error(e); process.exit(1); });
