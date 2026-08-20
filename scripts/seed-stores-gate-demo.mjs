// Demo data for STERP items 9/14/15 (SYSTEM.md §5e, 2026-08-19 subsection): Reorder Suggestions,
// Gate Inward Receipts (GIR), and Gate Passes. Reorder Suggestions needs no seed rows of its own —
// it's derived off inventory_items.reorder_point, and MS Angle 50x50x5 (id 10, 8 on-hand / 10
// minimum, already in the DB) already demonstrates it; this script doesn't touch inventory_items.
//
// Scope is the three new tables only: gate_inward_receipts, gate_passes, gate_pass_items.
// Re-runnable: wipes its own scope first, same "reset to a known state" contract as
// scripts/seed-demo-pipeline.mjs. Does not touch any other table — no project/BOM/inventory
// dependency, so it's safe to run regardless of which pipeline-demo state is currently loaded.
//
// Run: node --env-file=.env.local scripts/seed-stores-gate-demo.mjs
import { createClient } from '@libsql/client';

const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
  intMode: 'number',
});

async function run(sql, args = []) {
  return db.execute({ sql, args });
}

async function nextCounter(name) {
  const r = await run(
    `INSERT INTO counters (name, value) VALUES (?, 1001)
     ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value`,
    [name]
  );
  return r.rows[0].value;
}

function isoDaysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }
function isoDaysFromNow(n) { return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10); }

async function seedGir({ vehicle_no, supplier_name, driver_name, material_ref, seal, docs, remarks, grn_ref, closed }) {
  const gir_no = await nextCounter('gir_no');
  await run(
    `INSERT INTO gate_inward_receipts
       (gir_no, vehicle_no, supplier_name, driver_name, material_ref,
        security_seal_ok, security_docs_ok, security_remarks, grn_ref, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'seed-script')`,
    [gir_no, vehicle_no, supplier_name, driver_name, material_ref,
      seal ? 1 : 0, docs ? 1 : 0, remarks || null, grn_ref || null, closed ? 'closed' : 'open']
  );
  return gir_no;
}

async function seedGatePass({ type, party, responsible_person, purpose, expected_return_date, status, approved, items }) {
  const gp_no = await nextCounter('gate_pass_no');
  const approved_by = approved ? 'stores_head' : null;
  const r = await run(
    `INSERT INTO gate_passes
       (gp_no, type, party, responsible_person, purpose, expected_return_date, status, approved_by, approved_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${approved ? 'CURRENT_TIMESTAMP' : 'NULL'}, 'seed-script')`,
    [gp_no, type, party, responsible_person, purpose, expected_return_date || null, status, approved_by]
  );
  const gpId = Number(r.lastInsertRowid);
  for (const it of items) {
    await run(
      `INSERT INTO gate_pass_items (gate_pass_id, description, qty_text, returned) VALUES (?, ?, ?, ?)`,
      [gpId, it.desc, it.qty, it.returned ? 1 : 0]
    );
  }
  return gp_no;
}

async function main() {
  console.log('Wiping gate_pass_items, gate_passes, gate_inward_receipts (own scope only)...');
  await run('DELETE FROM gate_pass_items');
  await run('DELETE FROM gate_passes');
  await run('DELETE FROM gate_inward_receipts');

  console.log('Seeding Gate Inward Receipts...');
  const girOpen = await seedGir({
    vehicle_no: 'MH14GH2211', supplier_name: 'SRIVILAS HYDROTECH PVT LTD', driver_name: 'Suresh Yadav',
    material_ref: 'PO against SB-1018', seal: true, docs: true,
    remarks: 'Awaiting Procurement GRN confirmation.',
  });
  const girClosed = await seedGir({
    vehicle_no: 'TN37BZ5588', supplier_name: 'JR SEAMLESS PVT LTD', driver_name: 'Manoj Kumar',
    material_ref: 'PO against SB-1023', seal: true, docs: true,
    grn_ref: 'GRN-2031', closed: true,
  });
  console.log(`  GIR-${girOpen} (open, awaiting GRN), GIR-${girClosed} (closed, GRN-2031).`);

  console.log('Seeding Gate Passes...');
  const gp1 = await seedGatePass({
    type: 'returnable', party: 'Precision Instruments Calibration Lab', responsible_person: 'Ramesh Kumar',
    purpose: 'Pressure gauge calibration', expected_return_date: isoDaysFromNow(6), status: 'draft',
    items: [{ desc: 'Pressure Gauge Dial 4" 0-25 Kg/cm2', qty: '2 Nos' }],
  });
  const gp2 = await seedGatePass({
    type: 'returnable', party: 'Kiran Enterprise', responsible_person: 'Suresh Patel',
    purpose: 'Job-work: profile cutting', expected_return_date: isoDaysFromNow(10), status: 'approved', approved: true,
    items: [{ desc: 'MS Plate offcuts for profile cutting', qty: '120 Kgs' }],
  });
  const gp3 = await seedGatePass({
    type: 'returnable', party: 'Tools & Spares Corporation', responsible_person: 'Ramesh Kumar',
    purpose: 'Torque wrench calibration & repair', expected_return_date: isoDaysFromNow(4), status: 'issued', approved: true,
    items: [{ desc: 'Torque wrench 300 Nm', qty: '1 No' }],
  });
  const gp4 = await seedGatePass({
    type: 'returnable', party: 'AMIT SALES CORPORATION', responsible_person: 'Suresh Patel',
    purpose: 'Weld inspection gauge — job work', expected_return_date: isoDaysAgo(5), status: 'issued', approved: true,
    items: [{ desc: 'Fillet weld gauge set', qty: '3 Nos' }],
  });
  const gp5 = await seedGatePass({
    type: 'returnable', party: 'KIRAN ENTERPRISE', responsible_person: 'Ramesh Kumar',
    purpose: 'Test rig loan — returned', expected_return_date: isoDaysAgo(12), status: 'returned', approved: true,
    items: [{ desc: 'Hydro test rig — portable', qty: '1 No', returned: true }],
  });
  const gp6 = await seedGatePass({
    type: 'non_returnable', party: 'Local Scrap Vendor', responsible_person: 'Suresh Patel',
    purpose: 'MS scrap disposal', status: 'issued', approved: true,
    items: [{ desc: 'MS scrap offcuts', qty: '340 Kgs' }],
  });
  console.log(`  GP-${gp1} (draft), GP-${gp2} (approved), GP-${gp3} (issued, due in 4 days),`);
  console.log(`  GP-${gp4} (issued, OVERDUE by 5 days), GP-${gp5} (returned), GP-${gp6} (non-returnable, issued).`);

  console.log('\n=== done ===');
  console.log('Reorder Suggestions needs no seed — MS Angle 50x50x5 (8/10) already triggers it.');
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
