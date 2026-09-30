// node lib/plan-coverage-selfcheck.mjs
import assert from 'node:assert/strict';
import { computePlan } from './plan-coverage.mjs';

const L = o => ({ project_id: 1, purchase_status: 'Enquiry', pending_review: 0, received: 0, reservedNet: 0, reservedPieces: 0, ...o });
const get = (p, id) => p.rows.find(r => r.id === id);

// 1. shared pool goes to the earlier need-by line first, never promised twice
{
  const p = computePlan({
    lines: [L({ id: 1, required: 6, poolKey: 9, needBy: '2026-11-01' }), L({ id: 2, required: 6, poolKey: 9, needBy: '2026-10-01' })],
    pools: { 9: 8 }, today: '2026-09-30',
  });
  assert.equal(get(p, 2).free, 6);       // earlier need-by wins
  assert.equal(get(p, 1).free, 2);       // only 2 left
  assert.equal(get(p, 1).short, 4);
  assert.equal(p.items[9].atp, 0);
  assert.equal(p.items[9].planned_demand, 12);
}

// 2. reservation already covers the line; stock not double counted
{
  const p = computePlan({ lines: [L({ id: 1, required: 5, reservedNet: 5, poolKey: 3 })], pools: { 3: 99 }, today: '2026-09-30' });
  assert.equal(get(p, 1).status, 'covered');
  assert.equal(get(p, 1).free, 0);
  assert.equal(p.items[3].atp, 99);
}

// 3. received + self-reservation of the same units is not counted twice
{
  const p = computePlan({ lines: [L({ id: 1, required: 10, received: 10, reservedNet: 10, purchase_status: 'Transit' })], today: '2026-09-30' });
  assert.equal(get(p, 1).secured, 10);
  assert.equal(get(p, 1).status, 'covered');
}

// 4. partial receipt leaves the remainder on order, dated by lot; late vs need-by
{
  const lines = [L({ id: 1, required: 10, received: 4, purchase_status: 'Transit', poQty: 10, needBy: '2026-10-05',
    lots: [{ qty: 6, date: '2026-10-20' }], unscheduledQty: 0 })];
  const r = get(computePlan({ lines, today: '2026-09-30' }), 1);
  assert.equal(r.incoming, 6);
  assert.equal(r.incoming_date, '2026-10-20');
  assert.equal(r.status, 'late');
  assert.equal(r.action, 'expedite');
}

// 5. unknown date -> on_order (not late), date null
{
  const r = get(computePlan({ lines: [L({ id: 1, required: 3, purchase_status: 'Ordered', poQty: 3, needBy: '2026-10-05' })], today: '2026-09-30' }), 1);
  assert.equal(r.status, 'on_order');
  assert.equal(r.incoming_date, null);
}

// 6. qty_resolved / rollup are the caller's job: engine trusts `required`; null -> check_qty
{
  assert.equal(get(computePlan({ lines: [L({ id: 1, required: null })], today: '2026-09-30' }), 1).status, 'check_qty');
}

// 7. held for QC
{
  const r = get(computePlan({ lines: [L({ id: 1, required: 2, received: 2, purchase_status: 'Transit', qcHeldQty: 2, poQty: 2 })], today: '2026-09-30' }), 1);
  assert.equal(r.status, 'held_qc');
}

// 8. Stores-review pending + nothing available = needs decision; otherwise sourcing
{
  const p = computePlan({ lines: [L({ id: 1, required: 2, pending_review: 1 }), L({ id: 2, required: 2 })], today: '2026-09-30' });
  assert.equal(get(p, 1).status, 'decision');
  assert.equal(get(p, 2).status, 'sourcing');
}

// 9. remnant pieces are claimed once across lines; owner rule respected
{
  const dims = { kind: 'plate', length_mm: 500, width_mm: 500, thickness_mm: 10 };
  const piece = { id: 77, code: 'PL-1', inv_item_id: null, invMocNorm: 'is2062', thickness_mm: 10, length_mm: 1000, width_mm: 600, owner_project_id: null };
  const mk = id => L({ id, required: 1, dims, reqMoc: 'is2062', needBy: '2026-10-0' + id });
  const p = computePlan({ lines: [mk(1), mk(2)], pieces: [piece], today: '2026-09-30' });
  assert.equal(get(p, 1).remnant, 1);
  assert.equal(get(p, 1).remnant_piece_id, 77);
  assert.equal(get(p, 1).action, 'reserve');
  assert.equal(get(p, 2).remnant, 0);            // already claimed
  const owned = computePlan({ lines: [{ ...mk(1), project_id: 1 }], pieces: [{ ...piece, owner_project_id: 2 }], today: '2026-09-30' });
  assert.equal(get(owned, 1).remnant, 0);
}

// 10. terminal status is simply in hand; urgent flag only on uncovered near-term lines
{
  const p = computePlan({ lines: [L({ id: 1, required: 1, purchase_status: 'Received' }), L({ id: 2, required: 1, needBy: '2026-10-02' })], today: '2026-09-30' });
  assert.equal(get(p, 1).status, 'in_hand');
  assert.equal(get(p, 2).urgent, true);
  assert.equal(get(p, 1).urgent, false);
}

// 11. unreleased BOM line is not chased; but stock that exists is still shown
{
  const p = computePlan({ lines: [L({ id: 1, required: 2, released: false }), L({ id: 2, required: 2, released: true })], today: '2026-09-30' });
  assert.equal(get(p, 1).status, 'unreleased');
  assert.equal(get(p, 2).status, 'sourcing');
}

console.log('plan-coverage selfcheck: ok');
