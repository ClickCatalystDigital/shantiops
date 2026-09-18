// scripts/import-sales-tracker.mjs — one-off import of the legacy "Order & Payments Tracker" Excel
// (sheets ORDER + PAYMENT) into sale_orders / sale_order_payments.
//   node --env-file=.env.local scripts/import-sales-tracker.mjs <file.xlsx>           # dry run, writes nothing
//   node --env-file=.env.local scripts/import-sales-tracker.mjs <file.xlsx> --apply   # cleanup + import
// Payments sheet is the source of truth for money; the ORDER sheet's Received/Pending columns are
// formulas and are only used to report mismatches. Rollback: everything imported is tagged
// created_by = TAG (orders + payments).
import XLSX from 'xlsx';
import fs from 'fs';
import { createClient } from '@libsql/client';

const file = process.argv[2];
const APPLY = process.argv.includes('--apply');
const TAG = 'import:sales-tracker-2026-09-19';
const COMPANY = 'Shanti Boilers';
const TEST_SO = { 37: 'SO-22', 38: 'SO-23', 39: 'SO-24' }; // id → so_no, verified before delete
const STAGE_COLS = ['advance', 'dispatched', 'site_completed', 'commissioning', 'pending_issue', 'cleared_issue']; // sheet cols 11..16
const MODES = ['NEFT/IMPS', 'Cash', 'Cheque', 'Paytm', 'Credit note', 'Debit Note', 'Other'];
const PEOPLE = ['BDM', 'Amit B', 'Devansh B', 'Sales Desk', 'Sales - AP', 'Sales - KAR', 'Sales - MH', 'Bachan', 'Ojha', 'Namdev', 'Upender', 'TELE CALLER'];
const PERSON_ALIAS = { amt: 'Amit B', abt: 'Amit B', amit: 'Amit B', amitb: 'Amit B' }; // obvious typos of Amit B
const STATUS = { DISPATCHED: 'Dispatched', CLOSED: 'Closed', WIP: 'WIP', READY: 'Ready', PENDING: 'Pending' };

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql, args = []) => (await db.execute({ sql, args })).rows.map(r => ({ ...r }));

// ---------- helpers ----------
const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const nkey = v => clean(v).replace(/\s+/g, '').toUpperCase();
const num = v => { if (typeof v === 'number') return v; const n = parseFloat(String(v ?? '').replace(/[₹,\s]/g, '')); return Number.isFinite(n) ? n : 0; };
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = n => String(n).padStart(2, '0');
// Excel dates arrive as local-midnight Date objects; +12h then UTC getters is timezone-proof.
function iso(v) {
  if (v instanceof Date && !isNaN(v)) { const d = new Date(v.getTime() + 12 * 3600e3); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
  const s = clean(v); let m;
  if ((m = /^(\d{1,2})-([A-Za-z]{3})[a-z]*-(\d{4})$/.exec(s)) && MON[m[2].toLowerCase()]) return `${m[3]}-${pad(MON[m[2].toLowerCase()])}-${pad(m[1])}`;
  if ((m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s))) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return null;
}
const canonId = v => clean(v).replace(/\s*-\s*/g, '-');
const ticked = v => v === true || /^true$/i.test(String(v));

// ---------- parse ----------
const wb = XLSX.read(fs.readFileSync(file), { cellDates: true });
const grid = n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: true });
const O = grid('ORDER').slice(7).filter(r => clean(r[1]));
const P = grid('PAYMENT').slice(1); // row 0 is a (corrupted) header

