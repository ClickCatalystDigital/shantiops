// scripts/child-routing-selfcheck.mjs — multi-unit split, Stores per-child allocation/routing. The
// two predicates lib/data.js's getChildRoutingBoard() and app/api/bom-items/[id]/route-to's
// server-side gate both rely on, extracted pure so they're testable without a DB. Mirrors
// production-routing-selfcheck.mjs's style.
import assert from 'node:assert/strict';

function isChildLineReady(c) { return c.allocated >= c.per_unit_required; }
function childPackable(c) { return isChildLineReady(c) && c.routed_to === 'dispatch'; }

// Exact-threshold and over-allocated both ready.
assert.equal(isChildLineReady({ allocated: 3, per_unit_required: 3 }), true);
assert.equal(isChildLineReady({ allocated: 5, per_unit_required: 3 }), true);
// Under threshold — not ready.
assert.equal(isChildLineReady({ allocated: 2, per_unit_required: 3 }), false);

// Ready but never routed — not packable. This is the forced-explicit-choice rule (decision #3): an
// active Stores decision is required, there is no passive default.
assert.equal(childPackable({ allocated: 3, per_unit_required: 3, routed_to: null }), false);
// Ready, routed to Production — not packable via the Dispatch route.
assert.equal(childPackable({ allocated: 3, per_unit_required: 3, routed_to: 'production' }), false);
// Ready and routed to Dispatch — packable.
assert.equal(childPackable({ allocated: 3, per_unit_required: 3, routed_to: 'dispatch' }), true);
// Not ready, routed to Dispatch anyway — routing never substitutes for allocation.
assert.equal(childPackable({ allocated: 2, per_unit_required: 3, routed_to: 'dispatch' }), false);

// A sum across two separate allocation events crossing the threshold (decision #2's whole point —
// readiness is the SUM of everything ever allocated, not any single event).
const sumAllocated = 1 + 2;
assert.equal(isChildLineReady({ allocated: sumAllocated, per_unit_required: 3 }), true);

console.log('child-routing-selfcheck: all assertions passed');
