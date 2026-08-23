// scripts/e2e-baseline.mjs — row-count + Trial Balance snapshot for the full-lifecycle E2E demo
// pass (SYSTEM.md's "run one disposable order through every department" task). Captures a much
// wider table set than any single-phase test so far, since this pass touches every module.
//
// Run: node --env-file=.env.local scripts/e2e-baseline.mjs before   > /tmp/e2e-before.json
//      node --env-file=.env.local scripts/e2e-baseline.mjs after    > /tmp/e2e-after.json
//      node --env-file=.env.local scripts/e2e-baseline.mjs diff /tmp/e2e-before.json /tmp/e2e-after.json
import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { trialBalance } from '../lib/ledger.mjs';

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN, intMode: 'number' });

const TABLES = [
  'customers', 'quotations', 'quotation_items', 'sale_orders', 'sale_order_items', 'projects',
  'milestones', 'bom_items', 'procurement_requests', 'purchase_orders', 'po_items', 'suppliers',
  'supplier_quotes', 'vendor_bills', 'vendor_bill_items', 'inventory_items', 'inventory_reservations',
  'material_issues', 'job_cards', 'job_card_time_logs', 'qc_records', 'test_certificates',
  'qc_documents', 'qc_document_parts', 'certificate_projects', 'packing_lists', 'packing_items',
  'sales_invoices', 'sales_invoice_items', 'sales_credit_notes', 'journal_entries',
  'journal_entry_lines', 'users', 'notifications', 'tasks',
];

const COMPANIES = ['Shanti Boilers', 'Shanti Techno Fab'];

async function counts() {
  const out = {};
  for (const t of TABLES) {
    try {
      const r = await db.execute(`SELECT COUNT(*) AS n FROM ${t}`);
      out[t] = r.rows[0].n;
    } catch (e) { out[t] = `ERROR: ${e.message}`; }
  }
  return out;
}

async function counters() {
  const r = await db.execute('SELECT name, value FROM counters ORDER BY name');
  return Object.fromEntries(r.rows.map(row => [row.name, row.value]));
}

async function inventorySnapshot() {
  const r = await db.execute('SELECT id, item_code, on_hand, avg_cost FROM inventory_items ORDER BY id');
  return r.rows.map(row => ({ id: row.id, item_code: row.item_code, on_hand: row.on_hand, avg_cost: row.avg_cost }));
}

async function trialBalances() {
  const out = {};
  for (const company of COMPANIES) {
    const r = await db.execute({
      sql: `SELECT coa.code AS account_code, coa.name AS account_name, coa.account_type, jel.debit, jel.credit
              FROM journal_entry_lines jel
              JOIN journal_entries je ON je.id = jel.journal_entry_id
              JOIN chart_of_accounts coa ON coa.id = jel.account_id
             WHERE je.company = ? AND je.status = 'posted'`,
      args: [company],
    });
    const tb = trialBalance(r.rows);
    out[company] = { totalDebit: tb.totalDebit, totalCredit: tb.totalCredit };
  }
  return out;
}

async function snapshot() {
  return {
    takenAt: new Date().toISOString(),
    counts: await counts(),
    counters: await counters(),
    inventory: await inventorySnapshot(),
    trialBalance: await trialBalances(),
  };
}

function diff(before, after) {
  const lines = [];
  for (const t of TABLES) {
    if (before.counts[t] !== after.counts[t]) lines.push(`counts.${t}: ${before.counts[t]} -> ${after.counts[t]}`);
  }
  const counterNames = new Set([...Object.keys(before.counters), ...Object.keys(after.counters)]);
  for (const n of counterNames) {
    if (before.counters[n] !== after.counters[n]) lines.push(`counters.${n}: ${before.counters[n]} -> ${after.counters[n]}`);
  }
  for (const company of COMPANIES) {
    const b = before.trialBalance[company], a = after.trialBalance[company];
    if (b.totalDebit !== a.totalDebit || b.totalCredit !== a.totalCredit) {
      lines.push(`trialBalance.${company}: debit ${b.totalDebit} -> ${a.totalDebit}, credit ${b.totalCredit} -> ${a.totalCredit}`);
    }
  }
  const beforeInv = new Map(before.inventory.map(i => [i.id, i]));
  for (const i of after.inventory) {
    const b = beforeInv.get(i.id);
    if (!b) { lines.push(`inventory.${i.item_code} (new row id ${i.id})`); continue; }
    if (b.on_hand !== i.on_hand || b.avg_cost !== i.avg_cost) {
      lines.push(`inventory.${i.item_code}: on_hand ${b.on_hand}->${i.on_hand}, avg_cost ${b.avg_cost}->${i.avg_cost}`);
    }
  }
  return lines;
}

const mode = process.argv[2];
if (mode === 'diff') {
  const before = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  const after = JSON.parse(readFileSync(process.argv[4], 'utf8'));
  const lines = diff(before, after);
  if (!lines.length) console.log('IDENTICAL — zero residue.');
  else { console.log(`${lines.length} difference(s):`); lines.forEach(l => console.log('  ' + l)); }
} else {
  console.log(JSON.stringify(await snapshot(), null, 2));
}
