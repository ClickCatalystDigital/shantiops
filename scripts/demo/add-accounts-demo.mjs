// Public demo: the accounting records the seed leaves empty, so every Accounts report shows real numbers.
//   - owner's capital and a term loan (new account 2700) that pay for the plant
//   - 5 fixed assets (plant, crane, welding sets, shed, vehicle) and a depreciation run for every month since purchase
//   - GSTR-1 and GSTR-3B marked filed for the last two months
//   - Bank & Cash lines older than 7 days marked reconciled (the last week stays open, as at a real month-end)
//   - GSTR-2B lines for past months' supplier bills, so ITC reconciliation shows matches
// Through the app's own routes (BASE), dates relative to today, so the nightly date shift keeps them current.
// Idempotent: assets by name, filings upsert, depreciation runs and 2B lines skip what exists.
//   DB_URL=… DB_TOKEN=… BASE=… ADMIN_PASSWORD=… node scripts/demo/add-accounts-demo.mjs
import { createClient } from '@libsql/client';

const { DB_URL, DB_TOKEN, BASE, ADMIN_PASSWORD } = process.env;
const db = createClient({ url: DB_URL, authToken: DB_TOKEN || undefined, intMode: 'number' });
const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;
if (!(await q("SELECT 1 FROM sqlite_master WHERE name = 'demo_meta'")).length) throw new Error('Not a demo database');
const [{ company }] = await q('SELECT company FROM company_settings ORDER BY id LIMIT 1');

const login = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: ADMIN_PASSWORD }) });
const cookie = login.headers.get('set-cookie')?.split(';')[0];
if (!login.ok || !cookie) throw new Error('login failed');
const api = async (method, path, body) => {
  const r = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body && JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : {};
};
const ist = d => new Date(d.getTime() + 5.5 * 3600e3);
const today = ist(new Date());
const monthsAgo = n => { const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - n, 1)); return d; };
const iso = d => d.toISOString().slice(0, 10);
const ym = d => d.toISOString().slice(0, 7);

// 0. How the plant was paid for: owner's capital and a bank term loan, posted before the first asset, so the
//    bank balance stays positive. Recorded once (found by description).
const FUNDING = [
  { description: "Owner's capital introduced", ago: 16, lines: [{ accountCode: '1001', debit: 5000000 }, { accountCode: '3100', credit: 5000000 }] },
  { description: 'Term loan for plant and machinery, State Bank of India', ago: 15, lines: [{ accountCode: '1001', debit: 9000000 }, { accountCode: '2700', credit: 9000000 }] },
];
if (!(await q("SELECT 1 FROM chart_of_accounts WHERE company = ? AND code = '2700'", [company])).length)
  await api('POST', '/api/chart-of-accounts', { company, code: '2700', name: 'Term Loan', account_type: 'liability' });
for (const f of FUNDING) {
  if ((await q('SELECT 1 FROM journal_entries WHERE company = ? AND description = ?', [company, f.description])).length) continue;
  const je = await api('POST', '/api/journal-entries', { company, entry_date: iso(new Date(monthsAgo(f.ago).getTime() + 2 * 86400e3)), description: f.description, lines: f.lines });
  await api('PATCH', `/api/journal-entries/${je.id ?? je.entry?.id}`, { action: 'post' });
}
console.log('funding entries ready');

