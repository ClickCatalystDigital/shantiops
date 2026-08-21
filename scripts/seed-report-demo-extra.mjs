// scripts/seed-report-demo-extra.mjs — additive seed data to give the Report Engine (REPORT-ENGINE-
// PLAN.md) more than one supplier/PO to show in Purchase Register / Vendor Ledger / AP Aging (the
// live DB had exactly 1 purchase_orders row and 2 vendor_bills before this). Same additive
// precedent as scripts/seed-sales-marketing-demo.mjs: only ever touches its own marked rows
// (created_by = MARK), re-runnable (deletes its own rows first), never touches anything else.
//
// Run: node --env-file=.env.local scripts/seed-report-demo-extra.mjs
import { createClient } from '@libsql/client';

const MARK = 'report-demo-seed';
const client = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

async function run(sql, args = []) { return client.execute({ sql, args }); }
async function insert(sql, args = []) { return (await run(sql, args)).lastInsertRowid; }

// Clean up previous runs (children first for FKs).
await run(`DELETE FROM vendor_payments WHERE vendor_bill_id IN (SELECT id FROM vendor_bills WHERE created_by = ?)`, [MARK]);
await run(`DELETE FROM vendor_bill_items WHERE vendor_bill_id IN (SELECT id FROM vendor_bills WHERE created_by = ?)`, [MARK]);
await run(`DELETE FROM vendor_bills WHERE created_by = ?`, [MARK]);
await run(`DELETE FROM po_items WHERE po_id IN (SELECT id FROM purchase_orders WHERE created_by = ?)`, [MARK]);
await run(`DELETE FROM purchase_orders WHERE created_by = ?`, [MARK]);

const { rows: suppliers } = await run(`SELECT id, name, state_code FROM suppliers WHERE name IN ('A R ENGINEERING SOLUTION', '3D FOAMCUT PRIVATE LIMITED')`);
const arEng = suppliers.find(s => s.name.startsWith('A R'));
const foamcut = suppliers.find(s => s.name.startsWith('3D'));
if (!arEng || !foamcut) throw new Error('Expected seed suppliers not found');

// PO 1 -> issued -> billed -> paid in full (A R Engineering, intrastate: Telangana 36 either side).
const po1 = await insert(
  `INSERT INTO purchase_orders (po_no, supplier_id, quote_source, quote_date, payment_terms, status, issued_at, created_by)
   VALUES (?,?,?,?,?,?,?,?)`,
  ['DEMO-PO-1/SB/2026-27', arEng.id, 'Verbal', '2026-08-10', '30 days', 'issued', '2026-08-12 10:00:00', MARK]
);
await run(
  `INSERT INTO po_items (po_id, description, qty, uom, rate, amount, sort_order) VALUES (?,?,?,?,?,?,?)`,
  [po1, 'MS Angle 40x40x5', 200, 'Kg', 65, 13000, 0]
);
const bill1 = await insert(
  `INSERT INTO vendor_bills (bill_no, po_id, company, bill_date, due_date, status, subtotal, cgst_amount, sgst_amount, tax_amount, total, payable_amount, created_by)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ['DEMO-BILL-1', po1, 'Shanti Boilers', '2026-08-13', '2026-09-12', 'paid', 13000, 1170, 1170, 2340, 15340, 15340, MARK]
);
await run(
  `INSERT INTO vendor_bill_items (vendor_bill_id, item_description, qty, uom, rate, amount, gst_rate_pct, sort_order) VALUES (?,?,?,?,?,?,?,?)`,
  [bill1, 'MS Angle 40x40x5', 200, 'Kg', 65, 13000, 18, 0]
);
await run(
  `INSERT INTO vendor_payments (payment_no, vendor_bill_id, company, payment_date, amount, payment_mode, created_by)
   VALUES (?,?,?,?,?,?,?)`,
  ['DEMO-PAY-1', bill1, 'Shanti Boilers', '2026-08-18', 15340, 'NEFT', MARK]
);

// PO 2 -> issued -> billed, unpaid (3D Foamcut) — gives AP Aging / Purchase Register a second open item.
const po2 = await insert(
  `INSERT INTO purchase_orders (po_no, supplier_id, quote_source, quote_date, payment_terms, status, issued_at, created_by)
   VALUES (?,?,?,?,?,?,?,?)`,
  ['DEMO-PO-2/SB/2026-27', foamcut.id, 'Verbal', '2026-08-14', '30 days', 'issued', '2026-08-15 09:00:00', MARK]
);
await run(
  `INSERT INTO po_items (po_id, description, qty, uom, rate, amount, sort_order) VALUES (?,?,?,?,?,?,?)`,
  [po2, 'Packing Foam Sheets', 50, 'Nos', 300, 15000, 0]
);
const bill2 = await insert(
  `INSERT INTO vendor_bills (bill_no, po_id, company, bill_date, due_date, status, subtotal, cgst_amount, sgst_amount, tax_amount, total, payable_amount, created_by)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ['DEMO-BILL-2', po2, 'Shanti Boilers', '2026-08-16', '2026-09-15', 'approved', 15000, 1350, 1350, 2700, 17700, 17700, MARK]
);
await run(
  `INSERT INTO vendor_bill_items (vendor_bill_id, item_description, qty, uom, rate, amount, gst_rate_pct, sort_order) VALUES (?,?,?,?,?,?,?,?)`,
  [bill2, 'Packing Foam Sheets', 50, 'Nos', 300, 15000, 18, 0]
);

console.log('Seeded: 2 POs, 2 vendor bills (1 paid, 1 open), 1 payment.');
