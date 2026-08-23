// scripts/seed-design-dispatch-procurement-demo.mjs — additive seed data for 3 departments whose
// Reports were confirmed thin by a live row-count pass against the dev DB (not assumed): Design
// (bom_change_notes at 1 row — ECN Register would show almost nothing), Dispatch (packing_lists at
// 3 rows total, shared by all 4 Dispatch reports), Procurement (purchase_orders at 3 rows — Purchase
// Register and Open PO Aging both sparse). Three small, unrelated scopes in one file, each cleaned
// independently by its own tag — same reasoning as keeping QC/Production/Sales seed scripts separate
// files, just small enough here to not warrant 3 files. Same additive/re-runnable precedent as
// scripts/seed-report-demo-extra.mjs throughout.
//
// Also flips 3 existing 'Enquiry' bom_items to 'Transit' (tied to the new POs below) — filling a
// real procurement workflow state, not fabricating unrelated data, needed for Open PO Aging
// (lib/data.js's getOpenPoAgingLines) to have anything to show at all.
//
// Run: node --env-file=.env.local scripts/seed-design-dispatch-procurement-demo.mjs
import { createClient } from '@libsql/client';

const MARK = 'design-dispatch-procurement-demo-seed';
const client = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

async function run(sql, args = []) { return client.execute({ sql, args }); }
async function insert(sql, args = []) { return (await run(sql, args)).lastInsertRowid; }
function daysFromNow(n) { return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10); }
function dtFromNow(n) { return new Date(Date.now() + n * 86400000).toISOString().slice(0, 19).replace('T', ' '); }

// --- Clean up previous runs (children first for FKs). ------------------------------------------
await run(`DELETE FROM bom_change_notes WHERE requested_by = ?`, [MARK]);
await run(`DELETE FROM packing_items WHERE packing_list_id IN (SELECT id FROM packing_lists WHERE created_by = ?)`, [MARK]);
await run(`DELETE FROM packing_lists WHERE created_by = ?`, [MARK]);
await run(`DELETE FROM vendor_bill_items WHERE vendor_bill_id IN (SELECT id FROM vendor_bills WHERE created_by = ?)`, [MARK]);
await run(`DELETE FROM vendor_bills WHERE created_by = ?`, [MARK]);
await run(`DELETE FROM po_items WHERE po_id IN (SELECT id FROM purchase_orders WHERE created_by = ?)`, [MARK]);
await run(`DELETE FROM purchase_orders WHERE created_by = ?`, [MARK]);

const { rows: projects } = await run(
  `SELECT id, project_no FROM projects WHERE project_no IN ('SB-1023','SB-1024','SB-1025','SB-1027','SB-1029')`
);
const P = Object.fromEntries(projects.map(p => [p.project_no, p.id]));
for (const no of ['SB-1023', 'SB-1024', 'SB-1025', 'SB-1027', 'SB-1029']) {
  if (!P[no]) throw new Error(`Expected seed project ${no} not found`);
}

