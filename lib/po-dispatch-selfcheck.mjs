import assert from 'node:assert/strict';
import { validateDispatch } from './po-dispatch.mjs';
const bal = new Map([[1, { remaining: 10, description: 'PIPE' }], [2, { remaining: 3, description: 'VALVE' }]]);
const ok = { dispatched_on: '2026-10-05', items: [{ po_item_id: 1, qty: 4 }, { po_item_id: 2, qty: 0 }] };
const r = validateDispatch(ok, bal);
assert.equal(r.items.length, 1);                                              // qty 0 line dropped
assert.ok(validateDispatch({ ...ok, dispatched_on: '' }, bal).error);          // date needed
assert.ok(validateDispatch({ ...ok, dispatched_on: '5 Oct' }, bal).error);
assert.ok(validateDispatch({ ...ok, items: [{ po_item_id: 1, qty: 11 }] }, bal).error);   // more than left
assert.ok(validateDispatch({ ...ok, items: [{ po_item_id: 9, qty: 1 }] }, bal).error);    // not on this order
assert.ok(validateDispatch({ ...ok, items: [] }, bal).error);
assert.ok(validateDispatch({ ...ok, items: [{ po_item_id: 1, qty: 1 }, { po_item_id: 1, qty: 1 }] }, bal).error); // duplicate
assert.ok(validateDispatch({ ...ok, tracking_url: 'javascript:1' }, bal).error);
assert.equal(validateDispatch({ ...ok, transport_mode: 'bike' }, bal).values.transport_mode, null);
assert.equal(validateDispatch({ dispatched_on: '2026-10-05', invoice_no: ' INV-1 ' }, bal, { requireItems: false }).values.invoice_no, 'INV-1');
console.log('po-dispatch selfcheck ok');
