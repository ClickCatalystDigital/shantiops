import assert from 'node:assert/strict';
import { validateDispatch, lockedDispatches } from './po-dispatch.mjs';
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
// Locking: goods are matched to dispatches in the order recorded.
const rows = [{ dispatch_id: 1, po_item_id: 7, qty: 30, bom_item_id: 70 }, { dispatch_id: 2, po_item_id: 7, qty: 20, bom_item_id: 70 }];
assert.equal(lockedDispatches(rows, new Map()).size, 0);                           // nothing received
assert.deepEqual([...lockedDispatches(rows, new Map([[70, 10]]))], [1]);           // part of truck 1 in: truck 1 locked, truck 2 still open
assert.deepEqual([...lockedDispatches(rows, new Map([[70, 30]]))], [1]);           // truck 1 fully in, truck 2 still on the road
assert.deepEqual([...lockedDispatches(rows, new Map([[70, 31]]))].sort(), [1, 2]);
assert.equal(lockedDispatches([{ dispatch_id: 3, po_item_id: 8, qty: 5, bom_item_id: null }], new Map()).size, 0);
console.log('po-dispatch selfcheck ok');
