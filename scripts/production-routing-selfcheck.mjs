// scripts/production-routing-selfcheck.mjs — requires_manufacturing (Feature C) packing-readiness
// predicate, extracted as a pure function mirroring lib/data.js's getProjectBom() exactly so it's
// testable without a DB. production_done stays Production-owned in every case; Stores never writes
// it — this only tests what counts as "ready to pack" for the two kinds of line.
import assert from 'node:assert/strict';

function isReadyForPacking(b) {
  return b.requires_manufacturing
    ? b.production_done
    : (b.purchase_status === 'Received' || b.purchase_status === 'In-Stock');
}

// requires_manufacturing = true (the default/normal case) — unchanged from before this feature.
assert.equal(isReadyForPacking({ requires_manufacturing: 1, production_done: 1, purchase_status: 'Received' }), 1);
assert.equal(isReadyForPacking({ requires_manufacturing: 1, production_done: 0, purchase_status: 'Received' }), 0);
assert.equal(isReadyForPacking({ requires_manufacturing: 1, production_done: 0, purchase_status: 'Transit' }), 0);

// requires_manufacturing = false (bought-out) — ready the moment it's actually received, never
// before, regardless of production_done (which Stores never touches).
assert.equal(isReadyForPacking({ requires_manufacturing: 0, production_done: 0, purchase_status: 'Received' }), true);
assert.equal(isReadyForPacking({ requires_manufacturing: 0, production_done: 0, purchase_status: 'In-Stock' }), true);
assert.equal(isReadyForPacking({ requires_manufacturing: 0, production_done: 0, purchase_status: 'Transit' }), false);
assert.equal(isReadyForPacking({ requires_manufacturing: 0, production_done: 0, purchase_status: 'Enquiry' }), false);
// production_done being (incorrectly) set has no bearing on the false-flag branch at all — proves
// this path never reads that field, matching "Stores never touches production_done."
assert.equal(isReadyForPacking({ requires_manufacturing: 0, production_done: 1, purchase_status: 'Transit' }), false);

console.log('production-routing-selfcheck: all assertions passed');