const orders = [];
const byKey = new Map();
const dupes = [];
for (const r of O) {
  let so_no = canonId(r[1]);
  const key = nkey(r[1]);
  if (byKey.has(key)) { dupes.push({ id: so_no, customer: clean(r[2]) }); so_no = `${so_no} (2)`; }
  const status = STATUS[clean(r[5]).toUpperCase()] || 'Pending';
  const person = clean(r[4]);
  const personKey = person.toLowerCase().replace(/\s+/g, ' ');
  const sales_person = !person ? 'Unassigned'
    : PERSON_ALIAS[personKey.replace(/\s/g, '')] || PEOPLE.find(p => p.toLowerCase() === personKey) || person;
  const remarks = [clean(r[9]), clean(r[19])].filter(Boolean).join(' | ') || null;
  const o = {
    so_no, key, customer: clean(r[2]) || null, invoice_ref: clean(r[3]) && clean(r[3]) !== '?' ? clean(r[3]) : null,
    sales_person, raw_person: person, status, legacy: ['Dispatched', 'Closed'].includes(status) ? 'fulfilled' : 'open',
    total: num(r[6]), sheet_received: num(r[7]), date: iso(r[0]), sheetUndated: !iso(r[0]), remarks,
    stages: STAGE_COLS.map((_, i) => ticked(r[11 + i])),
  };
  orders.push(o);
  if (!byKey.has(key)) byKey.set(key, o);
}

const payments = [], skipped = { noOrderId: [], noAmount: [], orphan: [] };
const modeFix = new Map();
for (const r of P) {
  if (!r.slice(0, 8).some(v => clean(v) && !String(v).startsWith('#'))) continue;
  const amount = num(r[7]);
  if (!clean(r[0])) { skipped.noOrderId.push(amount); continue; }
  if (!(amount > 0)) { skipped.noAmount.push(canonId(r[0])); continue; }
  const o = byKey.get(nkey(r[0]));
  if (!o) { skipped.orphan.push({ id: canonId(r[0]), amount }); continue; }
  const m0 = clean(r[5]); const mk = m0.toLowerCase().replace(/[^a-z/ ]/g, '').trim();
  const mode = !m0 ? null : MODES.find(m => m.toLowerCase() === mk) || (mk.startsWith('neft') ? 'NEFT/IMPS' : 'Other');
  if (m0 && mode !== m0) modeFix.set(`${m0} → ${mode}`, (modeFix.get(`${m0} → ${mode}`) || 0) + 1);
  payments.push({ order: o, date: iso(r[4]), mode, amount, remark: clean(r[6]) || null, invoice_ref: clean(r[3]) || null, rawDate: r[4] });
}

// dates fall back to the earliest payment date; else stay unknown
const earliest = new Map();
for (const p of payments) if (p.date && (!earliest.get(p.order) || p.date < earliest.get(p.order))) earliest.set(p.order, p.date);
let dateFromPayment = 0, undated = 0;
for (const o of orders) if (!o.date) { if (earliest.has(o)) { o.date = earliest.get(o); dateFromPayment++; } else undated++; }

