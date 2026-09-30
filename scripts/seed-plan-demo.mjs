// scripts/seed-plan-demo.mjs — Planning demo data: project ZZ-PLAN-TEST (BOM lines covering every Material Plan status, a PO with a late delivery lot, an overloaded Work Order). Re-runnable; "cleanup" removes it.
// node --env-file=.env.local scripts/seed-plan-demo.mjs [setup|cleanup]
import { createClient } from '@libsql/client';
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN, intMode: 'number' });
const run = (sql, args = []) => db.execute({ sql, args });
const one = async (sql, args = []) => (await run(sql, args)).rows[0] || null;
const iso = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const P = 'ZZ-PLAN-TEST';

async function cleanup() {
  const p = await one('SELECT id FROM projects WHERE project_no = ?', [P]);
  if (p) {
    const ids = (await run('SELECT id FROM bom_items WHERE project_id = ?', [p.id])).rows.map(r => r.id);
    const inIds = ids.length ? ids.join(',') : '0';
    await run(`DELETE FROM inventory_reservations WHERE bom_item_id IN (${inIds})`);
    await run(`DELETE FROM po_delivery_lot_items WHERE po_item_id IN (SELECT id FROM po_items WHERE bom_item_id IN (${inIds}))`);
    await run(`DELETE FROM po_items WHERE bom_item_id IN (${inIds})`);
    await run(`DELETE FROM notifications WHERE project_id = ?`, [p.id]);
    await run(`DELETE FROM tasks WHERE project_id = ?`, [p.id]);
    await run(`DELETE FROM work_order_operations WHERE work_order_id IN (SELECT id FROM work_orders WHERE project_id = ?)`, [p.id]);
    await run(`DELETE FROM work_orders WHERE project_id = ?`, [p.id]);
    await run(`DELETE FROM bom_items WHERE project_id = ?`, [p.id]);
    await run(`DELETE FROM milestones WHERE project_id = ?`, [p.id]);
    await run(`DELETE FROM projects WHERE id = ?`, [p.id]);
  }
  await run(`DELETE FROM po_delivery_lots WHERE po_id IN (SELECT id FROM purchase_orders WHERE po_no LIKE 'ZZ-PLAN%')`);
  await run(`DELETE FROM purchase_orders WHERE po_no LIKE 'ZZ-PLAN%'`);
  await run(`DELETE FROM suppliers WHERE name = 'ZZ PLAN SUPPLIER'`);
  await run(`DELETE FROM inventory_items WHERE description = 'ZZ PLAN TEST BOLT'`);
  await run(`DELETE FROM items WHERE item_name = 'ZZ PLAN TEST BOLT'`);
  console.log('cleaned');
}

async function setup() {
  await cleanup();
  const it = await run(`INSERT INTO items (item_name, uom) VALUES ('ZZ PLAN TEST BOLT','Nos')`);
  const itemId = Number(it.lastInsertRowid);
  const inv = await run(`INSERT INTO inventory_items (description, on_hand, item_id) VALUES ('ZZ PLAN TEST BOLT', 6, ?)`, [itemId]);
  const invId = Number(inv.lastInsertRowid);
  const pr = await run(`INSERT INTO projects (project_no, customer_name, description, status, company) VALUES (?, 'ZZ Plan Customer', 'plan test', 'active', 'Shanti Boilers')`, [P]);
  const pid = Number(pr.lastInsertRowid);
  await run(`INSERT INTO milestones (project_id, milestone_key, milestone_label, sort_order, department, status, actual_end) VALUES (?, 'release_bom','Release BOM',1,'Design','done',?)`, [pid, iso(-1)]);
  await run(`INSERT INTO milestones (project_id, milestone_key, milestone_label, sort_order, department, planned_start, planned_end) VALUES (?, 'marking_cutting','Marking',2,'Production',?,?)`, [pid, iso(5), iso(9)]);
  const bom = async (desc, qty, o = {}) => Number((await run(
    `INSERT INTO bom_items (project_id, material_description, qty_text, source, purchase_status, pending_review, item_id)
     VALUES (?,?,?, 'bom', ?, ?, ?)`, [pid, desc, qty, o.status || 'Enquiry', o.pending || 0, o.item || null])).lastInsertRowid);
  const A = await bom('ZZ BOLT M12', '10 Nos', { item: itemId });          // free stock 6 of 10 -> reserve + short 4
  const B = await bom('ZZ VALVE', '2 Nos');                                   // nothing -> sourcing
  const C = await bom('ZZ GASKET', '3 Nos', { pending: 1 });                  // needs decision
  const D = await bom('ZZ PLATE ON ORDER', '5 Nos', { status: 'Ordered' });   // on order, lot after need-by -> late
  const sup = Number((await run(`INSERT INTO suppliers (name) VALUES ('ZZ PLAN SUPPLIER')`)).lastInsertRowid);
  const po = Number((await run(`INSERT INTO purchase_orders (po_no, supplier_id, status) VALUES ('ZZ-PLAN-1', ?, 'issued')`, [sup])).lastInsertRowid);
  const poi = Number((await run(`INSERT INTO po_items (po_id, bom_item_id, project_id, description, qty, rate, amount) VALUES (?,?,?,?,5,10,50)`, [po, D, pid, 'ZZ PLATE ON ORDER'])).lastInsertRowid);
  const lot = Number((await run(`INSERT INTO po_delivery_lots (po_id, lot_label, expected_delivery_date) VALUES (?, '1', ?)`, [po, iso(20)])).lastInsertRowid);
  await run(`INSERT INTO po_delivery_lot_items (lot_id, po_item_id, qty) VALUES (?,?,5)`, [lot, poi]);
  const ws = await one(`SELECT id FROM workstations WHERE name = 'Weld Bay 1'`);
  const wo = Number((await run(`INSERT INTO work_orders (wo_no, project_id, mode, product_description, qty_planned, planned_start, planned_end, status) VALUES ('ZZ-WO-PLAN', ?, 'against_order','ZZ plan test boiler',1,?,?, 'released')`, [pid, iso(0), iso(4)])).lastInsertRowid);
  await run(`INSERT INTO work_order_operations (work_order_id, seq, workstation_id, planned_minutes) VALUES (?,1,?,4000)`, [wo, ws.id]);
  console.log(JSON.stringify({ pid, itemId, invId, A, B, C, D, wo }));
}
await (process.argv[2] === 'cleanup' ? cleanup() : setup());
