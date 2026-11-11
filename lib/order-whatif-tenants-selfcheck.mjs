// Two-tenant isolation self-check for the order what-if (market-intel plan D8). Two separate local SQLite files hold synthetic
// orders for tenant A and tenant B (never a real database; TURSO_URL is cleared). Each is opened ONE AT A TIME, the what-if is
// computed from its own records, and the outputs must contain only that tenant's values and no state may carry over.
import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeWhatIf, prefillFromRecords, loadRecords, WhatIfError } from './order-whatif.mjs';

if (process.env.TURSO_URL) { console.log('FAIL TURSO_URL must be empty for this check'); process.exit(1); }
let failed = 0;
const fail = (m) => { failed += 1; console.log('FAIL ' + m); };
const dir = mkdtempSync(join(tmpdir(), 'whatif-tenants-'));
const SCHEMA = [
  'CREATE TABLE quotations (id INTEGER PRIMARY KEY, quotation_date DATE)',
  'CREATE TABLE sale_orders (id INTEGER PRIMARY KEY, so_no TEXT, quotation_id INTEGER, status TEXT, total REAL, order_date DATE)',
  'CREATE TABLE projects (id INTEGER PRIMARY KEY, sale_order_id INTEGER)',
  'CREATE TABLE purchase_orders (id INTEGER PRIMARY KEY, status TEXT, issued_at DATETIME)',
  'CREATE TABLE po_items (id INTEGER PRIMARY KEY, po_id INTEGER, project_id INTEGER, description TEXT, qty REAL, uom TEXT, rate REAL, amount REAL)',
];
const TENANTS = {
  A: { so: 'SO-A1', total: 1234567, qty: 11.1, rate: 4111, now: 4999 },
  B: { so: 'SO-B1', total: 7654321, qty: 77.7, rate: 6222, now: 5333 },
};

async function seed(name, t) {
  const c = createClient({ url: `file:${join(dir, name + '.db')}` });
  for (const s of SCHEMA) await c.execute(s);
  await c.execute({ sql: 'INSERT INTO quotations VALUES (1, ?)', args: ['2026-01-10'] });
  await c.execute({ sql: "INSERT INTO sale_orders VALUES (1, ?, 1, 'open', ?, '2026-02-01')", args: [t.so, t.total] });
  await c.execute('INSERT INTO projects VALUES (1, 1)');
  await c.execute("INSERT INTO purchase_orders VALUES (1, 'issued', '2026-04-15 10:00:00')");
  await c.execute({ sql: "INSERT INTO po_items VALUES (1, 1, 1, 'IS 2062 Plate 12mm', ?, 't', ?, ?)", args: [t.qty, t.rate, t.qty * t.rate] });
  c.close();
}

// one tenant: open its file, load its own records read-only, compute, close. The figures the person would type come from the tenant.
async function run(name, soNo = TENANTS[name].so) {
  const t = TENANTS[name];
  const c = createClient({ url: `file:${join(dir, name + '.db')}` });
  try {
    const q = async (sql, args = []) => (await c.execute({ sql, args })).rows;
    const records = await loadRecords(async (sql, args) => (await q(sql, args))[0] ?? null, q, soNo);
    const pre = prefillFromRecords(records);
    const result = computeWhatIf({
      label: 'customer_entered', currency: 'INR', order_value: pre.order_value, provenance: pre.provenance,
      steel: { open_qty: t.qty, unit: 't', quote_rate: t.rate, now_rate: t.now, scenarios: { low: t.rate, base: t.now, high: t.now * 1.1 } },
      timeline: { advance: 0.1, materials: 0.8, other_costs: 0.15, retention: 0, now_month: 0, planned_purchase_month: 2, fabrication_months: 3, collection_delay: 1, retention_delay: 0 },
      annual_rate_pct: 12,
    });
    return { pre, text: JSON.stringify({ pre, result }) };
  } finally { c.close(); }
}

try {
  for (const [n, t] of Object.entries(TENANTS)) await seed(n, t);
  const a1 = await run('A'); const b = await run('B'); const a2 = await run('A');
  if (a1.text !== a2.text) fail('tenant A gave different output after tenant B was processed: state carried over');
  for (const u of ['1234567', '4111', '4999', '11.1', 'SO-A1']) { if (!a1.text.includes(u)) fail(`tenant A output lacks its own value ${u}`); if (b.text.includes(u)) fail(`tenant B output contains tenant A's value ${u}`); }
  for (const u of ['7654321', '6222', '5333', '77.7', 'SO-B1']) { if (!b.text.includes(u)) fail(`tenant B output lacks its own value ${u}`); if (a1.text.includes(u)) fail(`tenant A output contains tenant B's value ${u}`); }
  if (a1.pre.order_value !== 1234567 || a1.pre.provenance.order_value !== 'erp_record') fail('tenant A prefill is wrong');
  try { await run('A', 'SO-B1'); fail("tenant A's database answered for tenant B's order"); } catch (e) { if (!(e instanceof WhatIfError) || !/no sale order/.test(e.message)) fail(`wrong error for a cross-tenant order: ${e.message}`); }
  // the loader only reads
  const src = readFileSync(new URL('./order-whatif.mjs', import.meta.url), 'utf8').toLowerCase();
  const sqlText = src.slice(src.indexOf('export async function loadrecords'));
  for (const w of ['insert ', 'update ', 'delete ', 'drop ', 'alter ', 'create ']) if (sqlText.includes(w)) fail(`loadRecords must only read (found "${w.trim()}")`);
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log(failed ? `order what-if tenants: ${failed} failure(s)` : 'order what-if tenants: ok (two tenants, separate files, no leakage, no carried state, read-only)');
process.exit(failed ? 1 : 0);
