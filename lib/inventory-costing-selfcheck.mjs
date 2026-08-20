// lib/inventory-costing-selfcheck.mjs — run with `node lib/inventory-costing-selfcheck.mjs`.
import assert from 'node:assert/strict';
import { weightedAverageCost, consumptionCost } from './inventory-costing.mjs';

// First-ever receipt of an item (no prior stock) — new average is just the incoming unit cost.
assert.equal(weightedAverageCost({ existingQty: 0, existingAvgCost: 0, receivedQty: 100, receivedUnitCost: 50 }), 50);

// Standard blend: 100 units @ 50 already on hand, receive 50 more @ 80.
// (100*50 + 50*80) / 150 = (5000 + 4000) / 150 = 60.
assert.equal(weightedAverageCost({ existingQty: 100, existingAvgCost: 50, receivedQty: 50, receivedUnitCost: 80 }), 60);

// A second receipt at a lower price pulls the average down, not up.
assert.equal(weightedAverageCost({ existingQty: 200, existingAvgCost: 100, receivedQty: 200, receivedUnitCost: 60 }), 80);

// Zero total quantity (shouldn't happen in practice, but must not divide by zero).
assert.equal(weightedAverageCost({ existingQty: 0, existingAvgCost: 0, receivedQty: 0, receivedUnitCost: 0 }), 0);

// Consumption cost is a straight qty * running average, never touching the average itself.
assert.equal(consumptionCost({ qty: 10, avgCost: 60 }), 600);
assert.equal(consumptionCost({ qty: 0, avgCost: 60 }), 0);

console.log('lib/inventory-costing.mjs selfcheck: all assertions passed');