// customers
const custs = await q('SELECT id, name FROM customers');
const cnorm = s => clean(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
const cmap = new Map(custs.map(c => [cnorm(c.name), c.id]));
const hkm = cmap.get('HKMCHARITABLEFOUNDATION');
const unmatched = new Map();
for (const o of orders) {
  o.customer_id = /^HKM\b/i.test(o.customer || '') && hkm ? hkm : cmap.get(cnorm(o.customer)) || null;
  if (o.customer && !o.customer_id) unmatched.set(o.customer, (unmatched.get(o.customer) || 0) + 1);
}

// received reconciliation
const got = new Map();
for (const p of payments) got.set(p.order, (got.get(p.order) || 0) + p.amount);
const mismatch = orders.filter(o => Math.abs((got.get(o) || 0) - o.sheet_received) >= 1);

// date-parse self check: parsed ISO must equal the sheet's own formatted text
const fmtRows = XLSX.utils.sheet_to_json(wb.Sheets['PAYMENT'], { header: 1, defval: '', raw: false }).slice(1);
let dateChecked = 0, dateBad = 0;
P.forEach((r, i) => { const f = clean(fmtRows[i]?.[4]); if (r[4] instanceof Date && /^\d{1,2}-[A-Za-z]{3}-\d{4}$/.test(f)) { dateChecked++; if (iso(r[4]) !== iso(f)) dateBad++; } });

// ---------- report ----------
const sum = (a, f) => a.reduce((n, x) => n + f(x), 0);
const top = (m, n = 8) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
console.log(`\nORDERS   to import: ${orders.length}   total value: ${sum(orders, o => o.total).toLocaleString('en-IN')}`);
console.log(`  by status:`, JSON.stringify(Object.fromEntries(Object.keys(STATUS).map(k => [STATUS[k], orders.filter(o => o.status === STATUS[k]).length]))));
console.log(`  legacy status → fulfilled: ${orders.filter(o => o.legacy === 'fulfilled').length}, open: ${orders.filter(o => o.legacy === 'open').length}`);
console.log(`  duplicate Order IDs (2nd gets " (2)"): ${JSON.stringify(dupes)}`);
console.log(`  no date in sheet: ${dateFromPayment + undated} → earliest-payment date used for ${dateFromPayment}, still undated ${undated}`);
console.log(`  customer linked to customers table: ${orders.filter(o => o.customer_id).length}  (HKM rows → #${hkm}: ${orders.filter(o => o.customer_id === hkm).length})`);
console.log(`  customer names with no match: ${unmatched.size} distinct / ${sum([...unmatched.values()].map(n => ({ n })), x => x.n)} orders; top:`, JSON.stringify(top(unmatched, 6)));
console.log(`  sales person mapped:`, JSON.stringify(top(new Map(orders.filter(o => o.raw_person && o.raw_person !== o.sales_person).map(o => [`${o.raw_person} → ${o.sales_person}`, 1])), 12)), ` blank → Unassigned: ${orders.filter(o => !o.raw_person).length}`);
console.log(`  sheet's own Payment Received column sums to ${sum(orders, o => o.sheet_received).toLocaleString('en-IN')}; value of orders with no date in sheet: ${sum(orders.filter(o => o.sheetUndated), o => o.total).toLocaleString('en-IN')}`);
console.log(`\nPAYMENTS to import: ${payments.length}   total: ${sum(payments, p => p.amount).toLocaleString('en-IN')}`);
console.log(`  no date recorded: ${payments.filter(p => !p.date).length} (imported with blank date)`);
console.log(`  mode cleaned:`, JSON.stringify([...modeFix]));
console.log(`  SKIPPED  no Order ID: ${skipped.noOrderId.length} rows, ${sum(skipped.noOrderId.map(a => ({ a })), x => x.a).toLocaleString('en-IN')} | no amount: ${skipped.noAmount.length} | order not in ORDER sheet: ${JSON.stringify(skipped.orphan)}`);
console.log(`\nRECONCILE  orders whose sheet "Payment Received" ≠ sum of PAYMENT rows: ${mismatch.length} of ${orders.length}`);
mismatch.slice(0, 12).forEach(o => console.log(`  ${o.so_no.padEnd(18)} sheet ${o.sheet_received.toLocaleString('en-IN')}  payments ${(got.get(o) || 0).toLocaleString('en-IN')}`));
console.log(`\nSELF-CHECK date parsing: ${dateChecked} payment dates compared with the sheet's own text, ${dateBad} mismatches`);

// what blocks/needs care when removing the 3 test orders
const refs = [];
for (const t of await q("SELECT name FROM sqlite_master WHERE type='table'")) {
  for (const fk of await q(`PRAGMA foreign_key_list(${t.name})`)) if (['sale_orders', 'sale_order_items'].includes(fk.table)) refs.push([t.name, fk.from, fk.table]);
}
const ids = Object.keys(TEST_SO).join(',');
const hits = new Set(); // tables that really hold rows pointing at the test orders
console.log(`\nTEST DATA to remove (SO ids ${ids}) — referencing rows:`);
for (const [t, col, parent] of refs) {
  const n = (await q(parent === 'sale_orders'
    ? `SELECT COUNT(*) n FROM ${t} WHERE ${col} IN (${ids})`
    : `SELECT COUNT(*) n FROM ${t} WHERE ${col} IN (SELECT id FROM sale_order_items WHERE sale_order_id IN (${ids}))`))[0].n;
  if (n) { hits.add(t); console.log(`  ${t}.${col} → ${parent}: ${n}`); }
}

if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply to clean up test data and import.'); process.exit(0); }
if (dateBad) { console.error('Date self-check failed — aborting.'); process.exit(1); }

// ---------- apply ----------
const soRows = await q(`SELECT id, so_no FROM sale_orders WHERE id IN (${ids})`);
for (const r of soRows) if (TEST_SO[r.id] !== r.so_no) { console.error(`Refusing: id ${r.id} is ${r.so_no}, expected ${TEST_SO[r.id]}`); process.exit(1); }
const known = new Set(['projects', 'scope_of_supply_items', 'sale_order_payments', 'sale_order_items', 'sales_invoices', 'sales_returns', 'work_orders', 'quotations']);
for (const t of hits) if (!known.has(t)) { console.error(`Unexpected referencing table ${t} — review before deleting.`); process.exit(1); }

await db.batch([
  { sql: `UPDATE projects SET sale_order_id = NULL WHERE sale_order_id IN (${ids})`, args: [] },
  { sql: `UPDATE scope_of_supply_items SET sale_order_item_id = NULL WHERE sale_order_item_id IN (SELECT id FROM sale_order_items WHERE sale_order_id IN (${ids}))`, args: [] },
  { sql: `DELETE FROM sale_order_payments WHERE sale_order_id IN (${ids})`, args: [] },
  { sql: `DELETE FROM sale_order_items WHERE sale_order_id IN (${ids})`, args: [] },
  { sql: `DELETE FROM sale_orders WHERE id IN (${ids})`, args: [] },
  // received_on is now nullable + invoice_ref exists: recreate (table holds no real rows any more)
  { sql: 'DROP TABLE IF EXISTS sale_order_payments', args: [] },
  { sql: `CREATE TABLE sale_order_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_order_id INTEGER NOT NULL REFERENCES sale_orders(id),
    sales_invoice_id INTEGER REFERENCES sales_invoices(id),
    invoice_ref TEXT,
    received_on DATE,
    mode TEXT,
    amount REAL NOT NULL,
    remark TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, args: [] },
  { sql: 'CREATE INDEX IF NOT EXISTS idx_sale_order_payments_so ON sale_order_payments(sale_order_id)', args: [] },
], 'write');
console.log('\nTest data removed.');

const CH = 150;
for (let i = 0; i < orders.length; i += CH) {
  await db.batch(orders.slice(i, i + CH).map(o => ({
    sql: `INSERT INTO sale_orders (so_no, customer_name, customer_id, status, company, total, created_by, created_at, order_date, invoice_ref, sales_person_override, remarks, track_status,
            stage_advance, stage_dispatched, stage_site_completed, stage_commissioning, stage_pending_issue, stage_cleared_issue)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [o.so_no, o.customer, o.customer_id, o.legacy, COMPANY, o.total, TAG, o.date ? `${o.date} 00:00:00` : null, o.date, o.invoice_ref, o.sales_person, o.remarks, o.status, ...o.stages.map(Number)],
  })), 'write');
}
const idBySo = new Map((await q('SELECT id, so_no FROM sale_orders')).map(r => [r.so_no, r.id]));
for (let i = 0; i < payments.length; i += CH) {
  await db.batch(payments.slice(i, i + CH).map(p => ({
    sql: 'INSERT INTO sale_order_payments (sale_order_id, invoice_ref, received_on, mode, amount, remark, created_by) VALUES (?,?,?,?,?,?,?)',
    args: [idBySo.get(p.order.so_no), p.invoice_ref, p.date, p.mode, p.amount, p.remark, TAG],
  })), 'write');
}
try { await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_sale_orders_so_no ON sale_orders(so_no)'); console.log('Unique index on so_no created.'); } catch (e) { console.log('Unique index NOT created:', e.message); }
await db.execute({ sql: 'INSERT INTO usb_audit (actor, action, detail) VALUES (?,?,?)', args: ['system:import', 'sales_tracker_import', `${orders.length} orders, ${payments.length} payments`] });

const [{ n: no }] = await q('SELECT COUNT(*) n FROM sale_orders'); const [{ n: np, s }] = await q('SELECT COUNT(*) n, SUM(amount) s FROM sale_order_payments');
console.log(`Imported. sale_orders now ${no}; sale_order_payments ${np}, total ${Number(s).toLocaleString('en-IN')}.`);
console.log(`Rollback: DELETE FROM sale_order_payments WHERE created_by='${TAG}'; DELETE FROM sale_orders WHERE created_by='${TAG}';`);