// === Design — ECN Register (bom_change_notes) ====================================================
const ecnRows = [
  [P['SB-1023'], 'moc', 'MS', 'SS304', 'Customer upgraded shell material for corrosion resistance', 'approved'],
  [P['SB-1023'], 'size_spec', 'ISA 40X40X4', 'ISA 50X50X5', 'Structural review required a heavier angle section', 'approved'],
  [P['SB-1024'], 'qty_text', '4 Nos', '6 Nos', 'Additional mounting brackets needed per revised GA drawing', 'approved'],
  [P['SB-1024'], 'make', 'Generic', 'WIKA', 'Customer specified gauge make in final PO', 'rejected'],
  [P['SB-1025'], 'size_spec', '1/2" x 12"', '1/2" x 14"', 'Level gauge length increased for revised shell height', 'rejected'],
  [P['SB-1025'], 'moc', 'CS', 'SS316', 'Client requested corrosion-resistant fittings', 'pending'],
  [P['SB-1027'], 'size_spec', '80 NB', '100 NB', 'Safety valve sizing revised after hydraulic calc review', 'pending'],
  [P['SB-1029'], 'group_label', 'Structural', 'Piping', 'Item was miscategorized during BOM import', 'pending'],
];
for (const [i, [projectId, field, oldVal, newVal, reason, status]] of ecnRows.entries()) {
  const decided = status !== 'pending';
  await run(
    `INSERT INTO bom_change_notes (project_id, field_changed, old_value, new_value, reason, status, requested_by, approved_by, created_at, decided_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      projectId, field, oldVal, newVal, reason, status, MARK, decided ? MARK : null,
      dtFromNow(-20 + i), decided ? dtFromNow(-15 + i) : null,
    ]
  );
}

// === Dispatch — packing_lists/packing_items (Register, E-way Bill Register, Freight Cost Summary,
// Dispatch Aging all share this one table) =========================================================
const packingRows = [
  // [projectId, customerName, status, createdOffset, dispatchedOffset, freight, freightPaidBy, ewayNo]
  [P['SB-1023'], 'Nirmal Alloys Pvt Ltd', 'dispatched', -35, -33, 6200, 'us', 'EWB-DEMO-200101'],
  [P['SB-1024'], 'Krishna Boiler Components', 'dispatched', -28, -26, 3800, 'customer', 'EWB-DEMO-200102'],
  [P['SB-1025'], 'Sundar Steels', 'dispatched', -12, -10, 5400, 'us', 'EWB-DEMO-200103'],
  [P['SB-1027'], 'Ganga Engineering Works', 'ready', -6, null, null, null, null],
  [P['SB-1029'], 'Om Sai Fabricators', 'ready', -3, null, null, null, null],
  [P['SB-1023'], 'Nirmal Alloys Pvt Ltd', 'draft', -1, null, null, null, null],
];
let packingSeq = 1101;
for (const [projectId, customerName, status, createdOffset, dispatchedOffset, freight, freightPaidBy, ewayNo] of packingRows) {
  const packingNo = `PKL-DEMO-${packingSeq++}`;
  const pl = await insert(
    `INSERT INTO packing_lists
       (project_id, packing_no, customer_name, status, created_by, created_at, updated_at,
        freight_amount, freight_paid_by, eway_bill_no, eway_bill_date, dispatched_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      projectId, packingNo, customerName, status, MARK, dtFromNow(createdOffset), dtFromNow(createdOffset),
      freight, freightPaidBy, ewayNo, ewayNo ? daysFromNow(dispatchedOffset) : null,
      dispatchedOffset !== null ? dtFromNow(dispatchedOffset) : null,
    ]
  );
  await run(
    `INSERT INTO packing_items (packing_list_id, s_no, material_description, qty, unit, scanned_qty)
     VALUES (?,?,?,?,?,?)`,
    [pl, 1, 'Shell Assembly', 1, 'Nos', status === 'draft' ? 0 : 1]
  );
  await run(
    `INSERT INTO packing_items (packing_list_id, s_no, material_description, qty, unit, scanned_qty)
     VALUES (?,?,?,?,?,?)`,
    [pl, 2, 'Mounting Hardware Kit', 4, 'Sets', status === 'draft' ? 0 : 4]
  );
}

// === Procurement — Purchase Register (via vendor_bills) + Open PO Aging (needs a real 'Transit'
// bom_item, not just an issued PO) =================================================================
// One per project, queried separately (not a single top-3-by-id query, which could concentrate all
// 3 in one project's BOM). IN ('Enquiry','Transit') so a rerun finds the same item it already
// flipped last time instead of picking a different one.
const transitCandidates = [];
for (const projectNo of ['SB-1023', 'SB-1024', 'SB-1025']) {
  const { rows } = await run(
    `SELECT id, project_id FROM bom_items WHERE purchase_status IN ('Enquiry','Transit') AND project_id = ? ORDER BY id LIMIT 1`,
    [P[projectNo]]
  );
  if (rows[0]) transitCandidates.push(rows[0]);
}
for (const b of transitCandidates) {
  await run(`UPDATE bom_items SET purchase_status = 'Transit' WHERE id = ?`, [b.id]);
}