// 1. Fixed assets
const ASSETS = [
  { name: 'Plate Rolling Machine 3-Roll 3000 x 20 mm', category: 'Plant & Machinery', cost: 2850000, salvage_value: 150000, useful_life_years: 15, method: 'SLM', ago: 14 },
  { name: 'EOT Crane 10 T, 18 m Span', category: 'Plant & Machinery', cost: 1650000, salvage_value: 80000, useful_life_years: 15, method: 'SLM', ago: 11 },
  { name: 'Welding Rectifiers 400 A (set of 6)', category: 'Plant & Machinery', cost: 540000, salvage_value: 20000, useful_life_years: 10, method: 'SLM', ago: 8 },
  { name: 'Fabrication Shed Extension, Bay 2', category: 'Buildings', cost: 4200000, salvage_value: 200000, useful_life_years: 30, method: 'SLM', ago: 13 },
  { name: 'Delivery Truck, 10 T', category: 'Vehicles', cost: 1950000, salvage_value: 100000, useful_life_years: 8, method: 'WDV', ago: 6 },
];
const existing = new Set((await q('SELECT name FROM fixed_assets')).map(r => r.name));
let added = 0;
for (const a of ASSETS) {
  if (existing.has(a.name)) continue;
  const { ago, ...body } = a;
  await api('POST', '/api/fixed-assets', { ...body, company, purchase_date: iso(new Date(monthsAgo(ago).getTime() + 9 * 86400e3)) });
  added++;
}
console.log(`fixed assets added: ${added}`);
// Depreciation for each month from the oldest purchase to last month, oldest first.
const done = new Set((await q('SELECT period_year || \'-\' || period_month k FROM depreciation_runs WHERE company = ?', [company])).map(r => r.k));
let runs = 0;
for (let n = Math.max(...ASSETS.map(a => a.ago)); n >= 1; n--) {
  const d = monthsAgo(n), y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  if (done.has(`${y}-${m}`)) continue;
  const end = new Date(Date.UTC(y, m, 0));
  await api('POST', '/api/fixed-assets/depreciation-run', { company, period_year: y, period_month: m, run_date: iso(end) });
  runs++;
}
console.log(`depreciation runs: ${runs}`);

// 2. GST returns filed for the last two months
for (const n of [1, 2]) for (const return_type of ['GSTR1', 'GSTR3B']) await api('POST', '/api/gst-filings', { company, period: ym(monthsAgo(n)), return_type });
console.log('GST filings marked for', ym(monthsAgo(2)), ym(monthsAgo(1)));

// 3. GSTR-2B lines for supplier bills of every past month (the current month's 2B isn't out yet), so ITC
//    reconciliation shows matches; ITC available, accepted by default.
const thisMonth = ym(today);
const bills = await q(`SELECT vb.bill_no, vb.bill_date, vb.subtotal, vb.cgst_amount, vb.sgst_amount, vb.igst_amount, vb.total, s.gst_no, s.name
  FROM vendor_bills vb JOIN purchase_orders po ON po.id = vb.po_id JOIN suppliers s ON s.id = po.supplier_id
  WHERE substr(vb.bill_date, 1, 7) < ?`, [thisMonth]);
const have2b = new Set((await q('SELECT period || \'|\' || invoice_no k FROM gstr2b_lines WHERE company = ?', [company])).map(r => r.k));
let lines2b = 0;
for (const b of bills) {
  const period = b.bill_date.slice(0, 7);
  if (have2b.has(`${period}|${b.bill_no}`)) continue;
  await api('POST', '/api/gstr2b', { company, period, supplier_gstin: b.gst_no || '', supplier_name: b.name, invoice_no: b.bill_no, invoice_date: b.bill_date,
    invoice_value: b.total, taxable_value: b.subtotal, cgst: b.cgst_amount, sgst: b.sgst_amount, igst: b.igst_amount, cess: 0, itc_availability: 'Yes' });
  lines2b++;
}
console.log(`GSTR-2B lines added: ${lines2b} (bills before ${thisMonth}: ${bills.length})`);

// 4. Bank reconciliation: everything older than a week is on the statement
const cutoff = iso(new Date(today.getTime() - 7 * 86400e3));
const open = await q(`SELECT l.id FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id JOIN chart_of_accounts a ON a.id = l.account_id
  WHERE e.company = ? AND e.status = 'posted' AND a.code = '1001' AND COALESCE(l.reconciled, 0) = 0 AND e.entry_date <= ?`, [company, cutoff]);
for (const l of open) await api('PATCH', `/api/journal-entry-lines/${l.id}/reconcile`, { reconciled: true });
console.log(`bank lines reconciled: ${open.length}`);
