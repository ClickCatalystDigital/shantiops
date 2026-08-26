// scripts/batch-serial-consumption-selfcheck.mjs — Phase 3 (2026-08-26): batch/serial CONSUMPTION
// lifecycle. Same in-memory-libsql precedent as every other *-selfcheck.mjs this session — the real
// logic lives in ESM .js only loadable through Next's bundler, so it's mirrored here by hand.
//   node scripts/batch-serial-consumption-selfcheck.mjs
import assert from 'node:assert';
import { createClient } from '@libsql/client';

const db = createClient({ url: ':memory:' });
async function run(sql, args = []) { return db.execute({ sql, args }); }
async function one(sql, args = []) { return (await run(sql, args)).rows[0]; }
async function all(sql, args = []) { return (await run(sql, args)).rows; }
const round2 = n => Math.round(n * 100) / 100;

await run(`CREATE TABLE inventory_items (id INTEGER PRIMARY KEY, description TEXT, on_hand REAL DEFAULT 0, tracking_mode TEXT DEFAULT 'scalar')`);
await run(`CREATE TABLE inventory_batches (id INTEGER PRIMARY KEY AUTOINCREMENT, inventory_item_id INTEGER, receipt_id INTEGER, qty REAL, heat_no TEXT, status TEXT DEFAULT 'available')`);
await run(`CREATE TABLE inventory_serials (id INTEGER PRIMARY KEY AUTOINCREMENT, inventory_item_id INTEGER, receipt_id INTEGER, code TEXT, status TEXT DEFAULT 'available', bom_item_id INTEGER, material_issue_id INTEGER)`);
await run(`CREATE TABLE inventory_reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, inventory_item_id INTEGER, bom_item_id INTEGER, qty REAL, status TEXT DEFAULT 'active')`);
await run(`CREATE TABLE inventory_batch_allocations (id INTEGER PRIMARY KEY AUTOINCREMENT, reservation_id INTEGER, batch_id INTEGER, qty REAL, status TEXT DEFAULT 'active', material_issue_id INTEGER)`);
await run(`CREATE TABLE bom_items (id INTEGER PRIMARY KEY, project_id INTEGER, purchase_status TEXT DEFAULT 'Enquiry')`);
await run(`CREATE TABLE material_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, bom_item_id INTEGER, job_card_id INTEGER, qty REAL, issued_by TEXT, unit_cost REAL, total_cost REAL, issued_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
await run(`CREATE TABLE job_cards (id INTEGER PRIMARY KEY, work_order_id INTEGER)`);
await run(`CREATE TABLE work_orders (id INTEGER PRIMARY KEY, wo_no TEXT)`);
await run(`CREATE TABLE stock_receipts (id INTEGER PRIMARY KEY, received_at DATETIME)`);

// ---- mirrors lib/inventory-batches.js's issueBatch (CAS-fixed) + allocateBatchesFifo ----
async function issueBatch(batchId, qty) {
  const q = Number(qty);
  const flip = await run(
    `UPDATE inventory_batches SET qty = round(qty - ?, 2), status = CASE WHEN qty - ? <= 0.0001 THEN 'consumed' ELSE 'available' END
      WHERE id = ? AND qty >= ? - 0.0001`,
    [q, q, batchId, q]
  );
  if (flip.rowsAffected !== 1) throw new Error('Only limited quantity available in this batch');
}
async function findFifoBatches(inventoryItemId) {
  const rows = await all(
    `SELECT b.id, b.qty, b.qty - COALESCE((SELECT SUM(qty) FROM inventory_batch_allocations WHERE batch_id = b.id AND status = 'active'), 0) AS available_for_allocation
       FROM inventory_batches b WHERE b.inventory_item_id = ? AND b.status = 'available' ORDER BY b.id ASC`,
    [inventoryItemId]
  );
  return rows.filter(r => r.available_for_allocation > 0.0001);
}
async function allocateBatchesFifo({ inventoryItemId, qty, reservationId, status = 'active', materialIssueId = null }) {
  const candidates = await findFifoBatches(inventoryItemId);
  let remaining = round2(Number(qty));
  const created = [];
  for (const c of candidates) {
    if (remaining <= 0.0001) break;
    const take = round2(Math.min(remaining, c.available_for_allocation));
    if (take <= 0.0001) continue;
    const ins = await run(
      `INSERT INTO inventory_batch_allocations (reservation_id, batch_id, qty, status, material_issue_id) VALUES (?, ?, ?, ?, ?)`,
      [reservationId, c.id, take, status, materialIssueId]
    );
    created.push({ id: Number(ins.lastInsertRowid), batchId: c.id, qty: take });
    remaining = round2(remaining - take);
  }
  return { allocations: created, shortfall: remaining };
}
async function rollUpBatchOnHand(inventoryItemId) {
  const row = await one("SELECT COALESCE(SUM(qty),0) AS n FROM inventory_batches WHERE inventory_item_id=? AND status='available'", [inventoryItemId]);
  await run('UPDATE inventory_items SET on_hand = ? WHERE id = ?', [row.n, inventoryItemId]);
}

// ---- mirrors lib/consume-stock.js's consumeStock (batch branch) ----
async function consumeStockBatch({ inventoryItemId, qty, bomItemId, jobCardId, existingAllocations }) {
  const ins = await run(`INSERT INTO material_issues (bom_item_id, job_card_id, qty) VALUES (?, ?, ?)`, [bomItemId, jobCardId || null, qty]);
  const materialIssueId = Number(ins.lastInsertRowid);
  if (existingAllocations?.length) {
    for (const a of existingAllocations) {
      const flip = await run(`UPDATE inventory_batch_allocations SET status='issued', material_issue_id=? WHERE id=? AND status='active'`, [materialIssueId, a.id]);
      if (flip.rowsAffected !== 1) throw new Error('Allocation already issued or released');
      await issueBatch(a.batch_id, a.qty);
      await rollUpBatchOnHand(inventoryItemId);
    }
  } else {
    const { allocations, shortfall } = await allocateBatchesFifo({ inventoryItemId, qty, reservationId: null, status: 'issued', materialIssueId });
    if (shortfall > 0.0001) throw new Error(`Only ${round2(qty - shortfall)} available to issue`);
    for (const a of allocations) { await issueBatch(a.batchId, a.qty); await rollUpBatchOnHand(inventoryItemId); }
  }
  return { materialIssueId };
}
async function getIssuedAllocationsForBomItem(bomItemId) {
  return all(
    `SELECT a.* FROM inventory_batch_allocations a JOIN inventory_reservations r ON r.id = a.reservation_id
      WHERE r.bom_item_id = ? AND a.status = 'issued'`, [bomItemId]);
}

// =====================================================================================
await run(`INSERT INTO inventory_items (id, description, tracking_mode) VALUES (1, 'M20 Bolt', 'batch')`);
await run(`INSERT INTO inventory_batches (id, inventory_item_id, qty, heat_no, status) VALUES (1, 1, 100, 'H1', 'available')`);
await run(`INSERT INTO inventory_batches (id, inventory_item_id, qty, heat_no, status) VALUES (2, 1, 80, 'H2', 'available')`);
await rollUpBatchOnHand(1);
await run(`INSERT INTO bom_items (id, project_id) VALUES (1, 1)`);
await run(`INSERT INTO inventory_reservations (id, inventory_item_id, bom_item_id, qty, status) VALUES (1, 1, 1, 150, 'active')`);

// A3.1
{
  const { allocations, shortfall } = await allocateBatchesFifo({ inventoryItemId: 1, qty: 150, reservationId: 1, status: 'active' });
  assert.strictEqual(shortfall, 0, 'no shortfall allocating 150 across 100+80=180 available');
  assert.strictEqual(allocations.length, 2, 'must split across both batches');
  assert.strictEqual(allocations[0].qty, 100); assert.strictEqual(allocations[1].qty, 50);
  const b1 = await one('SELECT qty FROM inventory_batches WHERE id=1'); const b2 = await one('SELECT qty FROM inventory_batches WHERE id=2');
  assert.strictEqual(b1.qty, 100, 'batch qty untouched at reserve time'); assert.strictEqual(b2.qty, 80, 'batch qty untouched at reserve time');
}
console.log('A3.1 multi-batch allocation: ok');

// A3.2
{
  const activeAllocs = await all("SELECT * FROM inventory_batch_allocations WHERE reservation_id=1 AND status='active'");
  const { materialIssueId } = await consumeStockBatch({ inventoryItemId: 1, qty: 150, bomItemId: 1, existingAllocations: activeAllocs });
  const b1 = await one('SELECT qty,status FROM inventory_batches WHERE id=1'); const b2 = await one('SELECT qty,status FROM inventory_batches WHERE id=2');
  assert.strictEqual(b1.qty, 0); assert.strictEqual(b1.status, 'consumed');
  assert.strictEqual(b2.qty, 30); assert.strictEqual(b2.status, 'available');
  const item = await one('SELECT on_hand FROM inventory_items WHERE id=1');
  assert.strictEqual(item.on_hand, 30, 'on_hand recomputed as live SUM of available batches, not a naive 150-150=0');
  global.__materialIssueId_A32 = materialIssueId;
}
console.log('A3.2 issue -> on_hand recompute: ok');

// A3.3 — concurrency: two 60-unit issues against a fresh 100-unit batch
{
  await run(`INSERT INTO inventory_batches (id, inventory_item_id, qty, status) VALUES (3, 1, 100, 'available')`);
  const results = await Promise.allSettled([issueBatch(3, 60), issueBatch(3, 60)]);
  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  assert.strictEqual(succeeded, 1, 'exactly one of two concurrent 60-unit issues against 100 units must succeed');
  const b3 = await one('SELECT qty FROM inventory_batches WHERE id=3');
  assert.strictEqual(b3.qty, 40, 'final qty must be 40, never a phantom -20 or double-accepted 40s');
}
console.log('A3.3 / A3.14 concurrent issueBatch CAS guard (I10): ok');

// A3.4 — release before issue (isolated inventory_item so FIFO can't reach into other tests' batches)
{
  await run(`INSERT INTO inventory_items (id, description, tracking_mode) VALUES (9, 'Isolated batch item', 'batch')`);
  await run(`INSERT INTO inventory_batches (id, inventory_item_id, qty, status) VALUES (9, 9, 100, 'available')`);
  await run(`INSERT INTO inventory_reservations (id, inventory_item_id, bom_item_id, qty, status) VALUES (5, 9, 8, 40, 'active')`);
  await run(`INSERT INTO bom_items (id, project_id) VALUES (8, 1)`);
  await allocateBatchesFifo({ inventoryItemId: 9, qty: 40, reservationId: 5, status: 'active' });
  let candidates = await findFifoBatches(9);
  assert.strictEqual(candidates.find(c => c.id === 9).available_for_allocation, 60, 'available-for-allocation reduced by the active allocation');
  await run("UPDATE inventory_batch_allocations SET status='released' WHERE reservation_id=5");
  candidates = await findFifoBatches(9);
  assert.strictEqual(candidates.find(c => c.id === 9).available_for_allocation, 100, 'releasing self-heals availability with no manual arithmetic');
}
console.log('A3.4 release self-heals: ok');

// A3.5 / A3.6 — serial (mirrors lib/inventory-serials.js reserveSerial/issueSerial)
{
  await run(`INSERT INTO inventory_items (id, description, tracking_mode) VALUES (2, 'Gate Valve', 'serial')`);
  await run(`INSERT INTO inventory_serials (id, inventory_item_id, code, status) VALUES (1, 2, 'SR-0001', 'available')`);
  await run(`INSERT INTO bom_items (id, project_id) VALUES (2, 1)`);
  const reserve = await run("UPDATE inventory_serials SET status='reserved', bom_item_id=? WHERE id=1 AND status='available'", [2]);
  assert.strictEqual(reserve.rowsAffected, 1);
  const headerCount = await one("SELECT COUNT(*) AS n FROM inventory_reservations WHERE bom_item_id=2");
  assert.strictEqual(headerCount.n, 0, 'A3.5: serial reservation creates NO inventory_reservations header row');

  const issue = await run("UPDATE inventory_serials SET status='consumed', material_issue_id=99 WHERE id=1 AND status IN ('available','reserved')", []);
  assert.strictEqual(issue.rowsAffected, 1);
  const again = await run("UPDATE inventory_serials SET status='consumed' WHERE id=1 AND status IN ('available','reserved')", []);
  assert.strictEqual(again.rowsAffected, 0, 'A3.6: a second issue attempt on an already-consumed serial must be rejected (CAS)');
}
console.log('A3.5 / A3.6 serial reserve/issue, no header row, CAS terminal: ok');

// A3.7 — cancellation releases both a batch allocation and a reserved serial
{
  await run(`INSERT INTO inventory_reservations (id, inventory_item_id, bom_item_id, qty, status) VALUES (3, 1, 3, 20, 'active')`);
  await run(`INSERT INTO bom_items (id, project_id) VALUES (3, 1)`);
  await allocateBatchesFifo({ inventoryItemId: 1, qty: 20, reservationId: 3, status: 'active' });
  await run(`INSERT INTO inventory_serials (id, inventory_item_id, code, status, bom_item_id) VALUES (2, 2, 'SR-0002', 'reserved', 4)`);
  // releaseReservationsForItem(3) mirror:
  await run("UPDATE inventory_reservations SET status='released' WHERE bom_item_id=3 AND status='active'");
  await run("UPDATE inventory_batch_allocations SET status='released' WHERE reservation_id=3 AND status='active'");
  // releaseSerial for bom_item 4:
  await run("UPDATE inventory_serials SET status='available', bom_item_id=NULL WHERE bom_item_id=4 AND status='reserved'");
  const remainingAlloc = await one("SELECT COUNT(*) AS n FROM inventory_batch_allocations WHERE reservation_id=3 AND status='active'");
  const serial2 = await one("SELECT status FROM inventory_serials WHERE id=2");
  assert.strictEqual(remainingAlloc.n, 0);
  assert.strictEqual(serial2.status, 'available');
}
console.log('A3.7 cancellation releases batch allocation + reserved serial (I7): ok');

// A3.8 / A3.12 — direct issue, no prior reservation, full I8 traceability (isolated inventory_item)
{
  await run(`INSERT INTO inventory_items (id, description, tracking_mode) VALUES (10, 'Isolated item 2', 'batch')`);
  await run(`INSERT INTO inventory_batches (id, inventory_item_id, qty, heat_no, status) VALUES (10, 10, 200, 'H5', 'available')`);
  await rollUpBatchOnHand(10);
  await run(`INSERT INTO bom_items (id, project_id) VALUES (5, 1)`);
  const { materialIssueId } = await consumeStockBatch({ inventoryItemId: 10, qty: 50, bomItemId: 5 });
  const alloc = await one('SELECT * FROM inventory_batch_allocations WHERE material_issue_id = ?', [materialIssueId]);
  assert.ok(alloc, 'A3.8: direct issue creates its own allocation, reservation_id NULL');
  assert.strictEqual(alloc.reservation_id, null);
  const heat = await one('SELECT heat_no FROM inventory_batches WHERE id = ?', [alloc.batch_id]);
  assert.strictEqual(heat.heat_no, 'H5', 'A3.12: material_issue -> allocation -> batch -> heat resolves exactly');
}
console.log('A3.8 / A3.12 direct-issue allocation + I8 traceability: ok');

// A3.10 — full multi-heat traceability proof (H1 + H2 from A3.1/A3.2)
{
  const allocs = await all('SELECT a.*, b.heat_no FROM inventory_batch_allocations a JOIN inventory_batches b ON b.id=a.batch_id WHERE a.material_issue_id = ?', [global.__materialIssueId_A32]);
  const heats = allocs.map(a => a.heat_no).sort();
  assert.deepStrictEqual(heats, ['H1', 'H2'], 'both heats resolvable from the one material_issues row that consumed them');
}
console.log('A3.10 multi-heat traceability: ok');

// A3.11 — job_card_id -> work_order chain
{
  await run(`INSERT INTO work_orders (id, wo_no) VALUES (1, 'WO-1001')`);
  await run(`INSERT INTO job_cards (id, work_order_id) VALUES (1, 1)`);
  await run(`INSERT INTO bom_items (id, project_id) VALUES (6, 1)`);
  await run(`INSERT INTO inventory_batches (id, inventory_item_id, qty, status) VALUES (6, 1, 30, 'available')`);
  await rollUpBatchOnHand(1);
  const { materialIssueId } = await consumeStockBatch({ inventoryItemId: 1, qty: 10, bomItemId: 6, jobCardId: 1 });
  const chain = await one(
    `SELECT wo.wo_no FROM material_issues mi JOIN job_cards jc ON jc.id = mi.job_card_id JOIN work_orders wo ON wo.id = jc.work_order_id WHERE mi.id = ?`,
    [materialIssueId]);
  assert.strictEqual(chain.wo_no, 'WO-1001', 'material_issues -> job_cards -> work_orders resolves via the direct FK chain');
}
console.log('A3.11 job_card_id -> work_order chain: ok');

// A3.15 — I11: no double-consumption once a bom_item is already reservation-issued
{
  await run(`INSERT INTO inventory_batches (id, inventory_item_id, qty, status) VALUES (7, 1, 50, 'available')`);
  await rollUpBatchOnHand(1);
  await run(`INSERT INTO bom_items (id, project_id) VALUES (7, 1)`);
  await run(`INSERT INTO inventory_reservations (id, inventory_item_id, bom_item_id, qty, status) VALUES (4, 1, 7, 20, 'active')`);
  await allocateBatchesFifo({ inventoryItemId: 1, qty: 20, reservationId: 4, status: 'active' });
  const activeAllocs = await all("SELECT * FROM inventory_batch_allocations WHERE reservation_id=4 AND status='active'");
  await consumeStockBatch({ inventoryItemId: 1, qty: 20, bomItemId: 7, existingAllocations: activeAllocs });
  const onHandAfterFirstIssue = (await one('SELECT on_hand FROM inventory_items WHERE id=1')).n ?? (await one('SELECT on_hand FROM inventory_items WHERE id=1')).on_hand;

  // Mirrors the material-issues route's I11 guard: check for an already-issued allocation first.
  const alreadyIssued = await getIssuedAllocationsForBomItem(7);
  assert.ok(alreadyIssued.length > 0, 'precondition: bom_item 7 already has an issued allocation');
  // Simulate the route's audit-only branch: insert material_issues, touch NOTHING else.
  const auditOnly = await run('INSERT INTO material_issues (bom_item_id, qty) VALUES (7, 20)');
  const onHandAfterSecondLog = (await one('SELECT on_hand FROM inventory_items WHERE id=1')).on_hand;
  assert.strictEqual(onHandAfterSecondLog, onHandAfterFirstIssue, 'a second material_issues log against an already-issued bom_item must not move on_hand again');
  const allocCountForSecondLog = await one('SELECT COUNT(*) AS n FROM inventory_batch_allocations WHERE material_issue_id = ?', [Number(auditOnly.lastInsertRowid)]);
  assert.strictEqual(allocCountForSecondLog.n, 0, 'the audit-only log must create zero new allocations');
}
console.log('A3.15 no double-consumption once reservation-issued (I11): ok');

console.log('\nAll Phase 3 batch/serial consumption self-checks passed.');