const { rows: suppliers } = await run(
  `SELECT id, name FROM suppliers WHERE name IN ('AAYUSH ENTERPRISES','ACE ENGINEERING','ADVAITHA INDUSTRY','AIR WATER INDIA PVT. LTD','ALPHA91 KPS','AMIT ASSOCIATES')`
);
const byName = Object.fromEntries(suppliers.map(s => [s.name, s]));
for (const name of ['AAYUSH ENTERPRISES', 'ACE ENGINEERING', 'ADVAITHA INDUSTRY', 'AIR WATER INDIA PVT. LTD', 'ALPHA91 KPS', 'AMIT ASSOCIATES']) {
  if (!byName[name]) throw new Error(`Expected seed supplier ${name} not found`);
}

const poRows = [
  // [supplierName, issuedOffset, status, projectId, bomItemId, desc, qty, rate, withBill]
  [byName['AAYUSH ENTERPRISES'], -75, 'issued', transitCandidates[0]?.project_id, transitCandidates[0]?.id, 'BQ Plate 12mm SA516 Gr70', 500, 68, true],
  [byName['ACE ENGINEERING'], -50, 'issued', transitCandidates[1]?.project_id, transitCandidates[1]?.id, 'BQ Plate 14mm SA516 Gr70', 620, 70, true],
  [byName['ADVAITHA INDUSTRY'], -22, 'issued', transitCandidates[2]?.project_id, transitCandidates[2]?.id, 'MS Angle 40x40x4mm', 300, 62, true],
  [byName['AIR WATER INDIA PVT. LTD'], -8, 'issued', null, null, 'Industrial Gases — Argon/Oxygen', 40, 550, false],
  [byName['ALPHA91 KPS'], -4, 'issued', null, null, 'Precision Fasteners Assortment', 200, 22, false],
  [byName['AMIT ASSOCIATES'], null, 'draft', null, null, 'Packing & Crating Materials', 60, 180, false],
];
let poSeq = 1201;
for (const [supplier, issuedOffset, status, projectId, bomItemId, desc, qty, rate, withBill] of poRows) {
  const poNo = `DEMO-PO-${poSeq++}/SB/2026-27`;
  const amount = qty * rate;
  const po = await insert(
    `INSERT INTO purchase_orders (po_no, supplier_id, quote_source, quote_date, payment_terms, status, issued_at, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    [poNo, supplier.id, 'Verbal', issuedOffset ? daysFromNow(issuedOffset - 2) : null, '30 days', status, issuedOffset !== null ? dtFromNow(issuedOffset) : null, MARK]
  );
  await run(
    `INSERT INTO po_items (po_id, bom_item_id, project_id, description, qty, uom, rate, amount, sort_order) VALUES (?,?,?,?,?,?,?,?,?)`,
    [po, bomItemId ?? null, projectId ?? null, desc, qty, 'Kg', rate, amount, 0]
  );
  if (withBill) {
    const tax = Math.round(amount * 0.18);
    const total = amount + tax;
    const billNo = `DEMO-BILL-${poSeq}`;
    const bill = await insert(
      `INSERT INTO vendor_bills (bill_no, po_id, company, bill_date, due_date, status, subtotal, cgst_amount, sgst_amount, tax_amount, total, payable_amount, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [billNo, po, 'Shanti Boilers', daysFromNow(issuedOffset + 3), daysFromNow(issuedOffset + 33), 'approved', amount, tax / 2, tax / 2, tax, total, total, MARK]
    );
    await run(
      `INSERT INTO vendor_bill_items (vendor_bill_id, item_description, qty, uom, rate, amount, gst_rate_pct, sort_order) VALUES (?,?,?,?,?,?,?,?)`,
      [bill, desc, qty, 'Kg', rate, amount, 18, 0]
    );
  }
}

console.log(`Seeded: ${ecnRows.length} ECNs, ${packingRows.length} packing lists (12 items), ${poRows.length} POs (3 with vendor bills), 3 bom_items flipped to Transit.`);
